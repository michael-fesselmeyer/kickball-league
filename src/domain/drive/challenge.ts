import { err, ok, type Result } from "@/domain/result";
import { localDay } from "@/domain/schedule/public-game";
import { localTime, zonedInstant } from "@/domain/time/zoned";

/**
 * The team sign-up challenge (ADR 0035): the first team whose whole roster
 * has an account and has signed the waiver wins a prize. A player on the
 * roster already has an account (joining needs one), so "signed up" means
 * on the active roster with the waiver signed, the roster board's joined
 * and signed marks. A team counts as complete only at its expected size:
 * its captain's target roster size, else the season's minimum, so a team
 * of two can't win by being small. Pure: no clock and no database.
 */

export const MAX_CHALLENGE_PRIZE_LENGTH = 200;

/** One active roster spot, as the challenge reads it. */
export type RosterSpot = {
  joinedAt: Date;
  /** When they signed this season's waiver; null when not yet. */
  signedAt: Date | null;
};

export type TeamProgress = {
  signedUp: number;
  /** The expected roster: the target size, at least the players on it. */
  of: number;
  /** Whole percent, rounded down so 99.9% never reads as 100. */
  percent: number;
  /**
   * When the last player finished signing up (joined and signed), if the
   * whole expected roster has; null otherwise.
   */
  completedAt: Date | null;
};

/**
 * A team's progress. `expected` is the team's target roster size, or the
 * season's minimum when the captain set none.
 */
export function teamProgress(
  spots: readonly RosterSpot[],
  expected: number,
): TeamProgress {
  const of = Math.max(expected, spots.length, 1);
  let signedUp = 0;
  let last = 0;
  for (const spot of spots) {
    if (spot.signedAt === null) continue;
    signedUp += 1;
    last = Math.max(last, spot.joinedAt.getTime(), spot.signedAt.getTime());
  }
  return {
    signedUp,
    of,
    percent: Math.floor((signedUp * 100) / of),
    completedAt: signedUp === of ? new Date(last) : null,
  };
}

export type RankedTeam<T> = T & {
  progress: TeamProgress;
  /** 1 for the leader; teams level on everything share a rank. */
  rank: number;
  /** Complete by the deadline. */
  qualifies: boolean;
};

/**
 * The leaderboard: teams that completed by the deadline first, earliest
 * completion first (the first to 100% wins; a tie on percent goes to the
 * team whose last player finished signing up first). Then everyone else by
 * percent, then by players signed up. Names break remaining ties for a
 * stable order but not the rank.
 */
export function rankTeams<T extends { name: string; progress: TeamProgress }>(
  teams: readonly T[],
  deadline: Date,
): RankedTeam<T>[] {
  const qualifies = (t: T) =>
    t.progress.completedAt !== null && t.progress.completedAt <= deadline;
  const key = (t: T): [number, number, number, number] => [
    qualifies(t) ? 0 : 1,
    qualifies(t) ? (t.progress.completedAt?.getTime() ?? 0) : 0,
    -t.progress.percent,
    -t.progress.signedUp,
  ];
  const compare = (a: T, b: T) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) {
      const d = (ka[i] ?? 0) - (kb[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  };
  const sorted = [...teams].sort(
    (a, b) => compare(a, b) || a.name.localeCompare(b.name),
  );
  let rank = 0;
  return sorted.map((t, i) => {
    const before = sorted[i - 1];
    if (before === undefined || compare(before, t) !== 0) rank = i + 1;
    return { ...t, rank, qualifies: qualifies(t) };
  });
}

/**
 * The team an admin can confirm: the leader, if it completed by the
 * deadline and no other team shares its rank. Null while nobody has, or
 * when two teams finished at the same instant (the admin then decides).
 */
export function challengeLeader<T>(
  ranked: readonly RankedTeam<T>[],
): RankedTeam<T> | null {
  const [first, second] = ranked;
  if (!first?.qualifies) return null;
  if (second?.qualifies && second.rank === first.rank) return null;
  return first;
}

/** "9 of 12 signed up". */
export function progressLine(p: TeamProgress): string {
  return `${p.signedUp} of ${p.of} signed up`;
}

/** What the admin form sends, as strings. */
export type ChallengeForm = {
  prize: string;
  deadlineOn: string;
  deadlineTime: string;
};

export type ChallengeInput = { prize: string; deadline: Date };

export type ChallengeFormError = "prize" | "deadline";

export const CHALLENGE_FORM_ERRORS: Readonly<
  Record<ChallengeFormError, string>
> = {
  prize: `Describe the prize in up to ${MAX_CHALLENGE_PRIZE_LENGTH} characters.`,
  deadline: "Pick a deadline: a date and a time.",
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function parseChallengeForm(
  form: ChallengeForm,
  timeZone: string,
): Result<ChallengeInput, ChallengeFormError> {
  const prize = form.prize.trim();
  if (prize.length === 0 || prize.length > MAX_CHALLENGE_PRIZE_LENGTH)
    return err("prize");
  const at = Date.parse(`${form.deadlineOn}T12:00:00Z`);
  if (
    !DATE.test(form.deadlineOn) ||
    Number.isNaN(at) ||
    new Date(at).toISOString().slice(0, 10) !== form.deadlineOn ||
    !TIME.test(form.deadlineTime)
  )
    return err("deadline");
  return ok({
    prize,
    deadline: zonedInstant(form.deadlineOn, form.deadlineTime, timeZone),
  });
}

export function challengeFormValues(
  c: ChallengeInput,
  timeZone: string,
): ChallengeForm {
  return {
    prize: c.prize,
    deadlineOn: localDay(c.deadline, timeZone),
    deadlineTime: localTime(c.deadline, timeZone),
  };
}
