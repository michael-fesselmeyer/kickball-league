import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { UserId } from "@/domain/ids";
import { awayWeek } from "../schema/availability";
import { message } from "../schema/message";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { messagingWorld } from "../test/messaging-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import { deleteAccount, personalData } from "./account";
import { awaySeasonsFor, saveAwayWeeks, teamAvailability } from "./away";
import type { Db } from "./schedule";

afterAll(closePool);

// Season Sep 1 – Nov 1, 2026 in New York. "Now" is Wednesday, Sep 30.
const NOW = new Date("2026-09-30T16:00:00Z");
const GAME_WEEK = "2026-10-05"; // Mon Oct 5, 8 pm game
const LATER_WEEK = "2026-10-12";

/** Aces with six women and six men (the captain among the men), and two games against Bees. */
async function world(db: Db) {
  const w = await messagingWorld(db);
  const extra = [];
  for (let i = 0; i < 9; i += 1) {
    const p = await w.person(`ace-x${i}`);
    await w.join(w.aces.id, p);
    extra.push(p);
  }
  const aces = [w.aces.captain, ...w.aces.players, ...extra];
  for (const [i, p] of aces.entries())
    await db.insert(profile).values({
      userId: p.userId,
      firstName: `Ace${String.fromCharCode(65 + i)}`,
      lastName: "Testwood",
      // The captain and players 1–5 are men; 6–11 are women.
      lineupGender: i < 6 ? "man" : "woman",
    });
  const women = aces.slice(6);
  const first = await w.gameBetween(
    w.aces.id,
    w.bees.id,
    new Date("2026-10-06T01:00:00Z"),
  );
  const second = await w.gameBetween(
    w.bees.id,
    w.aces.id,
    new Date("2026-10-13T01:00:00Z"),
  );
  return { ...w, aces: { ...w.aces, all: aces }, women, first, second };
}

const sent = (db: Db, userId: UserId) =>
  db
    .select({ template: message.template, payload: message.payload })
    .from(message)
    .where(eq(message.userId, userId));

describe("away weeks", () => {
  it("lists the season's weeks with the team's games and saves the player's choice", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const player = w.women[0]!;
      const saved = await saveAwayWeeks(db, {
        userId: player.userId,
        seasonId: w.season.id,
        weeks: [GAME_WEEK, "2026-10-06", "2027-01-04"],
        now: NOW,
      });
      expect(saved).toEqual({
        ok: true,
        value: { weeks: [GAME_WEEK], captainsTold: 0 },
      });
      const [listed] = await awaySeasonsFor(db, player.userId, NOW);
      expect(listed?.teamName).toBe("Aces");
      expect(listed?.weeks[0]).toMatchObject({
        week: "2026-08-31",
        past: true,
        away: false,
      });
      const week = listed?.weeks.find((x) => x.week === GAME_WEEK);
      expect(week).toMatchObject({ away: true, past: false });
      expect(week?.games.map((g) => g.opponent)).toEqual(["Bees"]);
      expect(listed?.weeks.at(-1)?.week).toBe("2026-10-26");
    });
  });

  it("keeps weeks already gone, whatever the form says", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const player = w.women[0]!;
      await db.insert(awayWeek).values({
        registrationId: player.registrationId,
        weekStart: "2026-09-14",
      });
      const saved = await saveAwayWeeks(db, {
        userId: player.userId,
        seasonId: w.season.id,
        weeks: [LATER_WEEK],
        now: NOW,
      });
      expect(saved.ok && saved.value.weeks).toEqual(["2026-09-14", LATER_WEEK]);
      const cleared = await saveAwayWeeks(db, {
        userId: player.userId,
        seasonId: w.season.id,
        weeks: [],
        now: NOW,
      });
      expect(cleared.ok && cleared.value.weeks).toEqual(["2026-09-14"]);
    });
  });

  it("refuses people not registered for the season, and seasons that are over", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const other = await messagingWorld(db);
      const save = (userId: UserId, seasonId = w.season.id) =>
        saveAwayWeeks(db, { userId, seasonId, weeks: [GAME_WEEK], now: NOW });
      expect(await save(other.aces.captain.userId)).toEqual({
        ok: false,
        error: "not_registered",
      });
      expect(await save(w.cancelled.userId)).toEqual({
        ok: false,
        error: "not_registered",
      });
      await db
        .update(season)
        .set({ status: "completed" })
        .where(eq(season.id, w.season.id));
      expect(await save(w.women[0]!.userId)).toEqual({
        ok: false,
        error: "season_over",
      });
    });
  });
});

