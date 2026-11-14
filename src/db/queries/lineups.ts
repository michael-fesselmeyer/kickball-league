import {
  aliasedTable,
  and,
  asc,
  desc,
  eq,
  inArray,
  lt,
  ne,
  sql,
} from "drizzle-orm";
import type { GameId, GameLineupId, TeamSeasonId, UserId } from "@/domain/ids";
import { type Kicker, runBreaks, type Side } from "@/domain/lineup/order";
import { err, ok, type Result } from "@/domain/result";
import { user } from "../schema/auth";
import { field, game, gameRsvp, slot } from "../schema/game";
import { league } from "../schema/league";
import { gameLineup, gameLineupSpot } from "../schema/lineup";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { subClaim, subRequest } from "../schema/subs";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { suspendedAmong } from "./discipline";
import type { Db } from "./schedule";

/** Kicking orders for game day (rulebook 2.2.4; ADR 0030). */

/** "Jo S.": first name and last initial, as on public rosters. */
const shortName = sql<string>`coalesce(${profile.firstName} || coalesce(' ' || left(${profile.lastName}, 1) || '.', ''), nullif(${user.name}, ''), 'A player')`;

const entryA = aliasedTable(teamSeason, "entry_a");
const entryB = aliasedTable(teamSeason, "entry_b");
const teamA = aliasedTable(team, "team_a");
const teamB = aliasedTable(team, "team_b");

/** A game with what the lineup screens need to know about it. */
export async function lineupGame(db: Db, gameId: GameId) {
  const [found] = await db
    .select({
      id: game.id,
      seasonId: game.seasonId,
      seasonSlug: season.slug,
      kind: game.kind,
      status: game.status,
      teamAId: game.teamAId,
      teamBId: game.teamBId,
      teamAName: teamA.name,
      teamBName: teamB.name,
      startsAt: slot.startsAt,
      fieldName: field.name,
      timeZone: league.timezone,
    })
    .from(game)
    .innerJoin(season, eq(game.seasonId, season.id))
    .innerJoin(league, eq(season.leagueId, league.id))
    .innerJoin(entryA, eq(game.teamAId, entryA.id))
    .innerJoin(teamA, eq(entryA.teamId, teamA.id))
    .innerJoin(entryB, eq(game.teamBId, entryB.id))
    .innerJoin(teamB, eq(entryB.teamId, teamB.id))
    .leftJoin(slot, eq(game.slotId, slot.id))
    .leftJoin(field, eq(slot.fieldId, field.id))
    .where(eq(game.id, gameId));
  return found ?? null;
}

export type LineupGame = NonNullable<Awaited<ReturnType<typeof lineupGame>>>;

const OVER = ["final", "forfeit", "cancelled"] as const;
const isOver = (status: string) => OVER.some((s) => s === status);

/**
 * Who can kick for a team in a game: its active players who said they're
 * in, by name, then its approved pickups in the order they claimed. A
 * player suspended right now is left out, as from every way into a game
 * (ADR 0026). Each carries their lineup gender, which
 * only the team's captains and admins may see.
 */
export async function lineupCandidates(
  db: Db,
  gameId: GameId,
  teamSeasonId: TeamSeasonId,
  now: Date,
): Promise<Kicker<UserId>[]> {
  const [regulars, pickups] = await Promise.all([
    db
      .select({
        id: registration.userId,
        name: shortName,
        side: profile.lineupGender,
      })
      .from(gameRsvp)
      .innerJoin(registration, eq(registration.userId, gameRsvp.userId))
      .innerJoin(
        rosterMembership,
        and(
          eq(rosterMembership.registrationId, registration.id),
          eq(rosterMembership.teamSeasonId, teamSeasonId),
          eq(rosterMembership.status, "active"),
        ),
      )
      .innerJoin(user, eq(user.id, registration.userId))
      .leftJoin(profile, eq(profile.userId, registration.userId))
      .where(
        and(
          eq(gameRsvp.gameId, gameId),
          eq(gameRsvp.teamSeasonId, teamSeasonId),
          eq(gameRsvp.status, "in"),
        ),
      )
      .orderBy(asc(shortName), asc(registration.userId)),
    db
      .select({
        id: subClaim.userId,
        name: shortName,
        side: subClaim.lineupGender,
      })
      .from(subClaim)
      .innerJoin(subRequest, eq(subClaim.subRequestId, subRequest.id))
      .innerJoin(user, eq(user.id, subClaim.userId))
      .leftJoin(profile, eq(profile.userId, subClaim.userId))
      .where(
        and(
          eq(subRequest.gameId, gameId),
          eq(subRequest.teamSeasonId, teamSeasonId),
          ne(subRequest.status, "cancelled"),
          eq(subClaim.status, "approved"),
        ),
      )
      .orderBy(asc(subClaim.claimedAt)),
  ]);
  const suspended = await suspendedAmong(
    db,
    [...regulars, ...pickups].map((r) => r.id),
    now,
  );
  const seen = new Set<UserId>(suspended.keys());
  const once = <T extends { id: UserId }>(rows: T[]) =>
    rows.filter((r) => !seen.has(r.id) && seen.add(r.id));
  const side = (s: Side | undefined): Side => s ?? null;
  return [
    ...once(regulars).map((r) => ({ ...r, side: side(r.side), pickup: false })),
    ...once(pickups).map((r) => ({ ...r, side: side(r.side), pickup: true })),
  ];
}

