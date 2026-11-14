import { afterAll, describe, expect, it } from "vitest";
import { buildPlan } from "@/domain/capacity/plan";
import { field, slot, venue } from "../schema/game";
import { blackout, permitWindow } from "../schema/schedule";
import { team, teamSeason } from "../schema/team";
import { waitlistEntry } from "../schema/waitlist";
import { leagueWorld } from "../test/league-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import { capacityInputs } from "./capacity";

afterAll(closePool);

const TZ = "America/New_York";

describe("the capacity planner's inputs", () => {
  it("reads the season's field time, teams, waitlist, fields and parks", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      const [park] = await db
        .insert(venue)
        .values({
          leagueId: w.leagueId,
          name: "Example Park",
          slug: "example-park",
          lat: "40.720600",
          lng: "-73.951300",
        })
        .returning({ id: venue.id });
      if (!park) throw new Error("no venue");
      const fields = await db
        .insert(field)
        .values([
          { venueId: park.id, name: "Field 1", sortOrder: 0 },
          { venueId: park.id, name: "Field 2", sortOrder: 1 },
        ])
        .returning({ id: field.id, name: field.name });
      const [one, two] = fields;
      if (!one || !two) throw new Error("no fields");

      // Saturdays, noon to 6 pm New York time (16:00–22:00 UTC in April),
      // on Field 2; one more date is lost and one is a blackout.
      const days = ["2027-04-10", "2027-04-17", "2027-04-24", "2027-05-01"];
      const windows = await db
        .insert(permitWindow)
        .values(
          days.map((d, i) => ({
            fieldId: two.id,
            seasonId: w.season.id,
            startsAt: new Date(`${d}T16:00:00Z`),
            endsAt: new Date(`${d}T22:00:00Z`),
            status: i === 3 ? ("lost" as const) : ("confirmed" as const),
          })),
        )
        .returning({ id: permitWindow.id });
      await db.insert(blackout).values({
        seasonId: w.season.id,
        onDate: "2027-04-24",
        reason: "Holiday",
      });
      await db.insert(slot).values(
        [0, 1, 2].map((i) => ({
          seasonId: w.season.id,
          fieldId: two.id,
          permitWindowId: windows[0]?.id,
          startsAt: new Date(`2027-04-10T${16 + i}:00:00Z`),
          endsAt: new Date(`2027-04-10T${16 + i}:55:00Z`),
          timeIndex: i,
        })),
      );

      // One team waitlisted in the season, one captain on the waitlist.
      const [waiting] = await db
        .insert(team)
        .values({
          leagueId: w.leagueId,
          name: "Late Kickers",
          slug: "late-kickers",
        })
        .returning({ id: team.id });
      if (!waiting) throw new Error("no team");
      await db.insert(teamSeason).values({
        teamId: waiting.id,
        seasonId: w.season.id,
        status: "waitlisted",
        paymentMode: "full",
      });
      await db.insert(waitlistEntry).values([
        { seasonId: w.season.id, userId: w.agent, teamName: "Free Kicks" },
        {
          seasonId: w.season.id,
          userId: w.admin,
          teamName: "Gone Home",
          status: "left",
        },
      ]);

      const inputs = await capacityInputs(db, w.leagueId, w.season.id, TZ);
      expect(inputs.windows).toEqual(
        days.slice(0, 3).map((date) => ({
          date,
          fieldKey: two.id,
          start: 12 * 60,
          end: 18 * 60,
        })),
      );
      expect([...inputs.blackouts]).toEqual(["2027-04-24"]);
      expect(inputs.entered).toBe(2);
      expect(inputs.waiting).toBe(2);
      // The field with permit windows comes first.
      expect(inputs.fields.map((f) => [f.name, f.windows])).toEqual([
        ["Field 2", 4],
        ["Field 1", 0],
      ]);
      expect(inputs.parks).toEqual([{ lat: 40.7206, lng: -73.9513 }]);
      expect(inputs.slotMinutes).toBe(55);

      // Two game days of 6 hours at 60 minutes: 6 games a day, 12 teams
      // playing two games each; 4 want in.
      const plan = buildPlan({
        season: w.season,
        windows: inputs.windows,
        blackouts: inputs.blackouts,
        gameMinutes: 60,
        gamesPerTeam: 2,
        gamesPerTeamPerDay: 1,
        wanted: inputs.entered + inputs.waiting,
      });
      expect(plan.capacity).toMatchObject({ teams: 12, gameDays: 2 });
      expect(plan.gap).toBe(0);
    });
  });

  it("is empty for a season with no field time", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      const inputs = await capacityInputs(db, w.leagueId, w.season.id, TZ);
      expect(inputs).toMatchObject({
        windows: [],
        entered: 2,
        waiting: 0,
        parks: [],
        slotMinutes: null,
      });
    });
  });
});
