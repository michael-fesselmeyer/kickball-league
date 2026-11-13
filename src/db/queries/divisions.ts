import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type {
  DivisionId,
  LeagueId,
  RuleSetId,
  SeasonId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import {
  parseDivisionName,
  type RuleSetInput,
} from "@/domain/season/divisions";
import { division, ruleSet } from "../schema/division";
import { bracket } from "../schema/playoffs";
import { season } from "../schema/season";
import { team, teamSeason } from "../schema/team";
import { recordAudit } from "./audit";
import type { Db } from "./schedule";

/**
 * Divisions, their rule sets and the season's crossover settings
 * (ADR 0035). A season with no divisions plays as one pool, exactly as
 * before divisions existed.
 */

export type DivisionRow = {
  id: DivisionId;
  name: string;
  slug: string;
  sortOrder: number;
  ruleSet: {
    id: RuleSetId;
    name: string;
    innings: number | null;
    timeLimitMinutes: number | null;
    options: { bunting?: boolean; stealing?: boolean };
  } | null;
};

/** A season's divisions in order, each with its rule set. */
export async function seasonDivisions(
  db: Db,
  seasonId: SeasonId,
): Promise<DivisionRow[]> {
  const rows = await db
    .select({
      id: division.id,
      name: division.name,
      slug: division.slug,
      sortOrder: division.sortOrder,
      ruleSetId: ruleSet.id,
      ruleSetName: ruleSet.name,
      innings: ruleSet.innings,
      timeLimitMinutes: ruleSet.timeLimitMinutes,
      options: ruleSet.options,
    })
    .from(division)
    .leftJoin(ruleSet, eq(division.ruleSetId, ruleSet.id))
    .where(eq(division.seasonId, seasonId))
    .orderBy(asc(division.sortOrder), asc(division.name));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    sortOrder: r.sortOrder,
    ruleSet:
      r.ruleSetId === null || r.ruleSetName === null
        ? null
        : {
            id: r.ruleSetId,
            name: r.ruleSetName,
            innings: r.innings,
            timeLimitMinutes: r.timeLimitMinutes,
            options: r.options ?? {},
          },
  }));
}

export type DivisionSettings = {
  crossoverGames: number;
  crossoversCount: boolean;
  combinedFinal: boolean;
};

/** Everything the divisions screen shows. */
export async function divisionsScreen(
  db: Db,
  leagueId: LeagueId,
  seasonId: SeasonId,
) {
  const [divisions, ruleSets, teams, [settings]] = await Promise.all([
    seasonDivisions(db, seasonId),
    db
      .select()
      .from(ruleSet)
      .where(eq(ruleSet.leagueId, leagueId))
      .orderBy(asc(ruleSet.name)),
    db
      .select({
        id: teamSeason.id,
        name: team.name,
        status: teamSeason.status,
        divisionId: teamSeason.divisionId,
      })
      .from(teamSeason)
      .innerJoin(team, eq(teamSeason.teamId, team.id))
      .where(
        and(
          eq(teamSeason.seasonId, seasonId),
          ne(teamSeason.status, "withdrawn"),
        ),
      )
      .orderBy(asc(team.name)),
    db
      .select({
        crossoverGames: season.crossoverGames,
        crossoversCount: season.crossoversCount,
        combinedFinal: season.combinedFinal,
      })
      .from(season)
      .where(eq(season.id, seasonId)),
  ]);
  return {
    divisions,
    ruleSets,
    teams,
    settings: settings ?? {
      crossoverGames: 0,
      crossoversCount: true,
      combinedFinal: true,
    },
  };
}

export type DivisionError = "invalid_name" | "duplicate" | "unknown_rule_set";

/** Whether a rule set belongs to the season's league; null is always fine. */
async function ruleSetFits(
  db: Db,
  seasonId: SeasonId,
  ruleSetId: RuleSetId | null,
): Promise<boolean> {
  if (ruleSetId === null) return true;
  const [found] = await db
    .select({ id: ruleSet.id })
    .from(ruleSet)
    .innerJoin(season, eq(season.leagueId, ruleSet.leagueId))
    .where(and(eq(ruleSet.id, ruleSetId), eq(season.id, seasonId)));
  return found !== undefined;
}

