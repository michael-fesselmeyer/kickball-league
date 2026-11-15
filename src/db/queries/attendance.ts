import { and, asc, count, eq, inArray, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { GameId, SeasonId, TeamSeasonId, UserId } from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import { gameAttendance } from "../schema/attendance";
import { user } from "../schema/auth";
import { game, slot } from "../schema/game";
import { league } from "../schema/league";
import { season } from "../schema/season";
import { subClaim, subRequest } from "../schema/subs";
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
 * Field check-in (src/domain/attendance/attendance.ts, ADR 0063): who
 * played in each game, and how many games each player has played this
 * season. Permission checks happen in the page or action that calls these.
 */

const teamA = alias(teamSeason, "attendance_team_a");
const teamB = alias(teamSeason, "attendance_team_b");
const nameA = alias(team, "attendance_name_a");
const nameB = alias(team, "attendance_name_b");

/** A game as check-in reads it. One query. */
export async function attendanceGame(db: Db, gameId: GameId) {
  const [found] = await db
    .select({
      id: game.id,
      seasonId: game.seasonId,
      seasonSlug: season.slug,
      waiverId: season.waiverId,
      status: game.status,
      teamAId: game.teamAId,
      teamBId: game.teamBId,
      teamAName: nameA.name,
      teamBName: nameB.name,
      startsAt: slot.startsAt,
      timeZone: league.timezone,
    })
    .from(game)
    .innerJoin(season, eq(game.seasonId, season.id))
    .innerJoin(league, eq(season.leagueId, league.id))
    .innerJoin(teamA, eq(game.teamAId, teamA.id))
    .innerJoin(nameA, eq(teamA.teamId, nameA.id))
    .innerJoin(teamB, eq(game.teamBId, teamB.id))
    .innerJoin(nameB, eq(teamB.teamId, nameB.id))
    .leftJoin(slot, eq(game.slotId, slot.id))
    .where(eq(game.id, gameId));
  return found ?? null;
}

export type AttendanceGameRow = NonNullable<
  Awaited<ReturnType<typeof attendanceGame>>
>;

type GameSides = Pick<AttendanceGameRow, "id" | "teamAId" | "teamBId">;

/**
 * Who may play in the game, for which team: both teams' active players,
 * then the subs approved for this game. A player on both lists counts for
 * their own team. Two queries, in parallel.
 */
async function eligiblePlayers(
  db: Db,
  g: GameSides,
  only?: UserId,
): Promise<
  { userId: UserId; name: string; teamSeasonId: TeamSeasonId; sub: boolean }[]
> {
  const [members, subs] = await Promise.all([
    db
      .select({
        userId: registration.userId,
        name: user.name,
        teamSeasonId: rosterMembership.teamSeasonId,
      })
      .from(rosterMembership)
      .innerJoin(
        registration,
        eq(rosterMembership.registrationId, registration.id),
      )
      .innerJoin(user, eq(registration.userId, user.id))
      .where(
        and(
          inArray(rosterMembership.teamSeasonId, [g.teamAId, g.teamBId]),
          eq(rosterMembership.status, "active"),
          only ? eq(registration.userId, only) : undefined,
        ),
      )
      .orderBy(asc(user.name)),
    db
      .select({
        userId: subClaim.userId,
        name: user.name,
        teamSeasonId: subRequest.teamSeasonId,
      })
      .from(subClaim)
      .innerJoin(subRequest, eq(subClaim.subRequestId, subRequest.id))
      .innerJoin(user, eq(subClaim.userId, user.id))
      .where(
        and(
          eq(subRequest.gameId, g.id),
          eq(subClaim.status, "approved"),
          only ? eq(subClaim.userId, only) : undefined,
        ),
      )
      .orderBy(asc(user.name)),
  ]);
  const seen = new Set<UserId>();
  const everyone = [];
  for (const p of [
    ...members.map((m) => ({ ...m, sub: false })),
    ...subs.map((s) => ({ ...s, sub: true })),
  ]) {
    if (seen.has(p.userId)) continue;
    seen.add(p.userId);
    everyone.push(p);
  }
  return everyone;
}

export type GamePerson = {
  userId: UserId;
  name: string;
  teamSeasonId: TeamSeasonId;
  /** A sub or pickup approved for this game only. */
  sub: boolean;
  checkedIn: { method: "scan" | "marked"; at: Date } | null;
  /** Signed the season's current waiver. */
  waiverSigned: boolean;
};

/**
 * Everyone who may play in the game, and whether each is checked in and
 * has signed the season's current waiver. Someone checked in who has since
 * left the roster still shows, so the record reads as it was. Four queries
 * in two rounds.
 */
export async function gameAttendanceList(
  db: Db,
  g: Pick<
    AttendanceGameRow,
    "id" | "teamAId" | "teamBId" | "seasonId" | "waiverId"
  >,
): Promise<GamePerson[]> {
  const [eligible, rows] = await Promise.all([
    eligiblePlayers(db, g),
    db
      .select({
        userId: gameAttendance.userId,
        name: user.name,
        teamSeasonId: gameAttendance.teamSeasonId,
        method: gameAttendance.method,
        at: gameAttendance.recordedAt,
      })
      .from(gameAttendance)
      .innerJoin(user, eq(gameAttendance.userId, user.id))
      .where(eq(gameAttendance.gameId, g.id)),
  ]);
  const byUser = new Map(rows.map((r) => [r.userId, r]));
  const listed = new Set(eligible.map((p) => p.userId));
  const people = [
    ...eligible.map((p) => {
      const row = byUser.get(p.userId);
      return {
        ...p,
        // The team they checked in for is the one their row records.
        teamSeasonId: row?.teamSeasonId ?? p.teamSeasonId,
      };
    }),
    ...rows
      .filter((r) => !listed.has(r.userId))
      .map((r) => ({
        userId: r.userId,
        name: r.name,
        teamSeasonId: r.teamSeasonId,
        sub: false,
      })),
  ];
  const signed =
    g.waiverId === null || people.length === 0
      ? []
      : await db
          .select({ userId: waiverSignature.userId })
          .from(waiverSignature)
          .where(
            and(
              eq(waiverSignature.seasonId, g.seasonId),
              eq(waiverSignature.waiverId, g.waiverId),
              inArray(
                waiverSignature.userId,
                people.map((p) => p.userId),
              ),
            ),
          );
  const signedBy = new Set(signed.map((s) => s.userId));
  return people.map((p) => {
    const row = byUser.get(p.userId);
    return {
      ...p,
      checkedIn: row ? { method: row.method, at: row.at } : null,
      waiverSigned: signedBy.has(p.userId),
    };
  });
}

export type ScanResult = { first: boolean; teamSeasonId: TeamSeasonId };

/**
 * A player checks themselves in by scanning the game's code. Only someone
 * on either roster or approved to sub in this game can, for the team they
 * play for; a second scan changes nothing. The caller has checked the code
 * and the window.
 */
export async function checkInByScan(
  db: Db,
  input: { game: GameSides; userId: UserId; now: Date },
): Promise<Result<ScanResult, "not_playing">> {
  const [me] = await eligiblePlayers(db, input.game, input.userId);
  if (!me) return err("not_playing");
  const inserted = await db
    .insert(gameAttendance)
    .values({
      gameId: input.game.id,
      userId: input.userId,
      teamSeasonId: me.teamSeasonId,
      method: "scan",
      recordedBy: input.userId,
      recordedAt: input.now,
    })
    .onConflictDoNothing()
    .returning({ teamSeasonId: gameAttendance.teamSeasonId });
  return ok({ first: inserted.length > 0, teamSeasonId: me.teamSeasonId });
}

/**
 * A captain, the ref or an admin sets who played: ticks people in and out.
 * `people` is the game's list as the form showed it, and `wanted` the ids
 * ticked (already checked against it). Rows for people not ticked come off;
 * scans included, so a captain can correct a scan made from the stands.
 * One `attendance.mark` audit row records who was added and removed. Call
 * inside a transaction.
 */
export async function saveAttendance(
  tx: Db,
  input: {
    gameId: GameId;
    people: readonly Pick<
      GamePerson,
      "userId" | "teamSeasonId" | "checkedIn"
    >[];
    add: readonly string[];
    remove: readonly string[];
    actorId: UserId;
    now: Date;
  },
): Promise<{ added: number; removed: number }> {
  const teamOf = new Map(input.people.map((p) => [p.userId, p.teamSeasonId]));
  const add = input.people.filter(
    (p) => input.add.includes(p.userId) && teamOf.has(p.userId),
  );
  const remove = input.remove.filter((id) => teamOf.has(id as UserId));
  if (add.length === 0 && remove.length === 0) return { added: 0, removed: 0 };
  const added =
    add.length === 0
      ? []
      : await tx
          .insert(gameAttendance)
          .values(
            add.map((p) => ({
              gameId: input.gameId,
              userId: p.userId,
              teamSeasonId: p.teamSeasonId,
              method: "marked" as const,
              recordedBy: input.actorId,
              recordedAt: input.now,
            })),
          )
          .onConflictDoNothing()
          .returning({ userId: gameAttendance.userId });
  const removed =
    remove.length === 0
      ? []
      : await tx
          .delete(gameAttendance)
          .where(
            and(
              eq(gameAttendance.gameId, input.gameId),
              inArray(gameAttendance.userId, remove as UserId[]),
            ),
          )
          .returning({ userId: gameAttendance.userId });
  if (added.length > 0 || removed.length > 0)
    await recordAudit(tx, {
      actorId: input.actorId,
      action: "attendance.mark",
      entityType: "game",
      entityId: input.gameId,
      after: {
        added: added.map((r) => r.userId).sort(),
        removed: removed.map((r) => r.userId).sort(),
      },
    });
  return { added: added.length, removed: removed.length };
}

/**
 * Games each of `userIds` has played this season, for any team. Players
 * with none are left out.
 */
async function seasonGamesPlayed(
  db: Db,
  seasonId: SeasonId,
  userIds: readonly UserId[],
): Promise<Map<UserId, number>> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({ userId: gameAttendance.userId, played: count() })
    .from(gameAttendance)
    .innerJoin(game, eq(gameAttendance.gameId, game.id))
    .where(
      and(
        eq(game.seasonId, seasonId),
        inArray(gameAttendance.userId, [...userIds]),
      ),
    )
    .groupBy(gameAttendance.userId);
  return new Map(rows.map((r) => [r.userId, r.played]));
}

