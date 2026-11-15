import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  canGiveCard,
  canUndoCard,
  type CardBlock,
  type CardColor,
  type NewCard,
} from "@/domain/discipline/cards";
import type { GameCardId, GameId, SeasonId, UserId } from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import { user } from "../schema/auth";
import { gameCard } from "../schema/discipline";
import { game } from "../schema/game";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { team, teamSeason } from "../schema/team";
import { recordAudit } from "./audit";
import { gamePeople } from "./discipline";
import type { Db } from "./schedule";
import { gameForScoring } from "./scores";

/**
 * Yellow and red cards (src/domain/discipline/cards.ts). A card is a
 * game-day tool: nothing here ever creates a suspension. Every change
 * writes an audit row in the same transaction. Never read by a public page.
 */

const shortName = (first: string | null, last: string | null, full: string) =>
  first ? (last ? `${first} ${last.charAt(0).toUpperCase()}.` : first) : full;

export type GiveError = CardBlock | "not_found" | "not_in_game";

/** Gives a player a card in a game. The player must be on one of its rosters. */
export async function giveCard(
  db: Db,
  input: { gameId: GameId; givenBy: UserId; card: NewCard; now: Date },
): Promise<Result<GameCardId, GiveError>> {
  return db.transaction(async (tx) => {
    const g = await gameForScoring(tx, input.gameId);
    if (!g) return err("not_found");
    const open = canGiveCard(g, input.now);
    if (!open.ok) return open;
    const onTeam = (await gamePeople(tx, g)).some(
      (p) =>
        p.userId === input.card.userId &&
        p.teamSeasonId === input.card.teamSeasonId,
    );
    if (!onTeam) return err("not_in_game");
    const [created] = await tx
      .insert(gameCard)
      .values({
        gameId: g.id,
        userId: input.card.userId as UserId,
        teamSeasonId: input.card.teamSeasonId as GameCard["teamSeasonId"],
        color: input.card.color,
        note: input.card.note,
        givenBy: input.givenBy,
        givenAt: input.now,
      })
      .returning({ id: gameCard.id });
    if (!created) throw new Error("Expected a card row");
    await recordAudit(tx, {
      actorId: input.givenBy,
      action: "card.give",
      entityType: "game_card",
      entityId: created.id,
      after: { color: input.card.color, userId: input.card.userId },
    });
    return ok(created.id);
  });
}

type GameCard = typeof gameCard.$inferSelect;

export type UndoError = "not_found" | "too_late";

/** Takes a card back: the giver within minutes, an admin whenever. */
export async function undoCard(
  db: Db,
  input: {
    cardId: GameCardId;
    gameId: GameId;
    by: UserId;
    isAdmin: boolean;
    now: Date;
  },
): Promise<Result<void, UndoError>> {
  return db.transaction(async (tx) => {
    const [found] = await tx
      .select()
      .from(gameCard)
      .where(
        and(eq(gameCard.id, input.cardId), eq(gameCard.gameId, input.gameId)),
      )
      .for("update");
    if (!found) return err("not_found");
    if (
      !canUndoCard(
        { givenBy: found.givenBy, givenAt: found.givenAt },
        { userId: input.by, isAdmin: input.isAdmin },
        input.now,
      )
    )
      return err("too_late");
    // Audit first: the entry reads its league from the card row.
    await recordAudit(tx, {
      actorId: input.by,
      action: "card.undo",
      entityType: "game_card",
      entityId: found.id,
      before: { color: found.color, userId: found.userId },
    });
    await tx.delete(gameCard).where(eq(gameCard.id, found.id));
    return ok(undefined);
  });
}

export type GameCardRow = {
  id: GameCardId;
  userId: UserId;
  name: string;
  teamName: string | null;
  color: CardColor;
  note: string | null;
  givenBy: UserId | null;
  givenAt: Date;
};

