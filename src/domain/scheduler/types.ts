/**
 * Types for the season scheduler (docs/scheduling-algorithm.md, section 1).
 * Everything here is plain data: no database rows, no Dates, no clocks.
 * Instants are ISO-8601 strings in UTC; dates are YYYY-MM-DD in the
 * league's own time zone.
 */

export type SlotKind = "regular" | "makeup_reserve" | "playoff";

/** A field the league holds a permit for, from one instant to another. */
export type PermitWindow = {
  fieldId: string;
  startsAt: string;
  endsAt: string;
  kind?: SlotKind;
};

/** A date with no play: on every field, or on one field. */
export type Blackout = { date: string; fieldId?: string };

export type SlotFormat = {
  /** Length of one game slot, including changeover. */
  slotMinutes: number;
  /** IANA zone the league plays in, e.g. America/New_York. */
  timeZone: string;
};

export type Slot = {
  /** Stable: the same field and start always give the same id. */
  id: string;
  fieldId: string;
  /** Local date in the league's time zone. */
  date: string;
  /** 0 is the earliest slot of the day across all fields. */
  timeIndex: number;
  startsAt: string;
  endsAt: string;
  kind: SlotKind;
};

export type Weights = {
  timeBalance: number; // S1
  fieldBalance: number; // S2
  streaks: number; // S3
  doubleheaderWait: number; // S4
  idleFields: number; // S5
  preferences: number; // S6
  rematchSpacing: number; // S7
  backToBackByes: number; // S8
  fineBalance: number; // S9
};

export const DEFAULT_WEIGHTS: Weights = {
  timeBalance: 100,
  fieldBalance: 100,
  streaks: 20,
  doubleheaderWait: 30,
  idleFields: 5,
  preferences: 10,
  rematchSpacing: 10,
  backToBackByes: 50,
  fineBalance: 1,
};

export type TeamConstraint = {
  teamId: string;
  kind: "unavailable" | "prefer" | "avoid";
  date?: string;
  timeIndex?: number;
  weight?: number;
};

export type SchedulerInput = {
  teams: { id: string; divisionId?: string }[];
  slots: Slot[];
  /** Rounds to play; in one round each team plays once or has a bye. */
  rounds: number;
  /**
   * Crossover games each team plays against the other division, on top of
   * `rounds`. Needs exactly two divisions; 0 or left out means none.
   */
  crossoverGames?: number;
  /** 2 means doubleheaders (summer). */
  gamesPerTeamPerDay: 1 | 2;
  /** Slots to leave empty each day for makeups. */
  reservePerDay: number;
  constraints: TeamConstraint[];
  /** Manual pins. */
  locked: { gameKey: string; slotId: string }[];
  weights: Weights;
  seed: number;
};

export type ScheduledGame = {
  /** Stable: `r{round}:{teamA}:{teamB}` with the two ids sorted. */
  key: string;
  round: number;
  teamA: string;
  teamB: string;
  slotId: string | null;
};

export type Schedule = {
  games: ScheduledGame[];
  byes: { round: number; teamId: string }[];
  unplaced: string[];
  diagnostics: string[];
};

/** The stable key a game keeps across regenerations. */
export function gameKey(round: number, teamA: string, teamB: string): string {
  const [first, second] = [teamA, teamB].sort();
  return `r${round}:${first}:${second}`;
}