export type TeamAttendance = {
  playoffMinGames: number | null;
  games: { id: GameId; startsAt: Date | null; opponent: string }[];
  players: {
    userId: UserId;
    name: string;
    /** Games of this team they checked in for. */
    gameIds: GameId[];
    /** Games played this season, for any team. */
    played: number;
  }[];
  /** Subs and pickups who played for this team. */
  subs: { userId: UserId; name: string; gameIds: GameId[] }[];
};

const opponentName = alias(team, "attendance_opponent");
const opponentEntry = alias(teamSeason, "attendance_opponent_entry");

/**
 * One team's attendance this season, for its captains and admins: each of
 * its games, who played in it, and each active player's games played for
 * the season's playoff minimum. Five queries in three rounds.
 */
export async function teamAttendance(
  db: Db,
  input: { teamSeasonId: TeamSeasonId; seasonId: SeasonId },
): Promise<TeamAttendance> {
  const { teamSeasonId, seasonId } = input;
  const [settings, games, roster, rows] = await Promise.all([
    db
      .select({ playoffMinGames: season.playoffMinGames })
      .from(season)
      .where(eq(season.id, seasonId)),
    db
      .select({
        id: game.id,
        startsAt: slot.startsAt,
        opponent: opponentName.name,
      })
      .from(game)
      .innerJoin(
        opponentEntry,
        or(
          and(
            eq(game.teamAId, teamSeasonId),
            eq(opponentEntry.id, game.teamBId),
          ),
          and(
            eq(game.teamBId, teamSeasonId),
            eq(opponentEntry.id, game.teamAId),
          ),
        ),
      )
      .innerJoin(opponentName, eq(opponentEntry.teamId, opponentName.id))
      .leftJoin(slot, eq(game.slotId, slot.id))
      .where(
        and(
          eq(game.seasonId, seasonId),
          inArray(game.status, [
            "scheduled",
            "in_progress",
            "final",
            "forfeit",
          ]),
        ),
      )
      .orderBy(asc(slot.startsAt)),
    db
      .select({ userId: registration.userId, name: user.name })
      .from(rosterMembership)
      .innerJoin(
        registration,
        eq(rosterMembership.registrationId, registration.id),
      )
      .innerJoin(user, eq(registration.userId, user.id))
      .where(
        and(
          eq(rosterMembership.teamSeasonId, teamSeasonId),
          eq(rosterMembership.status, "active"),
        ),
      )
      .orderBy(asc(user.name)),
    db
      .select({
        userId: gameAttendance.userId,
        name: user.name,
        gameId: gameAttendance.gameId,
      })
      .from(gameAttendance)
      .innerJoin(user, eq(gameAttendance.userId, user.id))
      .where(eq(gameAttendance.teamSeasonId, teamSeasonId)),
  ]);
  const played = await seasonGamesPlayed(
    db,
    seasonId,
    roster.map((p) => p.userId),
  );
  const gamesOf = new Map<UserId, GameId[]>();
  const names = new Map<UserId, string>();
  for (const r of rows) {
    gamesOf.set(r.userId, [...(gamesOf.get(r.userId) ?? []), r.gameId]);
    names.set(r.userId, r.name);
  }
  const onRoster = new Set(roster.map((p) => p.userId));
  return {
    playoffMinGames: settings[0]?.playoffMinGames ?? null,
    games,
    players: roster.map((p) => ({
      userId: p.userId,
      name: p.name,
      gameIds: gamesOf.get(p.userId) ?? [],
      played: played.get(p.userId) ?? 0,
    })),
    subs: [...gamesOf.entries()]
      .filter(([userId]) => !onRoster.has(userId))
      .map(([userId, gameIds]) => ({
        userId,
        name: names.get(userId) ?? "",
        gameIds,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export type SeasonAttendanceRow = {
  teamSeasonId: TeamSeasonId;
  teamName: string;
  players: { userId: UserId; name: string; played: number }[];
};

/**
 * Every team's active players this season with their games played, for
 * admins checking playoff eligibility. Three queries in two rounds.
 */
export async function seasonAttendance(
  db: Db,
  seasonId: SeasonId,
): Promise<{ playoffMinGames: number | null; teams: SeasonAttendanceRow[] }> {
  const [settings, roster] = await Promise.all([
    db
      .select({ playoffMinGames: season.playoffMinGames })
      .from(season)
      .where(eq(season.id, seasonId)),
    db
      .select({
        teamSeasonId: teamSeason.id,
        teamName: team.name,
        userId: registration.userId,
        name: user.name,
      })
      .from(rosterMembership)
      .innerJoin(teamSeason, eq(rosterMembership.teamSeasonId, teamSeason.id))
      .innerJoin(team, eq(teamSeason.teamId, team.id))
      .innerJoin(
        registration,
        eq(rosterMembership.registrationId, registration.id),
      )
      .innerJoin(user, eq(registration.userId, user.id))
      .where(
        and(
          eq(teamSeason.seasonId, seasonId),
          eq(rosterMembership.status, "active"),
        ),
      )
      .orderBy(asc(team.name), asc(user.name)),
  ]);
  const played = await seasonGamesPlayed(
    db,
    seasonId,
    roster.map((r) => r.userId),
  );
  const teams = new Map<TeamSeasonId, SeasonAttendanceRow>();
  for (const r of roster) {
    const row = teams.get(r.teamSeasonId) ?? {
      teamSeasonId: r.teamSeasonId,
      teamName: r.teamName,
      players: [],
    };
    row.players.push({
      userId: r.userId,
      name: r.name,
      played: played.get(r.userId) ?? 0,
    });
    teams.set(r.teamSeasonId, row);
  }
  return {
    playoffMinGames: settings[0]?.playoffMinGames ?? null,
    teams: [...teams.values()],
  };
}

/** Whether a player is checked in for a game, and for which team. */
export async function checkedInFor(
  db: Db,
  gameId: GameId,
  userId: UserId,
): Promise<{ teamSeasonId: TeamSeasonId } | null> {
  const [row] = await db
    .select({ teamSeasonId: gameAttendance.teamSeasonId })
    .from(gameAttendance)
    .where(
      and(eq(gameAttendance.gameId, gameId), eq(gameAttendance.userId, userId)),
    );
  return row ?? null;
}