describe("telling the captain", () => {
  it("emails the captains once when a week falls short of a full lineup", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const [first, second, third] = w.women;
      const mark = (userId: UserId, weeks: string[]) =>
        saveAwayWeeks(db, { userId, seasonId: w.season.id, weeks, now: NOW });
      // One woman away: five and six still field eleven.
      expect(await mark(first!.userId, [GAME_WEEK])).toMatchObject({
        ok: true,
        value: { captainsTold: 0 },
      });
      // A second takes the week short.
      expect(await mark(second!.userId, [GAME_WEEK])).toMatchObject({
        ok: true,
        value: { captainsTold: 1 },
      });
      const [email] = await sent(db, w.aces.captain.userId);
      expect(email?.template).toBe("away_short");
      expect(email?.payload).toMatchObject({
        team: "Aces",
        week: "Oct 5 – Oct 11",
        available: 10,
        gameId: w.first.gameId,
        subsOpen: true,
      });
      // Already short: no second email for the same week.
      expect(await mark(third!.userId, [GAME_WEEK])).toMatchObject({
        ok: true,
        value: { captainsTold: 0 },
      });
      // The players themselves hear nothing.
      expect(await sent(db, second!.userId)).toEqual([]);
    });
  });

  it("stays quiet for weeks with no game left to play", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      for (const p of w.women.slice(0, 3))
        expect(
          await saveAwayWeeks(db, {
            userId: p.userId,
            seasonId: w.season.id,
            weeks: ["2026-10-19"],
            now: NOW,
          }),
        ).toMatchObject({ ok: true, value: { captainsTold: 0 } });
    });
  });
});

describe("teamAvailability", () => {
  it("gives each game its week's available players and who is away", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      for (const p of w.women.slice(0, 2))
        await saveAwayWeeks(db, {
          userId: p.userId,
          seasonId: w.season.id,
          weeks: [GAME_WEEK],
          now: NOW,
        });
      const found = await teamAvailability(
        db,
        w.aces.id,
        [
          { id: w.first.gameId, startsAt: new Date("2026-10-06T00:00:00Z") },
          { id: w.second.gameId, startsAt: new Date("2026-10-13T00:00:00Z") },
        ],
        "America/New_York",
      );
      expect(found.get(w.first.gameId)).toMatchObject({
        week: GAME_WEEK,
        available: 10,
        short: true,
      });
      expect(found.get(w.first.gameId)?.away.map((m) => m.name)).toEqual([
        "AceG T.",
        "AceH T.",
      ]);
      expect(found.get(w.second.gameId)).toMatchObject({
        available: 12,
        short: false,
        away: [],
      });
    });
  });
});

describe("personal data", () => {
  it("exports a player's away weeks and removes them with the account", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const player = w.women[0]!;
      await saveAwayWeeks(db, {
        userId: player.userId,
        seasonId: w.season.id,
        weeks: [GAME_WEEK],
        now: NOW,
      });
      expect((await personalData(db, player.userId, NOW))?.awayWeeks).toEqual([
        { seasonId: w.season.id, week: GAME_WEEK },
      ]);
      expect((await deleteAccount(db, player.userId, NOW)).ok).toBe(true);
      expect(
        await db
          .select()
          .from(awayWeek)
          .where(eq(awayWeek.registrationId, player.registrationId)),
      ).toEqual([]);
    });
  });
});
