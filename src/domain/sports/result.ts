/**
 * A reported result, the same for every sport (ADR 0087): two numbers in
 * the sport's unit (runs, sets won, points) and how the game ended. Each
 * sport checks it by its own rules; see ./sports.ts.
 */

export const OUTCOMES = ["normal", "called", "forfeit_a", "forfeit_b"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const PLAYOFF_TIE = "Playoff games can't end in a tie. Play it out.";

export type ScoreInput = {
  outcome: Outcome;
  scoreA: number;
  scoreB: number;
  /** Complete periods (innings) of a called game; null for sports without them. */
  inningsPlayed: number | null;
  /** A called game only: the light ran out, or the field had to be clear (#467). */
  callReason?: CallReason | null;
};

export const CALL_REASONS = ["daylight", "field_time"] as const;
export type CallReason = (typeof CALL_REASONS)[number];

export type ScoreErrors = {
  scoreA?: string;
  scoreB?: string;
  inningsPlayed?: string;
};

export const isForfeit = (outcome: Outcome) =>
  outcome === "forfeit_a" || outcome === "forfeit_b";

/** What a sport's score check is told about the game. */
export type CheckOptions = {
  /** Playoff games cannot end in a tie (rulebook 3.1.2). */
  tiesAllowed?: boolean;
  /** Sets in the match, for a sport played in sets; ignored otherwise. */
  bestOf?: number | null;
};
