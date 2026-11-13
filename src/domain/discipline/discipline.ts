/**
 * Game-day discipline (product-spec.md, section 6, Game day): sportsmanship
 * ratings, incident reports and suspensions. Pure rules; the queries in
 * src/db/queries/discipline.ts read and write the rows.
 *
 * - After a final score, each captain rates the other team from 1 to 5,
 *   with an optional note only admins read. Nobody sees who rated what: a
 *   team's own average shows to its captain only once enough games are
 *   rated that no single rating can be read from it.
 * - A ref (for their assigned games), a captain of either team or an admin
 *   files an incident once the game has started.
 * - An admin suspends a player from an incident: for a number of games,
 *   the rest of the season, or permanently. For outside alcohol the
 *   rulebook 4.0 ladder is suggested: 1 game, then a season ban, then a
 *   permanent ban. Games served are counted from the team's final games,
 *   never stored (docs/adr/0026-discipline-counted-not-stored.md).
 */

import { err, ok, type Result } from "../result";

export const INCIDENT_KINDS = {
  ejection: "Ejection",
  forfeit_related: "Forfeit-related",
  unsportsmanlike: "Unsportsmanlike conduct",
  outside_alcohol: "Outside alcohol at the sponsor bar",
  safety: "Safety",
  other: "Other",
} as const;
export type IncidentKind = keyof typeof INCIDENT_KINDS;
export const INCIDENT_KIND_KEYS: readonly IncidentKind[] = [
  "ejection",
  "forfeit_related",
  "unsportsmanlike",
  "outside_alcohol",
  "safety",
  "other",
];
export const isIncidentKind = (value: string): value is IncidentKind =>
  Object.hasOwn(INCIDENT_KINDS, value);

/** The most characters in what happened, an admin's note and a rating note. */
export const DETAILS_MAX = 2000;
export const NOTE_MAX = 1000;
export const RATING_NOTE_MAX = 200;
/** The longest suspension counted in games. */
export const MAX_GAMES = 20;
/** A team's own average shows once this many of its games are rated. */
export const OWN_AVERAGE_AFTER = 3;

export type ReporterRole = "referee" | "captain" | "admin";

/**
 * How a person filing for this game is described on the report: as its ref
 * first (what they saw is the official account), then as a captain.
 */
export function reporterRole(who: {
  refereesGame: boolean;
  captainsGame: boolean;
}): ReporterRole {
  if (who.refereesGame) return "referee";
  if (who.captainsGame) return "captain";
  return "admin";
}

/** The parts of a game the rules below read. */
export type GameFacts = {
  status: string;
  /** Kickoff; null while the game has no slot. */
  startsAt: Date | null;
};

export type FileBlock = "not_started" | "called_off";

/** Whether an incident can be filed for `game` at `now`: once play started. */
export function canFileFor(
  game: GameFacts,
  now: Date,
): Result<void, FileBlock> {
  if (game.status === "cancelled" || game.status === "postponed")
    return err("called_off");
  const played = game.status === "final" || game.status === "forfeit";
  const started = game.startsAt !== null && game.startsAt <= now;
  return played || started || game.status === "in_progress"
    ? ok(undefined)
    : err("not_started");
}

export type NewIncident = {
  kind: IncidentKind;
  details: string;
  people: string[];
};

export type IncidentFormError =
  "bad_kind" | "no_details" | "details_too_long" | "unknown_person";

/**
 * Reads the incident form. `people` are the ids ticked; each must be one of
 * `choices` (the two teams' players), and repeats count once.
 */
export function parseIncidentForm(
  values: { kind: string; details: string; people: readonly string[] },
  choices: ReadonlySet<string>,
): Result<NewIncident, IncidentFormError> {
  if (!isIncidentKind(values.kind)) return err("bad_kind");
  const details = values.details.trim();
  if (details.length === 0) return err("no_details");
  if (details.length > DETAILS_MAX) return err("details_too_long");
  const people = [...new Set(values.people)];
  if (people.some((p) => !choices.has(p))) return err("unknown_person");
  return ok({ kind: values.kind, details, people });
}

export type NoteError = "no_note" | "note_too_long";

/** An admin's note on an incident. */
export function parseNote(raw: string): Result<string, NoteError> {
  const note = raw.trim();
  if (note.length === 0) return err("no_note");
  if (note.length > NOTE_MAX) return err("note_too_long");
  return ok(note);
}

export type Rating = { score: number; note: string | null };
export type RatingError = "bad_score" | "rating_note_too_long";

/** A captain's rating: a whole number from 1 to 5, and an optional note. */
export function parseRating(values: {
  score: string;
  note: string;
}): Result<Rating, RatingError> {
  const score = Number(values.score);
  if (!/^[1-5]$/.test(values.score.trim()) || !Number.isInteger(score))
    return err("bad_score");
  const note = values.note.trim();
  if (note.length > RATING_NOTE_MAX) return err("rating_note_too_long");
  return ok({ score, note: note.length > 0 ? note : null });
}

