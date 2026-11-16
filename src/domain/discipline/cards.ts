/**
 * Yellow and red cards (product-spec.md, section 6, Game day): a light way
 * for a ref to calm a game down. A yellow card is a warning; a red card
 * asks the player to sit out the rest of the game. Cards are a game-day
 * tool, never a disciplinary system: nothing here, or anywhere, turns a
 * card into a suspension. Suspensions stay a manual admin decision for
 * serious conduct. Pure rules; src/db/queries/cards.ts reads and writes.
 */

import { err, ok, type Result } from "../result";
import { canFileFor, type GameFacts } from "./discipline";

export const CARD_COLORS = {
  yellow: "Yellow card (a warning)",
  red: "Red card (sit out the rest of the game)",
} as const;
export type CardColor = keyof typeof CARD_COLORS;
export const CARD_COLOR_KEYS: readonly CardColor[] = ["yellow", "red"];
export const isCardColor = (value: string): value is CardColor =>
  Object.hasOwn(CARD_COLORS, value);

/** What a card reads as: "Yellow card", "Red card". */
export const cardName = (color: CardColor) =>
  color === "yellow" ? "Yellow card" : "Red card";

export const CARD_NOTE_MAX = 200;
/** The ref may take a card back this long after giving it. */
export const UNDO_WINDOW_MS = 5 * 60_000;
/** A card can be recorded until this long after kickoff, for a late entry. */
export const CARD_WINDOW_MS = 48 * 3_600_000;
/** A pattern note appears from this many cards across this many games. */
export const PATTERN_CARDS = 3;
export const PATTERN_GAMES = 3;

export type CardError = "bad_color" | "note_too_long" | "unknown_person";

export type NewCard = {
  color: CardColor;
  note: string | null;
  userId: string;
  teamSeasonId: string;
};

/**
 * Reads the card form. `person` is "teamSeasonId:userId", one of `choices`
 * in that same form: a player who is on both rosters is listed under each
 * team, and the ref picks the team they were playing for.
 */
export function parseCardForm(
  values: { color: string; note: string; person: string },
  choices: ReadonlySet<string>,
): Result<NewCard, CardError> {
  if (!isCardColor(values.color)) return err("bad_color");
  if (!choices.has(values.person)) return err("unknown_person");
  const note = values.note.trim();
  if (note.length > CARD_NOTE_MAX) return err("note_too_long");
  const [teamSeasonId, userId] = values.person.split(":");
  if (!teamSeasonId || !userId) return err("unknown_person");
  return ok({
    color: values.color,
    note: note === "" ? null : note,
    userId,
    teamSeasonId,
  });
}

export const cardChoice = (teamSeasonId: string, userId: string) =>
  `${teamSeasonId}:${userId}`;

export type CardBlock = "not_started" | "called_off" | "too_late";

/**
 * Whether a card can be given for `game` at `now`: once play started and
 * not called off, through the game and a day or so after it for a late
 * entry. A game that ended still takes a card. An admin may also give one
 * for a game further back.
 */
export function canGiveCard(
  game: GameFacts,
  now: Date,
  { isAdmin = false }: { isAdmin?: boolean } = {},
): Result<void, CardBlock> {
  const open = canFileFor(game, now);
  if (!open.ok) return open;
  // An admin can still record one for an older game, say after a report.
  if (
    !isAdmin &&
    game.startsAt !== null &&
    now.getTime() - game.startsAt.getTime() > CARD_WINDOW_MS
  )
    return err("too_late");
  return ok(undefined);
}

/**
 * Whether a card can be taken back: by the person who gave it within a few
 * minutes (a slip of the thumb), or by an admin whenever.
 */
export function canUndoCard(
  card: { givenBy: string | null; givenAt: Date },
  who: { userId: string; isAdmin: boolean },
  now: Date,
): boolean {
  if (who.isAdmin) return true;
  return (
    card.givenBy === who.userId &&
    now.getTime() - card.givenAt.getTime() <= UNDO_WINDOW_MS
  );
}

export type CardFacts = { gameId: string; color: CardColor };

/**
 * A gentle pattern note for admins, only once there are several cards
 * across different games: one rough night is not a pattern. It never
 * recommends a suspension.
 */
export function patternNote(cards: readonly CardFacts[]): string | null {
  const games = new Set(cards.map((c) => c.gameId)).size;
  if (cards.length < PATTERN_CARDS || games < PATTERN_GAMES) return null;
  return `${cards.length} cards across ${games} games. Worth a friendly word. Cards never lead to a suspension on their own.`;
}
