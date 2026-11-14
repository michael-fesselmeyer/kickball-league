import { and, asc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Subject } from "@/domain/authz/permissions";
import {
  cardsVisible,
  cardText,
  type EmergencyCard,
  type Hidden,
  readCard,
} from "@/domain/emergency/emergency";
import type { GameId, TeamSeasonId, UserId } from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import { seal, unseal } from "@/lib/crypto/sealed";
import { user } from "../schema/auth";
import { emergencyContact } from "../schema/emergency";
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
import { recordAudit } from "./audit";
import type { Db } from "./schedule";

/**
 * Emergency contacts (src/domain/emergency/emergency.ts): each player's is
 * sealed with a key from the server's auth secret, bound to their id, so
 * a database copy alone reads nothing and a card moved to another person
 * does not open. Callers pass the secret.
 */

const PURPOSE = "emergency-contact";
const sealing = (secret: string, userId: UserId) => ({
  secret,
  purpose: PURPOSE,
  bindTo: `emergency_contact:${userId}`,
});

/** Saves (or replaces) a player's own emergency contact. */
export async function saveEmergencyContact(
  db: Db,
  input: { userId: UserId; card: EmergencyCard; secret: string; now: Date },
): Promise<void> {
  const sealed = seal(
    cardText(input.card),
    sealing(input.secret, input.userId),
  );
  await db
    .insert(emergencyContact)
    .values({ userId: input.userId, sealed, updatedAt: input.now })
    .onConflictDoUpdate({
      target: emergencyContact.userId,
      set: { sealed, updatedAt: input.now },
    });
}

/** A player's own card, or null when none is saved or it no longer opens. */
export async function emergencyCardOf(
  db: Db,
  userId: UserId,
  secret: string,
): Promise<EmergencyCard | null> {
  const [row] = await db
    .select({ sealed: emergencyContact.sealed })
    .from(emergencyContact)
    .where(eq(emergencyContact.userId, userId));
  return row ? open(row.sealed, secret, userId) : null;
}

function open(
  sealed: string,
  secret: string,
  userId: UserId,
): EmergencyCard | null {
  const text = unseal(sealed, sealing(secret, userId));
  return text === null ? null : readCard(text);
}

/**
 * When two accounts are merged: the merged-away account's card moves to the
 * kept one, opened and sealed again for it, only if the kept account has
 * none; either way it is deleted from the merged-away account. Returns 1
 * when a card was carried over.
 */
export async function mergeEmergencyContact(
  db: Db,
  input: { keptId: UserId; mergedId: UserId; secret: string; now: Date },
): Promise<number> {
  const merged = await emergencyCardOf(db, input.mergedId, input.secret);
  await removeEmergencyContact(db, input.mergedId);
  if (!merged || (await hasEmergencyContact(db, input.keptId))) return 0;
  await saveEmergencyContact(db, {
    userId: input.keptId,
    card: merged,
    secret: input.secret,
    now: input.now,
  });
  return 1;
}

/** Whether a player has a card saved, without opening it. */
export async function hasEmergencyContact(
  db: Db,
  userId: UserId,
): Promise<boolean> {
  const [row] = await db
    .select({ userId: emergencyContact.userId })
    .from(emergencyContact)
    .where(eq(emergencyContact.userId, userId));
  return row !== undefined;
}

/** Deletes a player's card, when their account is deleted. */
export async function removeEmergencyContact(
  db: Db,
  userId: UserId,
): Promise<void> {
  await db.delete(emergencyContact).where(eq(emergencyContact.userId, userId));
}

export type GamePlayerCard = {
  userId: UserId;
  name: string;
  /** A sub playing for the team in this game only. */
  sub: boolean;
  card: EmergencyCard | null;
};

export type GameCards = {
  gameId: GameId;
  startsAt: Date;
  timeZone: string;
  /** When the cards stop showing: midnight after game day. */
  until: Date;
  teams: {
    teamSeasonId: TeamSeasonId;
    name: string;
    players: GamePlayerCard[];
  }[];
};