/** Whether the season already has another division with this name or slug. */
async function nameTaken(
  db: Db,
  seasonId: SeasonId,
  name: { name: string; slug: string },
  except: DivisionId | null,
): Promise<boolean> {
  const rows = await db
    .select({ id: division.id })
    .from(division)
    .where(
      and(
        eq(division.seasonId, seasonId),
        sql`(${division.slug} = ${name.slug} or ${division.name} = ${name.name})`,
      ),
    );
  return rows.some((r) => r.id !== except);
}

/** Adds a division at the end of the season's list. */
export async function addDivision(
  db: Db,
  input: { seasonId: SeasonId; name: string; ruleSetId: RuleSetId | null },
  actorId: UserId,
): Promise<Result<DivisionId, DivisionError>> {
  const parsed = parseDivisionName(input.name);
  if (!parsed.ok) return parsed;
  if (!(await ruleSetFits(db, input.seasonId, input.ruleSetId)))
    return err("unknown_rule_set");
  if (await nameTaken(db, input.seasonId, parsed.value, null))
    return err("duplicate");
  const [last] = await db
    .select({ order: sql<number>`coalesce(max(${division.sortOrder}), -1)` })
    .from(division)
    .where(eq(division.seasonId, input.seasonId));
  const [created] = await db
    .insert(division)
    .values({
      seasonId: input.seasonId,
      name: parsed.value.name,
      slug: parsed.value.slug,
      ruleSetId: input.ruleSetId,
      sortOrder: Number(last?.order ?? -1) + 1,
      createdBy: actorId,
    })
    .returning({ id: division.id });
  if (!created) return err("duplicate");
  await recordAudit(db, {
    actorId,
    action: "division.create",
    entityType: "division",
    entityId: created.id,
    after: { ...parsed.value, ruleSetId: input.ruleSetId },
  });
  return ok(created.id);
}

/** Renames a division or changes its rule set. */
export async function editDivision(
  db: Db,
  input: {
    seasonId: SeasonId;
    divisionId: DivisionId;
    name: string;
    ruleSetId: RuleSetId | null;
  },
  actorId: UserId,
): Promise<Result<DivisionId, DivisionError | "unknown_division">> {
  const parsed = parseDivisionName(input.name);
  if (!parsed.ok) return parsed;
  const [before] = await db
    .select()
    .from(division)
    .where(
      and(
        eq(division.id, input.divisionId),
        eq(division.seasonId, input.seasonId),
      ),
    );
  if (!before) return err("unknown_division");
  if (!(await ruleSetFits(db, input.seasonId, input.ruleSetId)))
    return err("unknown_rule_set");
  if (await nameTaken(db, input.seasonId, parsed.value, input.divisionId))
    return err("duplicate");
  await db
    .update(division)
    .set({ ...parsed.value, ruleSetId: input.ruleSetId })
    .where(eq(division.id, input.divisionId));
  await recordAudit(db, {
    actorId,
    action: "division.update",
    entityType: "division",
    entityId: input.divisionId,
    before: {
      name: before.name,
      slug: before.slug,
      ruleSetId: before.ruleSetId,
    },
    after: { ...parsed.value, ruleSetId: input.ruleSetId },
  });
  return ok(input.divisionId);
}

/**
 * Removes a division; its teams go back to having none. A division a
 * playoff bracket crowns stays.
 */
export async function removeDivision(
  db: Db,
  input: { seasonId: SeasonId; divisionId: DivisionId },
  actorId: UserId,
): Promise<Result<DivisionId, "unknown_division" | "in_bracket">> {
  const [found] = await db
    .select()
    .from(division)
    .where(
      and(
        eq(division.id, input.divisionId),
        eq(division.seasonId, input.seasonId),
      ),
    );
  if (!found) return err("unknown_division");
  const [inBracket] = await db
    .select({ id: bracket.id })
    .from(bracket)
    .where(eq(bracket.divisionId, input.divisionId));
  if (inBracket) return err("in_bracket");
  const moved = await db
    .update(teamSeason)
    .set({ divisionId: null })
    .where(eq(teamSeason.divisionId, input.divisionId))
    .returning({ id: teamSeason.id });
  await db.delete(division).where(eq(division.id, input.divisionId));
  await recordAudit(db, {
    actorId,
    action: "division.delete",
    entityType: "division",
    entityId: input.divisionId,
    before: { name: found.name, slug: found.slug, teams: moved.length },
  });
  return ok(input.divisionId);
}

/**
 * Puts teams in divisions (or none). Only the season's own teams and
 * divisions are accepted; a team asked about twice takes the last answer.
 */
