import { and, eq, inArray, or } from "drizzle-orm";
import type { GameId, TeamSeasonId, UserId } from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import {
  checkFielding,
  type FieldingCheck,
  type FieldingRules,
  RULEBOOK,
} from "@/domain/rsvp/fielding";
import { game, gameRsvp } from "../schema/game";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { registration, rosterMembership } from "../schema/team";
import type { Db } from "./schedule";

/** Game-day RSVPs (roadmap week 5). */

export type RsvpStatus = "in" | "out" | "maybe";

export type RsvpError = "not_your_game" | "game_over";

/** Sets a player's answer for a game their team plays; changing it is fine. */
export async function setRsvp(
  db: Db,
  input: {
    gameId: GameId;
    userId: UserId;
    teamSeasonId: TeamSeasonId;
    status: RsvpStatus;
  },
): Promise<Result<void, RsvpError>> {
  const [found] = await db
    .select({ status: game.status })
    .from(game)
    .where(
      and(
        eq(game.id, input.gameId),
        or(
          eq(game.teamAId, input.teamSeasonId),
          eq(game.teamBId, input.teamSeasonId),
        ),
      ),
    );
  const [member] = await db
    .select({ id: rosterMembership.id })
    .from(rosterMembership)
    .innerJoin(
      registration,
      eq(rosterMembership.registrationId, registration.id),
    )
    .where(
      and(
        eq(rosterMembership.teamSeasonId, input.teamSeasonId),
        eq(rosterMembership.status, "active"),
        eq(registration.userId, input.userId),
      ),
    );
  if (!found || !member) return err("not_your_game");
  if (["final", "forfeit", "cancelled"].includes(found.status))
    return err("game_over");
  await db
    .insert(gameRsvp)
    .values(input)
    .onConflictDoUpdate({
      target: [gameRsvp.gameId, gameRsvp.userId],
      set: { status: input.status, teamSeasonId: input.teamSeasonId },
    });
  return ok(undefined);
}

export type TeamRsvps = {
  in: number;
  maybe: number;
  out: number;
  noAnswer: number;
  fielding: FieldingCheck;
};

/** The season's fielding numbers, falling back to the rulebook's. */
async function rulesFor(db: Db, gameId: GameId): Promise<FieldingRules> {
  const [found] = await db
    .select({ rules: season.fieldingRules })
    .from(game)
    .innerJoin(season, eq(game.seasonId, season.id))
    .where(eq(game.id, gameId));
  return {
    maxFielders: found?.rules.maxFielders ?? RULEBOOK.maxFielders,
    maxPerGender: found?.rules.maxPerGender ?? RULEBOOK.maxPerGender,
    minimumToPlay: found?.rules.minimumToPlay ?? RULEBOOK.minimumToPlay,
  };
}

/** A team's answers for each game, with what it can field from those "in". */
export async function teamRsvps(
  db: Db,
  teamSeasonId: TeamSeasonId,
  gameIds: readonly GameId[],
): Promise<Map<GameId, TeamRsvps>> {
  const result = new Map<GameId, TeamRsvps>();
  const [first] = gameIds;
  if (first === undefined) return result;
  const members = await db
    .select({
      userId: registration.userId,
      lineupGender: profile.lineupGender,
    })
    .from(rosterMembership)
    .innerJoin(
      registration,
      eq(rosterMembership.registrationId, registration.id),
    )
    .leftJoin(profile, eq(profile.userId, registration.userId))
    .where(
      and(
        eq(rosterMembership.teamSeasonId, teamSeasonId),
        eq(rosterMembership.status, "active"),
      ),
    );
  const answers = await db
    .select({
      gameId: gameRsvp.gameId,
      userId: gameRsvp.userId,
      status: gameRsvp.status,
    })
    .from(gameRsvp)
    .where(
      and(
        eq(gameRsvp.teamSeasonId, teamSeasonId),
        inArray(gameRsvp.gameId, [...gameIds]),
      ),
    );
  // Every game is in the same season, so the first one's rules apply.
  const rules = await rulesFor(db, first);
  for (const gameId of gameIds) {
    const said = new Map(
      answers
        .filter((a) => a.gameId === gameId)
        .map((a) => [a.userId, a.status]),
    );
    const coming = members.filter((m) => said.get(m.userId) === "in");
    result.set(gameId, {
      in: coming.length,
      maybe: members.filter((m) => said.get(m.userId) === "maybe").length,
      out: members.filter((m) => said.get(m.userId) === "out").length,
      noAnswer: members.filter((m) => !said.has(m.userId)).length,
      fielding: checkFielding(
        {
          women: coming.filter((m) => m.lineupGender === "woman").length,
          men: coming.filter((m) => m.lineupGender === "man").length,
          unknown: coming.filter((m) => m.lineupGender === null).length,
        },
        rules,
      ),
    });
  }
  return result;
}

/** One person's answers for the given games. */
export async function myRsvps(
  db: Db,
  userId: UserId,
  gameIds: readonly GameId[],
): Promise<Map<GameId, RsvpStatus>> {
  if (gameIds.length === 0) return new Map();
  const rows = await db
    .select({ gameId: gameRsvp.gameId, status: gameRsvp.status })
    .from(gameRsvp)
    .where(
      and(eq(gameRsvp.userId, userId), inArray(gameRsvp.gameId, [...gameIds])),
    );
  return new Map(rows.map((r) => [r.gameId, r.status]));
}