const teamA = alias(teamSeason, "emergency_team_a");
const teamB = alias(teamSeason, "emergency_team_b");
const nameA = alias(team, "emergency_name_a");
const nameB = alias(team, "emergency_name_b");

/**
 * The emergency contacts of everyone playing in a game, for its captains
 * and ref on game day: both teams' active players and the subs approved to
 * play. Every read writes an `emergency_contact.view` audit row in the same
 * transaction, whoever reads it and however often. Four queries.
 */
export async function gameEmergencyCards(
  db: Db,
  input: {
    gameId: GameId;
    subject: Subject;
    viewerId: UserId;
    secret: string;
    now: Date;
  },
): Promise<Result<GameCards, Hidden | "not_found">> {
  const [g] = await db
    .select({
      id: game.id,
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
    .where(eq(game.id, input.gameId));
  if (!g) return err("not_found");
  // The game's captains (and co-captains) and its ref; being an admin adds
  // nothing (permissions.ts, `emergency_contact.view`).
  const visible = cardsVisible(
    { status: g.status, startsAt: g.startsAt, timeZone: g.timeZone },
    {
      captainsGame: input.subject.roster.some(
        (m) =>
          (m.teamSeasonId === g.teamAId || m.teamSeasonId === g.teamBId) &&
          (m.role === "captain" || m.role === "co_captain"),
      ),
      refereesGame: input.subject.refereeGameIds.includes(g.id),
    },
    input.now,
  );
  if (!visible.ok) return visible;
  const startsAt = g.startsAt;
  if (!startsAt) return err("called_off");

  return db.transaction(async (tx) => {
    const [members, subs] = await Promise.all([
      tx
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
          ),
        )
        .orderBy(asc(user.name)),
      tx
        .select({
          userId: subClaim.userId,
          name: user.name,
          teamSeasonId: subRequest.teamSeasonId,
        })
        .from(subClaim)
        .innerJoin(subRequest, eq(subClaim.subRequestId, subRequest.id))
        .innerJoin(user, eq(subClaim.userId, user.id))
        .where(
          and(eq(subRequest.gameId, g.id), eq(subClaim.status, "approved")),
        )
        .orderBy(asc(user.name)),
    ]);
    const everyone = [
      ...members.map((m) => ({ ...m, sub: false })),
      ...subs.map((s) => ({ ...s, sub: true })),
    ];
    const sealed =
      everyone.length === 0
        ? []
        : await tx
            .select({
              userId: emergencyContact.userId,
              sealed: emergencyContact.sealed,
            })
            .from(emergencyContact)
            .where(
              inArray(
                emergencyContact.userId,
                everyone.map((p) => p.userId),
              ),
            );
    const byUser = new Map(sealed.map((s) => [s.userId, s.sealed]));
    const players = everyone.map((p) => {
      const stored = byUser.get(p.userId);
      return {
        userId: p.userId,
        name: p.name,
        sub: p.sub,
        teamSeasonId: p.teamSeasonId,
        card: stored ? open(stored, input.secret, p.userId) : null,
      };
    });
    await recordAudit(tx, {
      actorId: input.viewerId,
      action: "emergency_contact.view",
      entityType: "game",
      entityId: g.id,
      after: {
        players: players.length,
        withContact: players.filter((p) => p.card !== null).length,
      },
    });
    const teamOf = (teamSeasonId: TeamSeasonId, name: string) => ({
      teamSeasonId,
      name,
      players: players
        .filter((p) => p.teamSeasonId === teamSeasonId)
        .map((p) => ({
          userId: p.userId,
          name: p.name,
          sub: p.sub,
          card: p.card,
        })),
    });
    return ok({
      gameId: g.id,
      startsAt,
      timeZone: g.timeZone,
      until: visible.until,
      teams: [teamOf(g.teamAId, g.teamAName), teamOf(g.teamBId, g.teamBName)],
    });
  });
}
