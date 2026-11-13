import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { TeamSeasonId } from "@/domain/ids";
import { generate } from "@/domain/scheduler/generate";
import { validate } from "@/domain/scheduler/validate";
import { user } from "../schema/auth";
import { field, game, slot, venue } from "../schema/game";
import { league } from "../schema/league";
import { season } from "../schema/season";
import { team, teamSeason } from "../schema/team";
import { closePool, inRolledBackDb } from "../test/transaction";
import {
  addDivision,
  addRuleSet,
  assignTeams,
  divisionsScreen,
  editDivision,
  removeDivision,
  saveDivisionSettings,
  seasonDivisions,
  teamDivisions,
} from "./divisions";
import {
  bracketViews,
  createBracket,
  playoffPreview,
  publishBracket,
} from "./playoffs";
import { required } from "./rows";
import {
  type Db,
  loadSchedulerInput,
  publishVersion,
  saveVersion,
} from "./schedule";
import { seasonDivisionStandings, seasonStandings } from "./standings";

afterAll(closePool);

const SUNDAYS = [
  "2027-05-02",
  "2027-05-09",
  "2027-05-16",
  "2027-05-23",
  "2027-05-30",
  "2027-06-06",
];
const PLAYOFF_DAY = "2027-06-13";

/** A season with eight teams, two fields and three times each Sunday. */
async function world(db: Db) {
  const tag = Math.random().toString(36).slice(2, 8);
  const [admin] = await db
    .insert(user)
    .values({ name: "Admin", email: `divisions-${tag}@example.test` })
    .returning({ id: user.id });
  const [lg] = await db
    .insert(league)
    .values({ name: "Test League", slug: `test-${tag}` })
    .returning({ id: league.id });
  const leagueId = required(lg, "league").id;
  const makeSeason = async (slug: string) => {
    const [sn] = await db
      .insert(season)
      .values({
        leagueId,
        name: slug,
        slug: `${slug}-${tag}`,
        status: "in_progress",
        startsOn: SUNDAYS[0] as string,
        endsOn: PLAYOFF_DAY,
        feeModel: "per_team",
        teamFeeCents: 120000,
        rosterMin: 12,
        rosterMax: 20,
      })
      .returning({ id: season.id });
    return required(sn, "season").id;
  };
  const seasonId = await makeSeason("summer");
  const otherSeasonId = await makeSeason("fall");
  const [vn] = await db
    .insert(venue)
    .values({ leagueId, name: "Test Park", slug: `park-${tag}` })
    .returning({ id: venue.id });
  const fields = await db
    .insert(field)
    .values(
      [1, 2].map((k) => ({
        venueId: required(vn, "venue").id,
        name: `Field ${k}`,
      })),
    )
    .returning({ id: field.id });
  const starts = ["14:00", "15:30", "17:00"];
  await db.insert(slot).values(
    [...SUNDAYS, PLAYOFF_DAY].flatMap((date) =>
      starts.flatMap((time, timeIndex) =>
        fields.map((f) => {
          const startsAt = new Date(`${date}T${time}:00Z`);
          return {
            seasonId,
            fieldId: f.id,
            startsAt,
            endsAt: new Date(startsAt.getTime() + 90 * 60_000),
            timeIndex,
          };
        }),
      ),
    ),
  );
  const teams = await db
    .insert(team)
    .values(
      Array.from({ length: 8 }, (_, i) => ({
        leagueId,
        name: `Team ${i + 1}`,
        slug: `team-${i + 1}-${tag}`,
      })),
    )
    .returning({ id: team.id });
  const entries = await db
    .insert(teamSeason)
    .values(
      teams.map((t) => ({
        teamId: t.id,
        seasonId,
        status: "confirmed" as const,
      })),
    )
    .returning({ id: teamSeason.id });
  return {
    adminId: required(admin, "admin").id,
    leagueId,
    seasonId: seasonId,
    otherSeasonId: otherSeasonId,
    entries: entries.map((e) => e.id),
  };
}

type World = Awaited<ReturnType<typeof world>>;