export type SavedSpot = {
  userId: UserId;
  name: string;
  pickup: boolean;
  position: number;
};

export type SavedLineup = {
  id: GameLineupId;
  teamSeasonId: TeamSeasonId;
  runBreaks: number;
  savedAt: Date;
  spots: SavedSpot[];
};

/** The saved orders for a game, by team, names only. */
export async function savedLineups(
  db: Db,
  gameId: GameId,
): Promise<Map<TeamSeasonId, SavedLineup>> {
  const rows = await db
    .select({
      id: gameLineup.id,
      teamSeasonId: gameLineup.teamSeasonId,
      runBreaks: gameLineup.runBreaks,
      savedAt: gameLineup.updatedAt,
      userId: gameLineupSpot.userId,
      name: shortName,
      pickup: gameLineupSpot.pickup,
      position: gameLineupSpot.position,
    })
    .from(gameLineup)
    .innerJoin(gameLineupSpot, eq(gameLineupSpot.lineupId, gameLineup.id))
    .innerJoin(user, eq(user.id, gameLineupSpot.userId))
    .leftJoin(profile, eq(profile.userId, gameLineupSpot.userId))
    .where(eq(gameLineup.gameId, gameId))
    .orderBy(asc(gameLineup.teamSeasonId), asc(gameLineupSpot.position));
  const result = new Map<TeamSeasonId, SavedLineup>();
  for (const r of rows) {
    const found = result.get(r.teamSeasonId) ?? {
      id: r.id,
      teamSeasonId: r.teamSeasonId,
      runBreaks: r.runBreaks,
      savedAt: r.savedAt,
      spots: [],
    };
    found.spots.push({
      userId: r.userId,
      name: r.name,
      pickup: r.pickup,
      position: r.position,
    });
    result.set(r.teamSeasonId, found);
  }
  return result;
}

/**
 * The order the team saved for its latest game before this one, as user
 * ids, or null when it has none.
 */
export async function previousLineup(
  db: Db,
  gameId: GameId,
  teamSeasonId: TeamSeasonId,
): Promise<{ gameId: GameId; order: UserId[] } | null> {
  const thisGame = aliasedTable(game, "this_game");
  const thisSlot = aliasedTable(slot, "this_slot");
  const [latest] = await db
    .select({ id: gameLineup.id, gameId: gameLineup.gameId })
    .from(gameLineup)
    .innerJoin(game, eq(game.id, gameLineup.gameId))
    .innerJoin(slot, eq(slot.id, game.slotId))
    .innerJoin(thisGame, eq(thisGame.id, gameId))
    .innerJoin(thisSlot, eq(thisSlot.id, thisGame.slotId))
    .where(
      and(
        eq(gameLineup.teamSeasonId, teamSeasonId),
        ne(gameLineup.gameId, gameId),
        lt(slot.startsAt, thisSlot.startsAt),
      ),
    )
    .orderBy(desc(slot.startsAt))
    .limit(1);
  if (!latest) return null;
  const spots = await db
    .select({ userId: gameLineupSpot.userId })
    .from(gameLineupSpot)
    .where(eq(gameLineupSpot.lineupId, latest.id))
    .orderBy(asc(gameLineupSpot.position));
  return { gameId: latest.gameId, order: spots.map((s) => s.userId) };
}

export type SaveLineupError =
  "not_your_game" | "game_over" | "empty" | "not_available" | "repeated";