/** Cards given in one game, oldest first, for the ref's score screen. */
export async function gameCards(
  db: Db,
  gameId: GameId,
): Promise<GameCardRow[]> {
  const rows = await db
    .select({
      id: gameCard.id,
      userId: gameCard.userId,
      full: user.name,
      first: profile.firstName,
      last: profile.lastName,
      teamName: team.name,
      color: gameCard.color,
      note: gameCard.note,
      givenBy: gameCard.givenBy,
      givenAt: gameCard.givenAt,
    })
    .from(gameCard)
    .innerJoin(user, eq(gameCard.userId, user.id))
    .leftJoin(profile, eq(profile.userId, gameCard.userId))
    .leftJoin(teamSeason, eq(gameCard.teamSeasonId, teamSeason.id))
    .leftJoin(team, eq(teamSeason.teamId, team.id))
    .where(eq(gameCard.gameId, gameId))
    .orderBy(asc(gameCard.givenAt));
  return rows.map(({ full, first, last, ...r }) => ({
    ...r,
    name: shortName(first, last, full),
  }));
}

export type ConductCard = {
  id: GameCardId;
  userId: UserId;
  gameId: GameId;
  seasonId: SeasonId;
  color: CardColor;
  note: string | null;
  givenAt: Date;
  gameLabel: string;
};

/**
 * The cards of some players, newest first, with their season, for an
 * admin's conduct record.
 */
export async function cardsForPlayers(
  db: Db,
  userIds: readonly UserId[],
): Promise<Map<UserId, ConductCard[]>> {
  const out = new Map<UserId, ConductCard[]>();
  if (userIds.length === 0) return out;
  const a = teamSeason;
  const rows = await db
    .select({
      id: gameCard.id,
      userId: gameCard.userId,
      gameId: gameCard.gameId,
      seasonId: game.seasonId,
      color: gameCard.color,
      note: gameCard.note,
      givenAt: gameCard.givenAt,
      seasonName: season.name,
      teamName: team.name,
    })
    .from(gameCard)
    .innerJoin(game, eq(gameCard.gameId, game.id))
    .innerJoin(season, eq(game.seasonId, season.id))
    .leftJoin(a, eq(gameCard.teamSeasonId, a.id))
    .leftJoin(team, eq(a.teamId, team.id))
    .where(inArray(gameCard.userId, [...userIds]))
    .orderBy(desc(gameCard.givenAt));
  for (const r of rows) {
    const list = out.get(r.userId) ?? [];
    list.push({
      id: r.id,
      userId: r.userId,
      gameId: r.gameId,
      seasonId: r.seasonId,
      color: r.color,
      note: r.note,
      givenAt: r.givenAt,
      gameLabel: `${r.seasonName}${r.teamName ? ` · ${r.teamName}` : ""}`,
    });
    out.set(r.userId, list);
  }
  return out;
}

/** A player's own cards, newest first: for their profile and data export. */
export async function myCards(db: Db, userId: UserId) {
  return db
    .select({
      color: gameCard.color,
      note: gameCard.note,
      givenAt: gameCard.givenAt,
    })
    .from(gameCard)
    .where(eq(gameCard.userId, userId))
    .orderBy(desc(gameCard.givenAt));
}

export type CardedPlayer = {
  userId: UserId;
  name: string;
  cards: ConductCard[];
};

/**
 * Players who have been given cards, newest card first, for the admin
 * conduct record. Capped, so a busy league's page stays small.
 */
export async function cardedPlayers(
  db: Db,
  limit = 300,
): Promise<CardedPlayer[]> {
  const recent = await db
    .select({ userId: gameCard.userId })
    .from(gameCard)
    .orderBy(desc(gameCard.givenAt))
    .limit(limit);
  const ids = [...new Set(recent.map((r) => r.userId))];
  const [cards, names] = await Promise.all([
    cardsForPlayers(db, ids),
    ids.length === 0
      ? []
      : db
          .select({
            userId: user.id,
            full: user.name,
            first: profile.firstName,
            last: profile.lastName,
          })
          .from(user)
          .leftJoin(profile, eq(profile.userId, user.id))
          .where(inArray(user.id, ids)),
  ]);
  const nameOf = new Map(
    names.map((n) => [n.userId, shortName(n.first, n.last, n.full)]),
  );
  return ids.map((id) => ({
    userId: id,
    name: nameOf.get(id) ?? "A player",
    cards: cards.get(id) ?? [],
  }));
}
