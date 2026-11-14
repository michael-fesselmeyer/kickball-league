import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/queries/schedule";
import { bracket, division, ruleSet, season, teamSeason } from "@/db/schema";
import type { DivisionId, LeagueId, RuleSetId } from "@/domain/ids";
import type { SeedData } from "./generate";
import { generatePastSeasons } from "./past-seasons";

/**
 * Two divisions in the demo league (ADR 0040): Summer 2026 split into
 * Competitive and Social, each with its own rule set. Every team played its
 * three division rivals and the four teams of the other division, so the
 * season counts four crossover games a team, and the public standings,
 * schedule and team pages show each division.
 *
 * Pure and deterministic, with fixed ids, so links survive a reseed.
 */

export const DIVIDED_SEASON = "summer-2026";

export const SEED_DIVISIONS = [
  {
    name: "Competitive",
    slug: "competitive",
    rules: {
      name: "Competitive rules",
      innings: 7,
      timeLimitMinutes: 55,
      options: { bunting: false, stealing: false },
    },
    teams: ["sun-kickers", "foul-play", "kickin-chicken", "red-rubber-ballers"],
  },
  {
    name: "Social",
    slug: "social",
    rules: {
      name: "Social rules",
      innings: 5,
      timeLimitMinutes: 55,
      options: { bunting: true, stealing: false },
    },
    teams: ["the-big-kicks", "base-invaders", "pitch-please", "grand-slammers"],
  },
] as const;

/** Fixed ids in their own range. */
const divisionsId = <T extends string>(n: number) =>
  `d1f10000-0000-4000-8000-${String(n).padStart(12, "0")}` as T;

export function generateSeedDivisions(data: SeedData) {
  const past = generatePastSeasons(data);
  const plan = past.seasons.find((p) => p.season.slug === DIVIDED_SEASON);
  if (!plan) throw new Error(`No seeded season ${DIVIDED_SEASON}`);
  const teamSlug = new Map(
    [...data.teams, ...past.teams].map((t) => [t.id as string, t.slug]),
  );
  let n = 0;
  const ruleSets = SEED_DIVISIONS.map((d) => ({
    id: divisionsId<RuleSetId>(++n),
    leagueId: data.league.id,
    ...d.rules,
  }));
  const divisions = SEED_DIVISIONS.map((d, i) => ({
    id: divisionsId<DivisionId>(++n),
    seasonId: plan.season.id,
    name: d.name,
    slug: d.slug,
    ruleSetId: (ruleSets[i] as (typeof ruleSets)[number]).id,
    sortOrder: i,
  }));
  const assignments = plan.entries.map((entry) => {
    const slug = teamSlug.get(entry.teamId);
    const index = SEED_DIVISIONS.findIndex((d) =>
      (d.teams as readonly string[]).includes(slug ?? ""),
    );
    const found = divisions[index];
    if (!found) throw new Error(`Seed team ${slug} has no division`);
    return { teamSeasonId: entry.id, divisionId: found.id };
  });
  return {
    seasonId: plan.season.id,
    ruleSets,
    divisions,
    assignments,
    /** Every team plays all four teams of the other division. */
    crossoverGames: SEED_DIVISIONS[1].teams.length,
  };
}

/** Splits the seeded summer into its divisions. */
export async function addSeedDivisions(db: Db, data: SeedData): Promise<void> {
  const seeded = generateSeedDivisions(data);
  await db.insert(ruleSet).values(seeded.ruleSets);
  await db.insert(division).values(seeded.divisions);
  for (const a of seeded.assignments)
    await db
      .update(teamSeason)
      .set({ divisionId: a.divisionId })
      .where(eq(teamSeason.id, a.teamSeasonId));
  await db
    .update(season)
    .set({ crossoverGames: seeded.crossoverGames })
    .where(eq(season.id, seeded.seasonId));
}

/**
 * Removes the league's divisions and rule sets before its seasons and teams
 * go: team entries point at divisions, and a division's bracket at both.
 */
export async function removeSeedDivisions(
  db: Db,
  leagueId: LeagueId,
): Promise<void> {
  const seasonIds = (
    await db
      .select({ id: season.id })
      .from(season)
      .where(eq(season.leagueId, leagueId))
  ).map((s) => s.id);
  if (seasonIds.length > 0) {
    const divisionIds = (
      await db
        .select({ id: division.id })
        .from(division)
        .where(inArray(division.seasonId, seasonIds))
    ).map((d) => d.id);
    if (divisionIds.length > 0) {
      await db
        .update(teamSeason)
        .set({ divisionId: null })
        .where(inArray(teamSeason.divisionId, divisionIds));
      await db.delete(bracket).where(inArray(bracket.divisionId, divisionIds));
      await db.delete(division).where(inArray(division.id, divisionIds));
    }
  }
  await db.delete(ruleSet).where(eq(ruleSet.leagueId, leagueId));
}
