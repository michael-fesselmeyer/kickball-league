import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type {
  GameId,
  LeagueId,
  SeasonId,
  SlotId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import {
  type BoardRow,
  checkPick,
  comingGameDay,
  gameDayOf,
  gameResult,
  isLocked,
  type PickemGame,
  type PickError,
  rankBoard,
  type RankedRow,
} from "@/domain/pickem/pickem";
import { user } from "../schema/auth";
import { game, slot } from "../schema/game";
import { league } from "../schema/league";
import { pickemHidden, pickemPick } from "../schema/pickem";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { recordAudit } from "./audit";
import type { Db } from "./schedule";

/**
 * Pick'em (ADR 0044; docs/data-model.md, section 2.5): players predict the
 * winners of the coming game day's games, for bragging rights only. Scores
 * are never stored. Each game's result comes from the game row (only a
 * confirmed result counts), the rules in src/domain/pickem/pickem.ts decide
 * which games scored, and one grouped query per leaderboard counts each
 * player's correct picks among them.
 */

export type SeasonGame = PickemGame & {
  id: GameId;
  slotId: SlotId;
  startsAt: Date;
  teamAId: TeamSeasonId;
  teamBId: TeamSeasonId;
};

const seasonGameColumns = {
  id: game.id,
  status: game.status,
  teamAId: game.teamAId,
  teamBId: game.teamBId,
  slotId: slot.id,
  startsAt: slot.startsAt,
  slotCancelled: sql<boolean>`${slot.status} = 'cancelled'`,
  scoreA: game.scoreA,
  scoreB: game.scoreB,
};

/** A season's games that have a slot, in start order. */
async function seasonGames(db: Db, seasonId: SeasonId): Promise<SeasonGame[]> {
  return db
    .select(seasonGameColumns)
    .from(game)
    .innerJoin(slot, eq(game.slotId, slot.id))
    .where(eq(game.seasonId, seasonId))
    .orderBy(asc(slot.startsAt), asc(game.id));
}

/** The games a pick'em leaderboard counts: confirmed wins only. */
export type Scored = { gameId: GameId; slotId: SlotId; winner: TeamSeasonId };

export function scoredGames(games: readonly SeasonGame[]): Scored[] {
  return games.flatMap((g) => {
    const result = gameResult(g);
    return result.kind === "won"
      ? [
          {
            gameId: g.id,
            slotId: g.slotId,
            winner: result.winner as TeamSeasonId,
          },
        ]
      : [];
  });
}

const shortName = (first: string | null, last: string | null, name: string) =>
  first ? (last ? `${first} ${last.slice(0, 1).toUpperCase()}.` : first) : name;

/**
 * Correct and scored picks per player over the given games, leaving out
 * players who hid themselves. A pick counts only if it was made for the
 * game's current slot, so a pick for a rained-out slot never scores.
 */
export async function leaderboard(
  db: Db,
  scored: readonly Scored[],
): Promise<RankedRow[]> {
  if (scored.length === 0) return [];
  const keys = sql.join(
    scored.map((s) => sql`(${s.gameId}::uuid, ${s.slotId}::uuid)`),
    sql`, `,
  );
  const wins = sql.join(
    scored.map(
      (s) => sql`(${s.gameId}::uuid, ${s.slotId}::uuid, ${s.winner}::uuid)`,
    ),
    sql`, `,
  );
  const rows = await db
    .select({
      userId: pickemPick.userId,
      firstName: profile.firstName,
      lastName: profile.lastName,
      name: user.name,
      correct: sql<number>`(count(*) filter (where (${pickemPick.gameId}, ${pickemPick.slotId}, ${pickemPick.teamSeasonId}) in (${wins})))::int`,
      scored: sql<number>`count(*)::int`,
    })
    .from(pickemPick)
    .innerJoin(user, eq(pickemPick.userId, user.id))
    .leftJoin(profile, eq(profile.userId, pickemPick.userId))
    .leftJoin(pickemHidden, eq(pickemHidden.userId, pickemPick.userId))
    .where(
      and(
        sql`(${pickemPick.gameId}, ${pickemPick.slotId}) in (${keys})`,
        isNull(pickemHidden.userId),
      ),
    )
    .groupBy(pickemPick.userId, profile.firstName, profile.lastName, user.name);
  return rankBoard(
    rows.map((r): BoardRow => ({
      userId: r.userId,
      name: shortName(r.firstName, r.lastName, r.name),
      correct: r.correct,
      scored: r.scored,
    })),
  );
}

/**
 * The season pick'em is about: the one being played (the latest, if two
 * overlap), or else the last one finished.
 */
async function pickemSeason(db: Db, leagueId: LeagueId) {
  const live = sql`${season.status} in ('in_progress', 'playoffs')`;
  const [found] = await db
    .select({
      id: season.id,
      name: season.name,
      timeZone: league.timezone,
      ownGamesAllowed: league.pickemOwnGames,
    })
    .from(season)
    .innerJoin(league, eq(season.leagueId, league.id))
    .where(
      and(
        inArray(season.status, ["in_progress", "playoffs", "completed"]),
        // The league the app is showing (ADR 0048).
        eq(season.leagueId, leagueId),
      ),
    )
    .orderBy(desc(live), desc(season.startsOn))
    .limit(1);
  return found ?? null;
}

/** The player's active teams in a season. */
async function myTeamsIn(
  db: Db,
  userId: UserId,
  seasonIds: readonly SeasonId[],
): Promise<TeamSeasonId[]> {
  if (seasonIds.length === 0) return [];
  const rows = await db
    .select({ id: rosterMembership.teamSeasonId })
    .from(rosterMembership)
    .innerJoin(
      registration,
      eq(rosterMembership.registrationId, registration.id),
    )
    .where(
      and(
        eq(registration.userId, userId),
        inArray(registration.seasonId, seasonIds),
        eq(rosterMembership.status, "active"),
      ),
    );
  return rows.map((r) => r.id);
}

export type DayGame = SeasonGame & {
  teamAName: string;
  teamBName: string;
  myPick: TeamSeasonId | null;
  locked: boolean;
  /** One of the player's teams plays in it. */
  mine: boolean;
};

export type PickemPage = {
  season: { id: SeasonId; name: string; timeZone: string } | null;
  ownGamesAllowed: boolean;
  hidden: boolean;
  /** The coming game day (YYYY-MM-DD) and its games. */
  coming: { day: string; games: DayGame[] } | null;
  /** Game days with at least one scored game, latest first. */
  scoredDays: string[];
  /** The game day whose leaderboard is shown. */
  day: string | null;
  dayBoard: RankedRow[];
  seasonBoard: RankedRow[];
  /** The player's own season record, shown even when hidden. */
  me: { correct: number; scored: number; picks: number };
};

/**
 * Everything the pick'em page shows, in three rounds of queries: the
 * season, then its games, teams, the player's picks and teams and whether
 * they hid themselves, then the two leaderboards.
 */
export async function pickemPage(
  db: Db,
  leagueId: LeagueId,
  userId: UserId,
  now: Date,
  requestedDay: string | null,
): Promise<PickemPage> {
  const current = await pickemSeason(db, leagueId);
  const empty = {
    coming: null,
    scoredDays: [],
    day: null,
    dayBoard: [],
    seasonBoard: [],
    me: { correct: 0, scored: 0, picks: 0 },
  };
  if (!current)
    return {
      season: null,
      ownGamesAllowed: true,
      hidden: await isHidden(db, userId),
      ...empty,
    };
  const [games, teams, mine, myTeams, hidden] = await Promise.all([
    seasonGames(db, current.id),
    db
      .select({ id: teamSeason.id, name: team.name })
      .from(teamSeason)
      .innerJoin(team, eq(teamSeason.teamId, team.id))
      .where(eq(teamSeason.seasonId, current.id)),
    db
      .select({
        gameId: pickemPick.gameId,
        teamSeasonId: pickemPick.teamSeasonId,
        slotId: pickemPick.slotId,
      })
      .from(pickemPick)
      .innerJoin(game, eq(pickemPick.gameId, game.id))
      .where(and(eq(pickemPick.userId, userId), eq(game.seasonId, current.id))),
    myTeamsIn(db, userId, [current.id]),
    isHidden(db, userId),
  ]);
  const { timeZone } = current;
  const names = new Map(teams.map((t) => [t.id as string, t.name]));
  const myPicks = new Map(mine.map((p) => [p.gameId as string, p]));

  const day = comingGameDay(games, now, timeZone);
  const coming = day
    ? {
        day,
        games: games
          .filter((g) => gameDayOf(g.startsAt, timeZone) === day)
          .map((g): DayGame => {
            const pick = myPicks.get(g.id);
            return {
              ...g,
              teamAName: names.get(g.teamAId) ?? "Team A",
              teamBName: names.get(g.teamBId) ?? "Team B",
              // A pick for a slot the game has left no longer stands.
              myPick:
                pick && pick.slotId === g.slotId ? pick.teamSeasonId : null,
              locked: isLocked(g, now),
              mine: myTeams.includes(g.teamAId) || myTeams.includes(g.teamBId),
            };
          }),
      }
    : null;

  const scored = scoredGames(games);
  const dayOfGame = new Map(
    games.map((g) => [g.id as string, gameDayOf(g.startsAt, timeZone)]),
  );
  const scoredDays = [
    ...new Set(scored.map((s) => dayOfGame.get(s.gameId) as string)),
  ].sort((a, b) => b.localeCompare(a));
  const shownDay =
    requestedDay && scoredDays.includes(requestedDay)
      ? requestedDay
      : (scoredDays[0] ?? null);
  const [seasonBoard, dayBoard] = await Promise.all([
    leaderboard(db, scored),
    shownDay
      ? leaderboard(
          db,
          scored.filter((s) => dayOfGame.get(s.gameId) === shownDay),
        )
      : Promise.resolve([]),
  ]);

  // The player's own record, from their picks and the games already read.
  const wins = new Map(scored.map((s) => [s.gameId as string, s]));
  let correct = 0;
  let counted = 0;
  for (const p of mine) {
    const s = wins.get(p.gameId);
    if (!s || s.slotId !== p.slotId) continue;
    counted += 1;
    if (s.winner === p.teamSeasonId) correct += 1;
  }

  return {
    season: { id: current.id, name: current.name, timeZone },
    ownGamesAllowed: current.ownGamesAllowed,
    hidden,
    coming,
    scoredDays,
    day: shownDay,
    dayBoard,
    seasonBoard,
    me: { correct, scored: counted, picks: mine.length },
  };
}

export type SaveResult = {
  saved: number;
  refused: { gameId: GameId; error: PickError | "not_found" }[];
};

/**
 * Saves a player's picks, one per game, replacing earlier ones. Each pick
 * is checked on its own: a game that has started, left its slot or been
 * called off is refused, as is the player's own team's game when the
 * league does not allow it. Accepted picks are tied to the game's slot.
 */
export async function savePicks(
  db: Db,
  input: {
    userId: UserId;
    picks: ReadonlyMap<GameId, TeamSeasonId>;
    now: Date;
  },
): Promise<SaveResult> {
  const ids = [...input.picks.keys()];
  if (ids.length === 0) return { saved: 0, refused: [] };
  const games = await db
    .select({
      ...seasonGameColumns,
      seasonId: game.seasonId,
      ownGamesAllowed: league.pickemOwnGames,
    })
    .from(game)
    .innerJoin(slot, eq(game.slotId, slot.id))
    .innerJoin(season, eq(game.seasonId, season.id))
    .innerJoin(league, eq(season.leagueId, league.id))
    .where(inArray(game.id, ids));
  const myTeams = await myTeamsIn(db, input.userId, [
    ...new Set(games.map((g) => g.seasonId)),
  ]);
  const byId = new Map(games.map((g) => [g.id as string, g]));
  const result: SaveResult = { saved: 0, refused: [] };
  const rows = [];
  for (const [gameId, teamSeasonId] of input.picks) {
    const g = byId.get(gameId);
    if (!g) {
      result.refused.push({ gameId, error: "not_found" });
      continue;
    }
    const check = checkPick(g, teamSeasonId, {
      now: input.now,
      myTeams,
      ownGamesAllowed: g.ownGamesAllowed,
    });
    if (check.ok)
      rows.push({
        gameId,
        userId: input.userId,
        teamSeasonId,
        slotId: g.slotId,
        updatedAt: input.now,
      });
    else result.refused.push({ gameId, error: check.error });
  }
  if (rows.length > 0)
    await db
      .insert(pickemPick)
      .values(rows)
      .onConflictDoUpdate({
        target: [pickemPick.gameId, pickemPick.userId],
        set: {
          teamSeasonId: sql`excluded.team_season_id`,
          slotId: sql`excluded.slot_id`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  result.saved = rows.length;
  return result;
}

export async function isHidden(db: Db, userId: UserId): Promise<boolean> {
  const [row] = await db
    .select({ userId: pickemHidden.userId })
    .from(pickemHidden)
    .where(eq(pickemHidden.userId, userId));
  return row !== undefined;
}

/** A player hides themselves from the leaderboards, or shows themselves again. */
export async function setHidden(
  db: Db,
  userId: UserId,
  hidden: boolean,
): Promise<void> {
  if (hidden)
    await db.insert(pickemHidden).values({ userId }).onConflictDoNothing();
  else await db.delete(pickemHidden).where(eq(pickemHidden.userId, userId));
}

/** Whether players may pick their own team's games (the league's setting). */
export async function ownGamesAllowed(
  db: Db,
  leagueId: LeagueId,
): Promise<boolean> {
  const [row] = await db
    .select({ on: league.pickemOwnGames })
    .from(league)
    .where(eq(league.id, leagueId));
  return row?.on ?? true;
}

/** An admin's choice for the league, audited. */
export async function setOwnGamesAllowed(
  db: Db,
  input: { leagueId: LeagueId; on: boolean; actorId: UserId },
): Promise<void> {
  const [before] = await db
    .select({ on: league.pickemOwnGames })
    .from(league)
    .where(eq(league.id, input.leagueId));
  if (!before || before.on === input.on) return;
  await db
    .update(league)
    .set({ pickemOwnGames: input.on })
    .where(eq(league.id, input.leagueId));
  await recordAudit(db, {
    actorId: input.actorId,
    action: "pickem.own_games",
    entityType: "league",
    entityId: input.leagueId,
    before: { ownGamesAllowed: before.on },
    after: { ownGamesAllowed: input.on },
  });
}

/** For a person's own export: every pick they made, and whether they hid. */
export async function myPickemData(db: Db, userId: UserId) {
  const [picks, hidden] = await Promise.all([
    db
      .select({
        season: season.name,
        gameId: pickemPick.gameId,
        picked: team.name,
        madeAt: pickemPick.createdAt,
        changedAt: pickemPick.updatedAt,
      })
      .from(pickemPick)
      .innerJoin(game, eq(pickemPick.gameId, game.id))
      .innerJoin(season, eq(game.seasonId, season.id))
      .innerJoin(teamSeason, eq(pickemPick.teamSeasonId, teamSeason.id))
      .innerJoin(team, eq(teamSeason.teamId, team.id))
      .where(eq(pickemPick.userId, userId))
      .orderBy(asc(pickemPick.createdAt)),
    isHidden(db, userId),
  ]);
  return { hiddenFromLeaderboards: hidden, picks };
}

/** When a person deletes their account, their picks and choice go too. */
export async function removePickemData(db: Db, userId: UserId): Promise<void> {
  await db.delete(pickemPick).where(eq(pickemPick.userId, userId));
  await db.delete(pickemHidden).where(eq(pickemHidden.userId, userId));
}
