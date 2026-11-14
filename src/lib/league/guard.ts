import { notFound } from "next/navigation";
import { db } from "@/db/client";
import {
  type LeagueRecordKind,
  leaguesOfRecords,
} from "@/db/queries/league-of";
import type { Context, Subject } from "@/domain/authz/permissions";

/** The records an action names, by kind; empty values are skipped. */
export type LeagueRecords = Partial<
  Record<LeagueRecordKind, string | readonly string[] | null | undefined>
>;

/** Whether every named record belongs to `leagueId`. */
export async function allInLeague(
  leagueId: string | null,
  records: LeagueRecords,
): Promise<boolean> {
  const refs = Object.entries(records).flatMap(([kind, ids]) =>
    (typeof ids === "string" ? [ids] : (ids ?? [])).map((id) => ({
      kind: kind as LeagueRecordKind,
      id,
    })),
  );
  if (refs.length === 0) return true;
  if (leagueId === null) return false;
  const leagues = await leaguesOfRecords(db, refs);
  return leagues.every((league) => league === leagueId);
}

/**
 * For a Server Action or page that names records by id: stops with a 404
 * unless every one of them belongs to the league the person's rights were
 * checked in (ADR 0048). An admin of one league can't reach another
 * league's record by putting its id in a form. Call it right after the
 * permission check, with the ids the action is about to use.
 */
export async function requireInLeague(
  subject: Pick<Subject, "leagueId">,
  records: LeagueRecords,
): Promise<void> {
  if (!(await allInLeague(subject.leagueId, records))) notFound();
}

/** The records a permission check's context names (ADR 0048). */
export function recordsOf(context: Context): LeagueRecords {
  return {
    team_season: context.teamSeasonId,
    game: context.game?.id,
    sponsor: context.sponsorId,
  };
}
