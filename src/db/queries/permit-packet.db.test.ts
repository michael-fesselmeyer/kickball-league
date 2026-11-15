import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { patternsOf, renewalTarget } from "@/domain/permits/renewal";
import { field, game, slot, venue } from "../schema/game";
import { message } from "../schema/message";
import { permitWindow } from "../schema/schedule";
import { season } from "../schema/season";
import { leagueWorld } from "../test/league-world";
import { grantRole } from "../test/leagues";
import { closePool, inRolledBackDb } from "../test/transaction";
import { queueBooksReminders } from "./books";
import { packetCounts, packetRosters, renewalInputs } from "./permit-packet";
import type { Db } from "./schedule";

afterAll(closePool);

const TZ = "America/New_York";

/**
 * Spring 2027 at McCarren Park's Field 2: three Sundays noon to 6 pm, one
 * of them lost, and one game played on the first.
 */
async function packetWorld(db: Db) {
  const w = await leagueWorld(db);
  const [v] = await db
    .insert(venue)
    .values({
      leagueId: w.leagueId,
      name: "McCarren Park",
      slug: "mccarren-park",
      lat: "40.720700",
      lng: "-73.953000",
    })
    .returning({ id: venue.id });
  if (!v) throw new Error("no venue");
  const [f] = await db
    .insert(field)
    .values({ venueId: v.id, name: "Field 2" })
    .returning({ id: field.id });
  if (!f) throw new Error("no field");
  const windows = await db
    .insert(permitWindow)
    .values(
      (
        [
          ["2027-04-11", "confirmed"],
          ["2027-04-18", "confirmed"],
          ["2027-04-25", "lost"],
        ] as const
      ).map(([d, status]) => ({
        fieldId: f.id,
        seasonId: w.season.id,
        startsAt: new Date(`${d}T16:00:00Z`),
        endsAt: new Date(`${d}T22:00:00Z`),
        status,
      })),
    )
    .returning({ id: permitWindow.id });
  const [s] = await db
    .insert(slot)
    .values({
      seasonId: w.season.id,
      fieldId: f.id,
      permitWindowId: windows[0]?.id,
      startsAt: new Date("2027-04-11T16:00:00Z"),
      endsAt: new Date("2027-04-11T17:00:00Z"),
      timeIndex: 0,
    })
    .returning({ id: slot.id });
  if (!s) throw new Error("no slot");
  await db.insert(game).values({
    seasonId: w.season.id,
    teamAId: w.teamSeasonId,
    teamBId: w.otherTeamSeasonId,
    slotId: s.id,
  });
  return { ...w, fieldId: f.id };
}

describe("renewalInputs", () => {
  it("reads the held windows as one weekly pattern, and the league's fields", async () => {
    await inRolledBackDb(async (db) => {
      const w = await packetWorld(db);
      const { windows, fields } = await renewalInputs(
        db,
        w.leagueId,
        w.season.id,
      );
      expect(windows).toHaveLength(2);
      expect(fields).toEqual([
        {
          id: w.fieldId,
          name: "Field 2",
          place: "McCarren Park, Field 2",
          venue: { lat: 40.7207, lng: -73.953 },
        },
      ]);
      const patterns = patternsOf(windows, TZ);
      expect(
        patterns.map((p) => [p.place, p.weekday, p.start, p.end, p.dates]),
      ).toEqual([
        [
          "McCarren Park, Field 2",
          0,
          "12:00",
          "18:00",
          ["2027-04-11", "2027-04-18"],
        ],
      ]);
      expect(renewalTarget(patterns)).toMatchObject({
        period: "spring_summer",
        year: 2028,
        renewals: { from: "2027-11-15", to: "2027-12-14" },
      });
    });
  });
});

describe("the packet's counts and rosters", () => {
  it("counts teams, players, games and game days", async () => {
    await inRolledBackDb(async (db) => {
      const w = await packetWorld(db);
      const counts = await packetCounts(db, w.season.id, TZ);
      expect(counts.games).toBe(1);
      expect(counts.gameDays).toBe(1);
      expect(counts.teams).toBeGreaterThanOrEqual(2);
      expect(counts.players).toBeGreaterThanOrEqual(1);
    });
  });

  it("lists each team's active players by name, and nothing else", async () => {
    await inRolledBackDb(async (db) => {
      const w = await packetWorld(db);
      const rosters = await packetRosters(db, w.season.id);
      expect(rosters.map((r) => r.team)).toContain("Kick Bottom");
      const kick = rosters.find((r) => r.team === "Kick Bottom");
      expect(kick?.players.length).toBeGreaterThanOrEqual(1);
      for (const r of rosters) {
        expect(Object.keys(r).sort()).toEqual(["players", "team"]);
        for (const name of r.players) expect(name).not.toMatch(/@/);
      }
    });
  });
});

describe("the renewal reminder", () => {
  it("reminds owners before the renewal period, finished seasons too", async () => {
    await inRolledBackDb(async (db) => {
      const w = await packetWorld(db);
      await grantRole(db, w.captain, "owner", w.leagueId);
      await db
        .update(season)
        .set({ status: "completed" })
        .where(eq(season.id, w.season.id));
      const now = new Date("2027-11-01T15:00:00Z");
      // Renewals for spring and summer 2028 open November 15, 2027.
      expect(await queueBooksReminders(db, w.leagueId, "2027-11-01", now)).toBe(
        1,
      );
      expect(await queueBooksReminders(db, w.leagueId, "2027-11-01", now)).toBe(
        0,
      );
      const [sent] = await db
        .select({ payload: message.payload })
        .from(message)
        .where(
          and(
            eq(message.userId, w.captain),
            eq(message.template, "books_reminder"),
          ),
        );
      expect(sent?.payload).toEqual({
        kind: "renewal_opens",
        subject: "Spring 2027's permits",
        on: "2027-11-15",
        daysLeft: 14,
      });
    });
  });
});