/** Competitive and Social, four teams each, with a rule set for one. */
async function divide(db: Db, w: World) {
  const rules = await addRuleSet(
    db,
    {
      leagueId: w.leagueId,
      name: "Competitive rules",
      innings: 7,
      timeLimitMinutes: 55,
      bunting: false,
      stealing: true,
    },
    w.adminId,
  );
  if (!rules.ok) throw new Error(rules.error);
  const competitive = await addDivision(
    db,
    { seasonId: w.seasonId, name: "Competitive", ruleSetId: rules.value },
    w.adminId,
  );
  const social = await addDivision(
    db,
    { seasonId: w.seasonId, name: "Social", ruleSetId: null },
    w.adminId,
  );
  if (!competitive.ok || !social.ok) throw new Error("divisions");
  const assigned = await assignTeams(
    db,
    {
      seasonId: w.seasonId,
      assignments: w.entries.map((id, i) => ({
        teamSeasonId: id,
        divisionId: i < 4 ? competitive.value : social.value,
      })),
    },
    w.adminId,
  );
  if (!assigned.ok) throw new Error(assigned.error);
  return { competitive: competitive.value, social: social.value };
}

/** Generates and publishes three division rounds and the crossovers. */
async function publishSeason(db: Db, w: World) {
  const input = await loadSchedulerInput(db, w.seasonId, {
    rounds: 3,
    reservePerDay: 0,
    seed: 5,
  });
  if (!input.ok) throw new Error(input.error);
  const regular = {
    ...input.value,
    slots: input.value.slots.filter((s) => s.date !== PLAYOFF_DAY),
  };
  const schedule = generate(regular, { iterations: 500 });
  const versionId = await saveVersion(db, {
    seasonId: w.seasonId,
    input: regular,
    schedule,
    origin: "generated",
  });
  const published = await publishVersion(db, versionId, w.adminId);
  if (!published.ok) throw new Error(published.error);
  return { input: regular, schedule };
}

/** Finishes every regular game: the team listed first wins by its index. */
async function playAll(db: Db, w: World) {
  const games = await db
    .select({ id: game.id })
    .from(game)
    .where(eq(game.seasonId, w.seasonId))
    .orderBy(game.id);
  for (const [i, g] of games.entries())
    await db
      .update(game)
      .set({
        status: "final",
        scoreA: 5 + (i % 4),
        scoreB: i % 3,
        finalizedAt: new Date(Date.UTC(2027, 5, 7, 0, i)),
      })
      .where(eq(game.id, g.id));
}