/**
 * Saves a team's kicking order, replacing the one before. Every kicker must
 * be available (in, or an approved pickup, and not suspended) and appear
 * once. An order that
 * breaks the rule is still saved, with the count of breaks, because the
 * site warns and the ref decides.
 */
export async function saveLineup(
  db: Db,
  input: {
    gameId: GameId;
    teamSeasonId: TeamSeasonId;
    order: readonly UserId[];
    savedBy: UserId;
    now: Date;
  },
): Promise<Result<{ runBreaks: number }, SaveLineupError>> {
  const g = await lineupGame(db, input.gameId);
  if (!g || ![g.teamAId, g.teamBId].includes(input.teamSeasonId))
    return err("not_your_game");
  if (isOver(g.status)) return err("game_over");
  if (input.order.length === 0) return err("empty");
  if (new Set(input.order).size !== input.order.length) return err("repeated");
  const candidates = await lineupCandidates(
    db,
    input.gameId,
    input.teamSeasonId,
    input.now,
  );
  const byId = new Map(candidates.map((k) => [k.id, k]));
  const order = input.order.flatMap((id) => {
    const k = byId.get(id);
    return k ? [k] : [];
  });
  if (order.length !== input.order.length) return err("not_available");
  const breaks = runBreaks(order).length;
  await db.transaction(async (tx) => {
    const [saved] = await tx
      .insert(gameLineup)
      .values({
        gameId: input.gameId,
        teamSeasonId: input.teamSeasonId,
        runBreaks: breaks,
        createdBy: input.savedBy,
        updatedBy: input.savedBy,
      })
      .onConflictDoUpdate({
        target: [gameLineup.gameId, gameLineup.teamSeasonId],
        set: {
          runBreaks: breaks,
          updatedBy: input.savedBy,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: gameLineup.id });
    if (!saved) throw new Error("The lineup row was not written");
    await tx
      .delete(gameLineupSpot)
      .where(eq(gameLineupSpot.lineupId, saved.id));
    await tx.insert(gameLineupSpot).values(
      order.map((k, i) => ({
        lineupId: saved.id,
        position: i + 1,
        userId: k.id,
        pickup: k.pickup,
      })),
    );
  });
  return ok({ runBreaks: breaks });
}

/** A player's place in their team's saved order. */
export type MySpot = { position: number; of: number };

/** Where a person kicks in each of the given games, where an order is saved. */
export async function mySpots(
  db: Db,
  userId: UserId,
  gameIds: readonly GameId[],
): Promise<Map<GameId, MySpot>> {
  if (gameIds.length === 0) return new Map();
  const sizes = db
    .select({
      lineupId: gameLineupSpot.lineupId,
      size: sql<number>`count(*)::int`.as("size"),
    })
    .from(gameLineupSpot)
    .groupBy(gameLineupSpot.lineupId)
    .as("sizes");
  const rows = await db
    .select({
      gameId: gameLineup.gameId,
      // Counted, not read, so a gap left by a deleted account doesn't show.
      position: sql<number>`(select count(*) from ${gameLineupSpot} as earlier where earlier.lineup_id = ${gameLineupSpot.lineupId} and earlier.position <= ${gameLineupSpot.position})::int`,
      of: sizes.size,
    })
    .from(gameLineupSpot)
    .innerJoin(gameLineup, eq(gameLineup.id, gameLineupSpot.lineupId))
    .innerJoin(sizes, eq(sizes.lineupId, gameLineup.id))
    .where(
      and(
        eq(gameLineupSpot.userId, userId),
        inArray(gameLineup.gameId, [...gameIds]),
      ),
    );
  return new Map(
    rows.map((r) => [r.gameId, { position: r.position, of: r.of }]),
  );
}

/** Which of the given games already have a saved order from this team. */
export async function savedFor(
  db: Db,
  teamSeasonId: TeamSeasonId,
  gameIds: readonly GameId[],
): Promise<Set<GameId>> {
  if (gameIds.length === 0) return new Set();
  const rows = await db
    .select({ gameId: gameLineup.gameId })
    .from(gameLineup)
    .where(
      and(
        eq(gameLineup.teamSeasonId, teamSeasonId),
        inArray(gameLineup.gameId, [...gameIds]),
      ),
    );
  return new Set(rows.map((r) => r.gameId));
}

/** The game's two teams, for checking a team belongs to it. */
export const teamsOf = (g: { teamAId: TeamSeasonId; teamBId: TeamSeasonId }) =>
  [g.teamAId, g.teamBId] as const;
