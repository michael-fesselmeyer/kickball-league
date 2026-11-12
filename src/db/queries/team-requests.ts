import { and, asc, count, eq } from "drizzle-orm";
import type {
  SeasonId,
  TeamConstraintId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import {
  MAX_REQUESTS_PER_TEAM,
  type TeamRequest,
} from "@/domain/schedule/team-requests";
import { slot } from "../schema/game";
import { teamConstraint } from "../schema/schedule";
import { team, teamSeason } from "../schema/team";
import { recordAudit } from "./audit";
import type { Db } from "./schedule";

export type StoredRequest = TeamRequest & {
  id: TeamConstraintId;
  teamSeasonId: TeamSeasonId;
};

const columns = {
  id: teamConstraint.id,
  teamSeasonId: teamConstraint.teamSeasonId,
  kind: teamConstraint.kind,
  onDate: teamConstraint.onDate,
  timeIndex: teamConstraint.timeIndex,
  reason: teamConstraint.reason,
};

/** A team's requests, by date then time, conflicts first. */
export async function teamRequests(
  db: Db,
  teamSeasonId: TeamSeasonId,
): Promise<StoredRequest[]> {
  return db
    .select(columns)
    .from(teamConstraint)
    .where(eq(teamConstraint.teamSeasonId, teamSeasonId))
    .orderBy(
      asc(teamConstraint.onDate),
      asc(teamConstraint.timeIndex),
      asc(teamConstraint.kind),
      asc(teamConstraint.id),
    );
}

/** Every team's requests for a season, for the admin view, by team name. */
export async function seasonRequests(
  db: Db,
  seasonId: SeasonId,
): Promise<(StoredRequest & { teamName: string })[]> {
  return db
    .select({ ...columns, teamName: team.name })
    .from(teamConstraint)
    .innerJoin(teamSeason, eq(teamConstraint.teamSeasonId, teamSeason.id))
    .innerJoin(team, eq(teamSeason.teamId, team.id))
    .where(eq(teamSeason.seasonId, seasonId))
    .orderBy(
      asc(team.name),
      asc(teamConstraint.onDate),
      asc(teamConstraint.timeIndex),
      asc(teamConstraint.id),
    );
}

/** How many requests a team has, for the per-team limit. */
export async function requestCount(
  db: Db,
  teamSeasonId: TeamSeasonId,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(teamConstraint)
    .where(eq(teamConstraint.teamSeasonId, teamSeasonId));
  return row?.n ?? 0;
}

/**
 * The season's game times: each time index with the clock time of its first
 * slot, so a captain picks "7:15 pm" rather than a number.
 */
export async function seasonGameTimes(
  db: Db,
  seasonId: SeasonId,
  timeZone: string,
): Promise<{ timeIndex: number; label: string }[]> {
  const rows = await db
    .select({ timeIndex: slot.timeIndex, startsAt: slot.startsAt })
    .from(slot)
    .where(eq(slot.seasonId, seasonId))
    .orderBy(asc(slot.timeIndex), asc(slot.startsAt));
  const clock = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
  const seen = new Map<number, string>();
  for (const row of rows)
    if (!seen.has(row.timeIndex))
      seen.set(row.timeIndex, clock.format(row.startsAt).toLowerCase());
  return [...seen].map(([timeIndex, label]) => ({ timeIndex, label }));
}

/**
 * Saves a checked request and its audit row. Run it in a transaction; the
 * per-team limit is checked again here so two quick submits can't pass it.
 */
export async function addTeamRequest(
  db: Db,
  input: {
    teamSeasonId: TeamSeasonId;
    request: TeamRequest;
    actorId: UserId;
  },
): Promise<Result<TeamConstraintId, "too_many">> {
  await db
    .select({ id: teamSeason.id })
    .from(teamSeason)
    .where(eq(teamSeason.id, input.teamSeasonId))
    .for("update");
  if ((await requestCount(db, input.teamSeasonId)) >= MAX_REQUESTS_PER_TEAM)
    return err("too_many");
  const [row] = await db
    .insert(teamConstraint)
    .values({
      teamSeasonId: input.teamSeasonId,
      kind: input.request.kind,
      onDate: input.request.onDate,
      timeIndex: input.request.timeIndex,
      reason: input.request.reason,
      createdBy: input.actorId,
    })
    .returning({ id: teamConstraint.id });
  if (!row) throw new Error("team request was not saved");
  await recordAudit(db, {
    actorId: input.actorId,
    action: "team_request.add",
    entityType: "team_constraint",
    entityId: row.id,
    after: { teamSeasonId: input.teamSeasonId, ...input.request },
  });
  return ok(row.id);
}

/** Removes one of a team's requests; another team's request is not found. */
export async function removeTeamRequest(
  db: Db,
  input: {
    id: TeamConstraintId;
    teamSeasonId: TeamSeasonId;
    actorId: UserId;
  },
): Promise<Result<void, "not_found">> {
  const [gone] = await db
    .delete(teamConstraint)
    .where(
      and(
        eq(teamConstraint.id, input.id),
        eq(teamConstraint.teamSeasonId, input.teamSeasonId),
      ),
    )
    .returning(columns);
  if (!gone) return err("not_found");
  await recordAudit(db, {
    actorId: input.actorId,
    action: "team_request.remove",
    entityType: "team_constraint",
    entityId: gone.id,
    before: gone,
  });
  return ok(undefined);
}