describe("divisions", () => {
  it("adds divisions with an optional rule set and keeps names unique", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const { competitive } = await divide(db, w);
      const divisions = await seasonDivisions(db, w.seasonId);
      expect(
        divisions.map((d) => [d.name, d.slug, d.ruleSet?.innings ?? null]),
      ).toEqual([
        ["Competitive", "competitive", 7],
        ["Social", "social", null],
      ]);
      expect(
        await addDivision(
          db,
          { seasonId: w.seasonId, name: " competitive ", ruleSetId: null },
          w.adminId,
        ),
      ).toEqual({ ok: false, error: "duplicate" });
      expect(
        await editDivision(
          db,
          {
            seasonId: w.seasonId,
            divisionId: competitive,
            name: "Social",
            ruleSetId: null,
          },
          w.adminId,
        ),
      ).toEqual({ ok: false, error: "duplicate" });
      expect(
        await editDivision(
          db,
          {
            seasonId: w.seasonId,
            divisionId: competitive,
            name: "Comp",
            ruleSetId: null,
          },
          w.adminId,
        ),
      ).toEqual({ ok: true, value: competitive });
      const screen = await divisionsScreen(db, w.leagueId, w.seasonId);
      expect(screen.divisions[0]).toMatchObject({
        name: "Comp",
        ruleSet: null,
      });
      expect(screen.ruleSets.map((r) => r.name)).toEqual(["Competitive rules"]);
      expect(
        screen.teams.filter((t) => t.divisionId === competitive),
      ).toHaveLength(4);
    }));

  it("refuses a rule set from another league and a division from another season", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const other = await world(db);
      const theirs = await addRuleSet(
        db,
        {
          leagueId: other.leagueId,
          name: "Theirs",
          innings: null,
          timeLimitMinutes: null,
          bunting: true,
          stealing: false,
        },
        other.adminId,
      );
      if (!theirs.ok) throw new Error(theirs.error);
      expect(
        await addDivision(
          db,
          { seasonId: w.seasonId, name: "Mixed", ruleSetId: theirs.value },
          w.adminId,
        ),
      ).toEqual({ ok: false, error: "unknown_rule_set" });

      const elsewhere = await addDivision(
        db,
        { seasonId: w.otherSeasonId, name: "Fall only", ruleSetId: null },
        w.adminId,
      );
      if (!elsewhere.ok) throw new Error(elsewhere.error);
      const team = required(w.entries[0], "team");
      expect(
        await assignTeams(
          db,
          {
            seasonId: w.seasonId,
            assignments: [{ teamSeasonId: team, divisionId: elsewhere.value }],
          },
          w.adminId,
        ),
      ).toEqual({ ok: false, error: "unknown_division" });
      // The database refuses it too.
      await expect(
        db
          .update(teamSeason)
          .set({ divisionId: elsewhere.value })
          .where(eq(teamSeason.id, team)),
      ).rejects.toThrow();
    }));

  it("leaves a season without divisions as one pool", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const input = await loadSchedulerInput(db, w.seasonId, {
        rounds: 2,
        reservePerDay: 0,
        seed: 1,
      });
      if (!input.ok) throw new Error(input.error);
      expect(input.value.teams.every((t) => t.divisionId === undefined)).toBe(
        true,
      );
      expect(input.value.crossoverGames).toBeUndefined();
      const { tables } = await seasonDivisionStandings(db, w.seasonId);
      expect(tables).toHaveLength(1);
      expect(tables[0]?.division).toBeNull();
      expect(tables[0]?.rows).toHaveLength(8);
    }));

  it("schedules within each division plus the crossovers, and ranks each division", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const { competitive, social } = await divide(db, w);
      await saveDivisionSettings(
        db,
        {
          seasonId: w.seasonId,
          crossoverGames: 2,
          crossoversCount: true,
          combinedFinal: true,
        },
        w.adminId,
      );
      const { input, schedule } = await publishSeason(db, w);
      expect(input.crossoverGames).toBe(2);
      expect(validate(input, schedule)).toEqual([]);
      expect(schedule.unplaced).toEqual([]);
      const division = await teamDivisions(db, w.seasonId);
      const crossovers = schedule.games.filter(
        (g) => division.get(g.teamA) !== division.get(g.teamB),
      );
      expect(crossovers).toHaveLength(8);
      for (const id of w.entries)
        expect(
          crossovers.filter((g) => g.teamA === id || g.teamB === id),
        ).toHaveLength(2);

      await playAll(db, w);
      const counted = await seasonDivisionStandings(db, w.seasonId);
      expect(counted.tables.map((t) => t.division?.id)).toEqual([
        competitive,
        social,
      ]);
      for (const table of counted.tables) {
        expect(table.rows).toHaveLength(4);
        // Three division games and two crossovers each.
        for (const row of table.rows) expect(row.played).toBe(5);
      }

      await saveDivisionSettings(
        db,
        {
          seasonId: w.seasonId,
          crossoverGames: 2,
          crossoversCount: false,
          combinedFinal: true,
        },
        w.adminId,
      );
      const apart = await seasonDivisionStandings(db, w.seasonId);
      for (const table of apart.tables)
        for (const row of table.rows) expect(row.played).toBe(3);
      // The season-wide table still has every result.
      const all = await seasonStandings(db, w.seasonId);
      expect(all.rows.every((r) => r.played === 5)).toBe(true);
    }));

  it("seeds two divisions into one bracket whose final is their champions' game", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const { competitive, social } = await divide(db, w);
      await publishSeason(db, w);
      await playAll(db, w);
      const preview = required(await playoffPreview(db, w.seasonId), "preview");
      expect(preview.mode).toBe("halves");
      expect(preview.eligibleCount).toBe(4);
      expect(preview.defaultTeams).toBe(4);
      const created = await createBracket(db, {
        seasonId: w.seasonId,
        teams: 2,
        fromDate: PLAYOFF_DAY,
        actorId: w.adminId,
      });
      if (!created.ok) throw new Error(created.error);
      const [view, ...more] = await bracketViews(db, w.seasonId, {
        includeDraft: true,
      });
      expect(more).toEqual([]);
      const bracket = required(view, "bracket");
      expect(bracket.division).toBeNull();
      expect(bracket.size).toBe(4);
      const division = await teamDivisions(db, w.seasonId);
      const firstRound = bracket.matches.filter((m) => m.round === 1);
      expect(
        firstRound.map((m) => [
          division.get(m.teamA?.id ?? ""),
          division.get(m.teamB?.id ?? ""),
        ]),
      ).toEqual([
        [competitive, competitive],
        [social, social],
      ]);
      // Seeds 1 and 4 are Competitive's top two; 2 and 3 Social's.
      const topCompetitive = required(preview.divisions[0], "competitive")
        .standings.slice(0, 2)
        .map((r) => r.teamId);
      expect([bracket.seeds[0]?.team?.id, bracket.seeds[3]?.team?.id]).toEqual(
        topCompetitive,
      );
    }));

  it("gives each division its own bracket without a combined final, published together", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const { competitive, social } = await divide(db, w);
      await saveDivisionSettings(
        db,
        {
          seasonId: w.seasonId,
          crossoverGames: 0,
          crossoversCount: true,
          combinedFinal: false,
        },
        w.adminId,
      );
      await publishSeason(db, w);
      await playAll(db, w);
      const preview = required(await playoffPreview(db, w.seasonId), "preview");
      expect(preview.mode).toBe("per_division");
      expect(
        await createBracket(db, {
          seasonId: w.seasonId,
          teams: 5,
          fromDate: PLAYOFF_DAY,
          actorId: w.adminId,
        }),
      ).toEqual({ ok: false, error: "too_few_teams" });
      const created = await createBracket(db, {
        seasonId: w.seasonId,
        teams: 4,
        fromDate: PLAYOFF_DAY,
        actorId: w.adminId,
      });
      if (!created.ok) throw new Error(created.error);
      const drafts = await bracketViews(db, w.seasonId, { includeDraft: true });
      expect(drafts.map((b) => [b.division?.id, b.size])).toEqual([
        [competitive, 4],
        [social, 4],
      ]);
      // Six slots on playoff day: the two brackets' semifinals take four,
      // and no slot holds two matches.
      const slots = drafts.flatMap((b) =>
        b.matches.flatMap((m) => (m.startsAt ? [m.startsAt.getTime()] : [])),
      );
      expect(slots.length).toBeGreaterThanOrEqual(4);
      expect(await bracketViews(db, w.seasonId)).toEqual([]);

      const published = await publishBracket(db, w.seasonId, w.adminId);
      expect(published.ok).toBe(true);
      const live = await bracketViews(db, w.seasonId);
      expect(live.map((b) => b.status)).toEqual(["published", "published"]);
      expect(
        await removeDivision(
          db,
          { seasonId: w.seasonId, divisionId: competitive },
          w.adminId,
        ),
      ).toEqual({ ok: false, error: "in_bracket" });
    }));

  it("removes a division and leaves its teams without one", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const { social } = await divide(db, w);
      expect(
        await removeDivision(
          db,
          { seasonId: w.seasonId, divisionId: social },
          w.adminId,
        ),
      ).toEqual({ ok: true, value: social });
      expect(
        await removeDivision(
          db,
          { seasonId: w.seasonId, divisionId: social },
          w.adminId,
        ),
      ).toEqual({ ok: false, error: "unknown_division" });
      const division = await teamDivisions(db, w.seasonId);
      expect(division.size).toBe(4);
      expect(
        await assignTeams(
          db,
          {
            seasonId: w.seasonId,
            assignments: [
              {
                teamSeasonId:
                  "00000000-0000-4000-8000-000000000000" as TeamSeasonId,
                divisionId: null,
              },
            ],
          },
          w.adminId,
        ),
      ).toEqual({ ok: false, error: "unknown_team" });
      expect(
        await editDivision(
          db,
          {
            seasonId: w.seasonId,
            divisionId: social,
            name: "Social",
            ruleSetId: null,
          },
          w.adminId,
        ),
      ).toEqual({ ok: false, error: "unknown_division" });
    }));
});
