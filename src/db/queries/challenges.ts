import { and, asc, eq, notInArray, sql } from "drizzle-orm";
import {
  type ChallengeInput,
  rankTeams,
  type RankedTeam,
  type RosterSpot,
  teamProgress,
  type TeamProgress,
} from "@/domain/drive/challenge";
import type {
  SeasonId,
  SignupChallengeId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import { signupChallenge } from "../schema/drive";
import { season } from "../schema/season";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { waiverSignature } from "../schema/waiver";
import { recordAudit } from "./audit";
import type { Db } from "./schedule";

/**
 * The team sign-up challenge (src/domain/drive/challenge.ts, ADR 0035).
 * Progress comes from the rosters, read in one query per season; nothing
 * about it is stored until an admin confirms a winner. Team names and
 * counts only: no player's name leaves this file.
 */

export type Challenge = ChallengeInput & {
  id: SignupChallengeId;
  seasonId: SeasonId;
  winnerTeamSeasonId: TeamSeasonId | null;
  winnerCompletedAt: Date | null;
  confirmedAt: Date | null;
};

export async function challengeForSeason(
  db: Db,
  seasonId: SeasonId,
): Promise<Challenge | null> {
  const [found] = await db
    .select({
      id: signupChallenge.id,
      seasonId: signupChallenge.seasonId,
      prize: signupChallenge.prize,
      deadline: signupChallenge.deadline,
      winnerTeamSeasonId: signupChallenge.winnerTeamSeasonId,
      winnerCompletedAt: signupChallenge.winnerCompletedAt,
      confirmedAt: signupChallenge.confirmedAt,
    })
    .from(signupChallenge)
    .where(eq(signupChallenge.seasonId, seasonId));
  return found ?? null;
}

/** Starts a season's challenge, or changes it until a winner is confirmed. */
export async function saveChallenge(
  db: Db,
  input: { seasonId: SeasonId; challenge: ChallengeInput; actorId: UserId },
): Promise<Result<"started" | "updated", "confirmed">> {
  const [before] = await db
    .select({
      id: signupChallenge.id,
      prize: signupChallenge.prize,
      deadline: signupChallenge.deadline,
      confirmedAt: signupChallenge.confirmedAt,
    })
    .from(signupChallenge)
    .where(eq(signupChallenge.seasonId, input.seasonId))
    .for("update");
  if (before?.confirmedAt) return err("confirmed");
  if (before) {
    await db
      .update(signupChallenge)
      .set(input.challenge)
      .where(eq(signupChallenge.id, before.id));
    await recordAudit(db, {
      actorId: input.actorId,
      action: "challenge.update",
      entityType: "signup_challenge",
      entityId: before.id,
      before: { prize: before.prize, deadline: before.deadline },
      after: input.challenge,
    });
    return ok("updated");
  }
  const [created] = await db
    .insert(signupChallenge)
    .values({
      seasonId: input.seasonId,
      ...input.challenge,
      createdBy: input.actorId,
    })
    .onConflictDoNothing({ target: signupChallenge.seasonId })
    .returning({ id: signupChallenge.id });
  // Another admin started it a moment ago: save over theirs next time.
  if (!created) return saveChallenge(db, input);
  await recordAudit(db, {
    actorId: input.actorId,
    action: "challenge.start",
    entityType: "signup_challenge",
    entityId: created.id,
    after: { seasonId: input.seasonId, ...input.challenge },
  });
  return ok("started");
}

export type TeamSignups = {
  teamSeasonId: TeamSeasonId;
  name: string;
  color: string | null;
  progress: TeamProgress;
};

const toDate = (v: string | Date | null) => (v === null ? null : new Date(v));

/** Teams out of the season don't count. */
const OUT = ["withdrawn", "waitlisted"] as const;

/**
 * Every team's sign-up progress in a season, in one query: each active
 * roster spot with when they joined and when they signed the season's
 * waiver. A spot whose registration is past the waiver step but has no
 * signature row (an admin moved it on) counts as signed when it joined.
 */
export async function seasonSignups(
  db: Db,
  seasonId: SeasonId,
): Promise<TeamSignups[]> {
  const rows = await db
    .select({
      teamSeasonId: teamSeason.id,
      name: team.name,
      color: team.colorHex,
      target: teamSeason.targetRosterSize,
      rosterMin: season.rosterMin,
      spotId: rosterMembership.id,
      joinedAt:
        sql<Date | null>`coalesce(${rosterMembership.startedAt}, ${rosterMembership.createdAt})`.mapWith(
          toDate,
        ),
      signedAt:
        sql<Date | null>`coalesce(${waiverSignature.signedAt}, case when ${registration.status} <> 'pending_waiver' then coalesce(${rosterMembership.startedAt}, ${rosterMembership.createdAt}) end)`.mapWith(
          toDate,
        ),
    })
    .from(teamSeason)
    .innerJoin(team, eq(team.id, teamSeason.teamId))
    .innerJoin(season, eq(season.id, teamSeason.seasonId))
    .leftJoin(
      rosterMembership,
      and(
        eq(rosterMembership.teamSeasonId, teamSeason.id),
        eq(rosterMembership.status, "active"),
      ),
    )
    .leftJoin(
      registration,
      eq(registration.id, rosterMembership.registrationId),
    )
    .leftJoin(
      waiverSignature,
      eq(waiverSignature.id, registration.waiverSignatureId),
    )
    .where(
      and(
        eq(teamSeason.seasonId, seasonId),
        notInArray(teamSeason.status, [...OUT]),
      ),
    )
    .orderBy(asc(team.name));
  const teams = new Map<
    TeamSeasonId,
    {
      name: string;
      color: string | null;
      expected: number;
      spots: RosterSpot[];
    }
  >();
  for (const r of rows) {
    const t = teams.get(r.teamSeasonId) ?? {
      name: r.name,
      color: r.color,
      expected: r.target ?? r.rosterMin,
      spots: [],
    };
    if (r.spotId !== null && r.joinedAt !== null)
      t.spots.push({ joinedAt: r.joinedAt, signedAt: r.signedAt });
    teams.set(r.teamSeasonId, t);
  }
  return [...teams].map(([teamSeasonId, t]) => ({
    teamSeasonId,
    name: t.name,
    color: t.color,
    progress: teamProgress(t.spots, t.expected),
  }));
}

/** The season's leaderboard, ranked by the challenge's rules. */
export async function challengeStandings(
  db: Db,
  challenge: Pick<Challenge, "seasonId" | "deadline">,
): Promise<RankedTeam<TeamSignups>[]> {
  return rankTeams(
    await seasonSignups(db, challenge.seasonId),
    challenge.deadline,
  );
}

export type ConfirmError =
  "not_found" | "confirmed" | "not_complete" | "not_first";

/**
 * An admin confirms the winner: a team that completed its roster by the
 * deadline and is at the top of the board (a dead heat at the top is the
 * admin's call between the tied teams). The standings at that moment go
 * into the audit row, team ids and counts only.
 */
export async function confirmChallengeWinner(
  db: Db,
  input: {
    seasonId: SeasonId;
    teamSeasonId: TeamSeasonId;
    actorId: UserId;
    now: Date;
  },
): Promise<Result<void, ConfirmError>> {
  const [c] = await db
    .select({
      id: signupChallenge.id,
      deadline: signupChallenge.deadline,
      confirmedAt: signupChallenge.confirmedAt,
    })
    .from(signupChallenge)
    .where(eq(signupChallenge.seasonId, input.seasonId))
    .for("update");
  if (!c) return err("not_found");
  if (c.confirmedAt !== null) return err("confirmed");
  const ranked = await challengeStandings(db, {
    seasonId: input.seasonId,
    deadline: c.deadline,
  });
  const pick = ranked.find((t) => t.teamSeasonId === input.teamSeasonId);
  if (!pick?.qualifies || pick.progress.completedAt === null)
    return err("not_complete");
  if (pick.rank !== 1) return err("not_first");
  await db
    .update(signupChallenge)
    .set({
      winnerTeamSeasonId: pick.teamSeasonId,
      winnerCompletedAt: pick.progress.completedAt,
      confirmedAt: input.now,
      confirmedBy: input.actorId,
    })
    .where(eq(signupChallenge.id, c.id));
  await recordAudit(db, {
    actorId: input.actorId,
    action: "challenge.confirm",
    entityType: "signup_challenge",
    entityId: c.id,
    after: {
      winner: pick.teamSeasonId,
      completedAt: pick.progress.completedAt,
      deadline: c.deadline,
      standings: ranked.map((t) => ({
        teamSeasonId: t.teamSeasonId,
        rank: t.rank,
        signedUp: t.progress.signedUp,
        of: t.progress.of,
        completedAt: t.progress.completedAt,
      })),
    },
  });
  return ok(undefined);
}