/** Ratings open once the score is final; a forfeit has no game to rate. */
export const canRate = (game: GameFacts) => game.status === "final";

/**
 * The average of some ratings to one decimal, or null with none. Shown as
 * "4.3 from 6 games".
 */
export function averageOf(scores: readonly number[]): number | null {
  if (scores.length === 0) return null;
  const sum = scores.reduce((a, b) => a + b, 0);
  return Math.round((sum / scores.length) * 10) / 10;
}

/**
 * What a captain may see of their own team's ratings, oldest first: the
 * average of whole blocks of OWN_AVERAGE_AFTER ratings. It appears after
 * the third and moves only when a block fills, so neither the average nor
 * how it changed gives one rating away.
 */
export function ownAverage(
  scores: readonly number[],
): { average: number; count: number } | { waitingFor: number } {
  const counted = scores.slice(
    0,
    scores.length - (scores.length % OWN_AVERAGE_AFTER),
  );
  const average = averageOf(counted);
  return average !== null
    ? { average, count: counted.length }
    : { waitingFor: OWN_AVERAGE_AFTER - scores.length };
}

export type SuspensionLength =
  | { scope: "games"; games: number }
  | { scope: "season" }
  | { scope: "permanent" };

/**
 * The rulebook 4.0 ladder for outside alcohol at the sponsor bar, from how
 * many earlier outside-alcohol suspensions the player has (lifted ones do
 * not count): a 1-game suspension, then a season ban, then a permanent ban.
 * Other kinds have no set length, so nothing is suggested.
 */
export function suggestedLength(
  kind: IncidentKind,
  earlierAlcoholSuspensions: number,
): SuspensionLength | null {
  if (kind !== "outside_alcohol") return null;
  if (earlierAlcoholSuspensions <= 0) return { scope: "games", games: 1 };
  if (earlierAlcoholSuspensions === 1) return { scope: "season" };
  return { scope: "permanent" };
}

export type LengthError = "bad_scope" | "bad_games";

/** Reads the suspend form: a scope, and a game count for "games". */
export function parseLength(values: {
  scope: string;
  games: string;
}): Result<SuspensionLength, LengthError> {
  if (values.scope === "season" || values.scope === "permanent")
    return ok({ scope: values.scope });
  if (values.scope !== "games") return err("bad_scope");
  const raw = values.games.trim();
  const games = Number(raw);
  if (!/^\d+$/.test(raw) || games < 1 || games > MAX_GAMES)
    return err("bad_games");
  return ok({ scope: "games", games });
}

/** "1 game", "3 games", "the rest of the season", "permanently". */
export function describeLength(length: SuspensionLength): string {
  switch (length.scope) {
    case "games":
      return `${length.games} ${length.games === 1 ? "game" : "games"}`;
    case "season":
      return "the rest of the season";
    case "permanent":
      return "permanently";
  }
}

export type SuspensionFacts = {
  length: SuspensionLength;
  /** When an admin lifted it early, if they did. */
  liftedAt: Date | null;
  /** The suspended player's team games that went final since it began. */
  gamesServed: number;
  /** The suspension's season is over. */
  seasonOver: boolean;
};

export type SuspensionState =
  | { state: "active"; gamesLeft: number | null }
  | { state: "served" }
  | { state: "lifted" };

/**
 * Where a suspension stands. A games suspension counts down as the
 * player's team games become final; a season one ends with the season; a
 * permanent one lasts until an admin lifts it.
 */
export function suspensionState(facts: SuspensionFacts): SuspensionState {
  if (facts.liftedAt !== null) return { state: "lifted" };
  switch (facts.length.scope) {
    case "games": {
      const left = facts.length.games - Math.max(0, facts.gamesServed);
      return left > 0
        ? { state: "active", gamesLeft: left }
        : { state: "served" };
    }
    case "season":
      return facts.seasonOver
        ? { state: "served" }
        : { state: "active", gamesLeft: null };
    case "permanent":
      return { state: "active", gamesLeft: null };
  }
}

/**
 * What a captain or the player sees: that the player is suspended and for
 * how long still, never why.
 */
export function suspendedLabel(
  length: SuspensionLength,
  gamesLeft: number | null,
): string {
  if (length.scope === "games" && gamesLeft !== null)
    return `Suspended, ${gamesLeft} more ${gamesLeft === 1 ? "game" : "games"}`;
  if (length.scope === "season") return "Suspended for the season";
  return "Suspended";
}

/** A season is over once completed, or once its last day has passed. */
export function seasonIsOver(
  season: { status: string; endsOn: string },
  today: string,
): boolean {
  return season.status === "completed" || season.endsOn < today;
}
