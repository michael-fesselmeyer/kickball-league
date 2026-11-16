/**
 * The season-end leadership check-in (product-spec.md, section 6; ADR 0091).
 * Pure rules; src/db/queries/leadership.ts reads and writes the rows.
 *
 * 1. Check-in: each player on the roster checks in once, privately. They
 *    may volunteer, suggest one teammate, or say things are good as they
 *    are. A suggested teammate is asked whether they'd stand.
 * 2. Secret ballot, only when enough of the roster took part (the league's
 *    quorum) and a teammate other than the captain is standing for captain.
 * 3. Result: a clear majority (over half the ballots) is needed. The
 *    captain hears it first and chooses how to hand over.
 */

import { err, ok, type Result } from "../result";

export const DAY_MS = 24 * 60 * 60 * 1000;
/** How long the admin can leave the check-in open, in days. */
export const CHECK_IN_DAYS = { min: 3, max: 14, default: 7 } as const;
export const BALLOT_DAYS = 5;
/** The captain's private time with a result before the team hears it. */
export const REVIEW_DAYS = 3;
/** How long a teammate asked late still gets to answer after the close. */
export const ANSWER_GRACE_DAYS = 2;

export type SeasonStatus =
  | "draft"
  | "registration_open"
  | "registration_closed"
  | "in_progress"
  | "playoffs"
  | "completed";

/** Season boundaries only: once the regular season is over. */
export function canOpenFor(status: SeasonStatus): boolean {
  return status === "playoffs" || status === "completed";
}

export type Step = "check_in" | "ballot" | "captain_review" | "closed";
export type Outcome =
  | "no_quorum"
  | "no_candidates"
  | "no_majority"
  | "captain_stays"
  | "new_captain"
  | "winner_left"
  | "closed_by_league";
export type LeadRole = "captain" | "co_captain";
export type RosterRole = "captain" | "co_captain" | "player";

/**
 * Whether enough of the roster took part: `percent` of the people on it
 * now, rounded up, and never with nobody on it.
 */
export function quorumMet(
  tookPart: number,
  rosterSize: number,
  percent: number,
): boolean {
  if (rosterSize <= 0) return false;
  return tookPart * 100 >= rosterSize * percent;
}

/** How many of the roster must take part, for "6 of 10 needed". */
export function quorumNeeded(rosterSize: number, percent: number): number {
  return Math.max(1, Math.ceil((rosterSize * percent) / 100));
}

export type Candidate<Id extends string = string> = {
  userId: Id;
  role: LeadRole;
  volunteered: boolean;
  nominated: boolean;
  answer: "accepted" | "declined" | null;
};

/**
 * Standing for the role: they volunteered or said yes to a suggestion, and
 * haven't said no since.
 */
export function standing(c: Candidate): boolean {
  if (c.answer === "declined") return false;
  return c.volunteered || (c.nominated && c.answer === "accepted");
}

/**
 * A suggested teammate still to answer, when the step closes: asked, but
 * not long enough ago to have had a fair chance, or not asked yet.
 */
export function stillAnswering(
  c: Candidate & { askedAt: Date | null },
  now: Date,
): boolean {
  if (!c.nominated || c.volunteered || c.answer !== null) return false;
  if (c.askedAt === null) return true;
  return now.getTime() - c.askedAt.getTime() < ANSWER_GRACE_DAYS * DAY_MS;
}

/**
 * Who is on the ballot: the captain (unless they said they'd hand over),
 * then every teammate on the roster standing for captain. Null when nobody
 * but the captain is standing, so there is nothing to vote on.
 */
export function ballotFor<Id extends string>(input: {
  captainId: Id | null;
  captainSteppingDown: boolean;
  candidates: readonly Candidate<Id>[];
  onRoster: ReadonlySet<Id>;
}): Id[] | null {
  const challengers = input.candidates
    .filter(
      (c) =>
        c.role === "captain" &&
        c.userId !== input.captainId &&
        input.onRoster.has(c.userId) &&
        standing(c),
    )
    .map((c) => c.userId);
  if (challengers.length === 0) return null;
  const keep =
    input.captainId &&
    !input.captainSteppingDown &&
    input.onRoster.has(input.captainId)
      ? [input.captainId]
      : [];
  return [...keep, ...new Set(challengers)];
}

