import { aliasedTable, and, asc, eq, inArray, sql } from "drizzle-orm";
import type { GameId, SeasonId, UserId } from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import { user } from "../schema/auth";
import { field, game, refereeAssignment, slot } from "../schema/game";
import { season } from "../schema/season";
import { team, teamSeason } from "../schema/team";
import { recordAudit } from "./audit";
import type { Db } from "./schedule";

/** Referee assignments (roadmap week 5, "Referee role"). */

const teamA = aliasedTable(team, "team_a");
const teamB = aliasedTable(team, "team_b");
const entryA = aliasedTable(teamSeason, "entry_a");
const entryB = aliasedTable(teamSeason, "entry_b");

/** A season's placed games with their referee, in date order. */
export async function refereeBoard(db: Db, seasonId: SeasonId) {
  const games = await db
    .select({
      id: game.id,
      status: game.status,
      startsAt: slot.startsAt,
      slotStatus: slot.status,
      fieldName: field.name,
      teamAId: game.teamAId,
      teamBId: game.teamBId,
      teamAName: teamA.name,
      teamBName: teamB.name,
    })
    .from(game)
    .innerJoin(slot, eq(game.slotId, slot.id))
    .innerJoin(field, eq(slot.fieldId, field.id))
    .innerJoin(entryA, eq(game.teamAId, entryA.id))
    .innerJoin(teamA, eq(entryA.teamId, teamA.id))
    .innerJoin(entryB, eq(game.teamBId, entryB.id))
    .innerJoin(teamB, eq(entryB.teamId, teamB.id))
    .where(and(eq(game.seasonId, seasonId), sql`${game.status} <> 'cancelled'`))
    .orderBy(asc(slot.startsAt), asc(field.name));
  const refs =
    games.length === 0
      ? []
      : await db
          .select({
            gameId: refereeAssignment.gameId,
            name: user.name,
            email: user.email,
          })
          .from(refereeAssignment)
          .innerJoin(user, eq(refereeAssignment.userId, user.id))
          .where(
            and(
              inArray(
                refereeAssignment.gameId,
                games.map((g) => g.id),
              ),
              eq(refereeAssignment.status, "accepted"),
            ),
          );
  const refOf = new Map(refs.map((r) => [r.gameId, r]));
  return games.map((g) => ({ ...g, referee: refOf.get(g.id) ?? null }));
}

export type AssignError = "unknown_game" | "no_account";

/**
 * Makes the person with this email the game's referee, replacing anyone
 * assigned before. They need an account, so they can sign in and score.
 */
export async function assignReferee(
  db: Db,
  input: { seasonId: SeasonId; gameId: GameId; email: string; actorId: UserId },
): Promise<Result<void, AssignError>> {
  const [found] = await db
    .select({ id: game.id })
    .from(game)
    .where(and(eq(game.id, input.gameId), eq(game.seasonId, input.seasonId)));
  if (!found) return err("unknown_game");
  const [person] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(sql`lower(${user.email})`, input.email.trim().toLowerCase()));
  if (!person) return err("no_account");
  await db
    .update(refereeAssignment)
    .set({ status: "cancelled", respondedAt: new Date() })
    .where(
      and(
        eq(refereeAssignment.gameId, input.gameId),
        inArray(refereeAssignment.status, ["offered", "accepted"]),
      ),
    );
  await db.insert(refereeAssignment).values({
    gameId: input.gameId,
    userId: person.id,
    status: "accepted",
    respondedAt: new Date(),
    createdBy: input.actorId,
  });
  await recordAudit(db, {
    actorId: input.actorId,
    action: "referee.assign",
    entityType: "game",
    entityId: input.gameId,
    after: { userId: person.id },
  });
  return ok(undefined);
}

/** Removes the game's referee. */
export async function unassignReferee(
  db: Db,
  input: { seasonId: SeasonId; gameId: GameId; actorId: UserId },
): Promise<void> {
  const cancelled = await db
    .update(refereeAssignment)
    .set({ status: "cancelled", respondedAt: new Date() })
    .where(
      and(
        eq(refereeAssignment.gameId, input.gameId),
        inArray(refereeAssignment.status, ["offered", "accepted"]),
        inArray(
          refereeAssignment.gameId,
          db
            .select({ id: game.id })
            .from(game)
            .where(eq(game.seasonId, input.seasonId)),
        ),
      ),
    )
    .returning({ userId: refereeAssignment.userId });
  if (cancelled.length > 0)
    await recordAudit(db, {
      actorId: input.actorId,
      action: "referee.unassign",
      entityType: "game",
      entityId: input.gameId,
      before: { userId: cancelled[0]?.userId },
    });
}

/** The games a person referees, soonest first, for their home screen. */
export async function gamesToReferee(db: Db, userId: UserId) {
  return db
    .select({
      id: game.id,
      status: game.status,
      startsAt: slot.startsAt,
      fieldName: field.name,
      teamAId: game.teamAId,
      teamBId: game.teamBId,
      teamAName: teamA.name,
      teamBName: teamB.name,
      seasonName: season.name,
      checkedInAt: refereeAssignment.checkedInAt,
    })
    .from(refereeAssignment)
    .innerJoin(game, eq(refereeAssignment.gameId, game.id))
    .innerJoin(season, eq(game.seasonId, season.id))
    .innerJoin(slot, eq(game.slotId, slot.id))
    .innerJoin(field, eq(slot.fieldId, field.id))
    .innerJoin(entryA, eq(game.teamAId, entryA.id))
    .innerJoin(teamA, eq(entryA.teamId, teamA.id))
    .innerJoin(entryB, eq(game.teamBId, entryB.id))
    .innerJoin(teamB, eq(entryB.teamId, teamB.id))
    .where(
      and(
        eq(refereeAssignment.userId, userId),
        eq(refereeAssignment.status, "accepted"),
      ),
    )
    .orderBy(asc(slot.startsAt));
}