export async function assignTeams(
  db: Db,
  input: {
    seasonId: SeasonId;
    assignments: {
      teamSeasonId: TeamSeasonId;
      divisionId: DivisionId | null;
    }[];
  },
  actorId: UserId,
): Promise<Result<number, "unknown_team" | "unknown_division">> {
  const wanted = new Map(
    input.assignments.map((a) => [a.teamSeasonId, a.divisionId]),
  );
  if (wanted.size === 0) return ok(0);
  const teams = await db
    .select({ id: teamSeason.id, divisionId: teamSeason.divisionId })
    .from(teamSeason)
    .where(
      and(
        eq(teamSeason.seasonId, input.seasonId),
        inArray(teamSeason.id, [...wanted.keys()]),
      ),
    );
  if (teams.length !== wanted.size) return err("unknown_team");
  const divisions = new Set(
    (
      await db
        .select({ id: division.id })
        .from(division)
        .where(eq(division.seasonId, input.seasonId))
    ).map((d) => d.id),
  );
  for (const d of wanted.values())
    if (d !== null && !divisions.has(d)) return err("unknown_division");

  const changed = teams.filter((t) => wanted.get(t.id) !== t.divisionId);
  for (const t of changed)
    await db
      .update(teamSeason)
      .set({ divisionId: wanted.get(t.id) ?? null })
      .where(eq(teamSeason.id, t.id));
  if (changed.length > 0)
    await recordAudit(db, {
      actorId,
      action: "division.assign_teams",
      entityType: "season",
      entityId: input.seasonId,
      before: Object.fromEntries(changed.map((t) => [t.id, t.divisionId])),
      after: Object.fromEntries(
        changed.map((t) => [t.id, wanted.get(t.id) ?? null]),
      ),
    });
  return ok(changed.length);
}

/** Adds a rule set the league's divisions can use. */
export async function addRuleSet(
  db: Db,
  input: { leagueId: LeagueId } & RuleSetInput,
  actorId: UserId,
): Promise<Result<RuleSetId, "duplicate">> {
  const [taken] = await db
    .select({ id: ruleSet.id })
    .from(ruleSet)
    .where(
      and(eq(ruleSet.leagueId, input.leagueId), eq(ruleSet.name, input.name)),
    );
  if (taken) return err("duplicate");
  const [created] = await db
    .insert(ruleSet)
    .values({
      leagueId: input.leagueId,
      name: input.name,
      innings: input.innings,
      timeLimitMinutes: input.timeLimitMinutes,
      options: { bunting: input.bunting, stealing: input.stealing },
      createdBy: actorId,
    })
    .returning({ id: ruleSet.id });
  if (!created) return err("duplicate");
  await recordAudit(db, {
    actorId,
    action: "rule_set.create",
    entityType: "rule_set",
    entityId: created.id,
    after: {
      name: input.name,
      innings: input.innings,
      timeLimitMinutes: input.timeLimitMinutes,
      bunting: input.bunting,
      stealing: input.stealing,
    },
  });
  return ok(created.id);
}

/** Saves the season's crossover and combined-final settings. */
export async function saveDivisionSettings(
  db: Db,
  input: { seasonId: SeasonId } & DivisionSettings,
  actorId: UserId,
): Promise<Result<SeasonId, "unknown_season">> {
  const [before] = await db
    .select({
      crossoverGames: season.crossoverGames,
      crossoversCount: season.crossoversCount,
      combinedFinal: season.combinedFinal,
    })
    .from(season)
    .where(eq(season.id, input.seasonId));
  if (!before) return err("unknown_season");
  const after = {
    crossoverGames: input.crossoverGames,
    crossoversCount: input.crossoversCount,
    combinedFinal: input.combinedFinal,
  };
  await db.update(season).set(after).where(eq(season.id, input.seasonId));
  await recordAudit(db, {
    actorId,
    action: "season.division_settings",
    entityType: "season",
    entityId: input.seasonId,
    before,
    after,
  });
  return ok(input.seasonId);
}

/** Each team entry's division in a season; teams with none are left out. */
export async function teamDivisions(
  db: Db,
  seasonId: SeasonId,
): Promise<Map<string, DivisionId>> {
  const rows = await db
    .select({ id: teamSeason.id, divisionId: teamSeason.divisionId })
    .from(teamSeason)
    .where(eq(teamSeason.seasonId, seasonId));
  return new Map(
    rows.flatMap((r) => (r.divisionId ? [[r.id as string, r.divisionId]] : [])),
  );
}