export type Tally<Id extends string = string> =
  { kind: "winner"; userId: Id } | { kind: "no_majority" };

/**
 * A clear majority: one option with more than half the ballots cast. A tie
 * at the top, or a leader at half or less, is no majority.
 */
export function tally<Id extends string>(
  options: readonly { userId: Id; votes: number }[],
): Tally<Id> {
  const total = options.reduce((sum, o) => sum + o.votes, 0);
  if (total === 0) return { kind: "no_majority" };
  const top = Math.max(...options.map((o) => o.votes));
  const leaders = options.filter((o) => o.votes === top);
  if (leaders.length !== 1 || top * 2 <= total) return { kind: "no_majority" };
  return { kind: "winner", userId: leaders[0]!.userId };
}

/** What the ballot's result means for the team. */
export function resultOf<Id extends string>(input: {
  tally: Tally<Id>;
  captainId: Id | null;
  onRoster: ReadonlySet<Id>;
}):
  | { outcome: "no_majority" | "captain_stays" | "winner_left" }
  | { outcome: "new_captain"; electedId: Id } {
  if (input.tally.kind === "no_majority") return { outcome: "no_majority" };
  const winner = input.tally.userId;
  if (winner === input.captainId) return { outcome: "captain_stays" };
  if (!input.onRoster.has(winner)) return { outcome: "winner_left" };
  return { outcome: "new_captain", electedId: winner };
}

/** The captain's choice when they make none in their three days. */
export function defaultChoice(
  captainSteppingDown: boolean,
): "hand_off_now" | "captain_elect" {
  return captainSteppingDown ? "hand_off_now" : "captain_elect";
}

export type CheckInChoice<Id extends string = string> = {
  volunteer: readonly LeadRole[];
  /** One teammate suggested for one role, or nobody. */
  suggest: { userId: Id; role: LeadRole } | null;
  /** The captain's own check-in: they're happy to hand over. */
  steppingDown: boolean;
};

export type ChoiceError =
  | "not_on_team"
  | "suggest_self"
  | "suggest_not_on_team"
  | "already_in_role"
  | "not_captain";

/** Whether a check-in makes sense for this person on this roster. */
export function checkChoice<Id extends string>(
  me: Id,
  roster: ReadonlyMap<Id, RosterRole>,
  choice: CheckInChoice<Id>,
): Result<CheckInChoice<Id>, ChoiceError> {
  const myRole = roster.get(me);
  if (!myRole) return err("not_on_team");
  const holds = (role: RosterRole | undefined, wanted: LeadRole) =>
    role === "captain" || (wanted === "co_captain" && role === "co_captain");
  for (const role of choice.volunteer)
    if (holds(myRole, role)) return err("already_in_role");
  if (choice.suggest) {
    if (choice.suggest.userId === me) return err("suggest_self");
    const theirs = roster.get(choice.suggest.userId);
    if (!theirs) return err("suggest_not_on_team");
    if (holds(theirs, choice.suggest.role)) return err("already_in_role");
  }
  if (choice.steppingDown && myRole !== "captain") return err("not_captain");
  return ok({ ...choice, volunteer: [...new Set(choice.volunteer)] });
}

export type ActError = "paused" | "closed";

/** Whether a check-in or vote can be taken now, for the step it needs. */
export function checkOpen(
  checkIn: {
    step: Step;
    pausedAt: Date | null;
    checkInClosesAt: Date;
    ballotClosesAt: Date | null;
  },
  needs: "check_in" | "ballot",
  now: Date,
): Result<void, ActError> {
  if (checkIn.step !== needs) return err("closed");
  if (checkIn.pausedAt) return err("paused");
  const closes =
    needs === "check_in" ? checkIn.checkInClosesAt : checkIn.ballotClosesAt;
  if (!closes || now >= closes) return err("closed");
  return ok(undefined);
}

/** A suggested teammate can answer until the ballot opens. */
export function canAnswer(checkIn: {
  step: Step;
  pausedAt: Date | null;
}): boolean {
  return checkIn.step === "check_in" && checkIn.pausedAt === null;
}

/** Resuming moves the step's deadline on by the time it was paused. */
export function resumedDeadline(
  deadline: Date,
  pausedAt: Date,
  now: Date,
): Date {
  return new Date(
    deadline.getTime() + Math.max(0, now.getTime() - pausedAt.getTime()),
  );
}
