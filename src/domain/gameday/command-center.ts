import { type HalfInning, lineScore, type Side } from "../scores/live";

/**
 * The game-day command center (docs/information-architecture.md, "Admin:
 * game day"): every game of the day with its field, ref, check-in and score
 * state, as plain JSON-safe data so the page can poll it. Pure: the query
 * hands over rows and this decides what each game needs.
 */

/** A ref who has not checked in this close to kickoff is flagged. */
export const REF_LATE_MS = 15 * 60_000;

/** How often the open screen asks for fresh state. */
export const COMMAND_POLL_MS = 10_000;

export type CommandRow = {
  id: string;
  status:
    | "scheduled"
    | "in_progress"
    | "final"
    | "postponed"
    | "cancelled"
    | "forfeit";
  slotCancelled: boolean;
  startsAt: Date;
  endsAt: Date;
  fieldName: string;
  teamA: { id: string; name: string };
  teamB: { id: string; name: string };
  kicksFirst: Side | null;
  scoreA: number | null;
  scoreB: number | null;
  referee: { name: string; checkedInAt: Date | null } | null;
  /** The latest reported final score, if any. */
  report: { scoreA: number; scoreB: number } | null;
  halves: HalfInning[];
};

/**
 * What the score needs: nothing yet (upcoming), being played (on, or live
 * with runs entered), a report waiting for the other captain, final, called
 * off, or missing (its slot is over and nobody entered anything).
 */
export type ScoreState =
  "upcoming" | "on" | "live" | "reported" | "final" | "called_off" | "missing";

export type RefState = "none" | "waiting" | "late" | "checked_in";

export type CommandGame = {
  id: string;
  /** ISO instants, so the state survives JSON. */
  startsAt: string;
  endsAt: string;
  fieldName: string;
  teamA: string;
  teamB: string;
  score: ScoreState;
  /** Runs so far (live), the reported score, or the final score. */
  runs: { a: number; b: number } | null;
  /** "Top 3rd" while live. */
  inning: string | null;
  referee: { name: string; state: RefState; checkedInAt: string | null };
};

export type CommandState = {
  /** The local date shown, YYYY-MM-DD. */
  date: string;
  /** When this state was read (ISO). */
  readAt: string;
  games: CommandGame[];
  counts: {
    games: number;
    fields: number;
    refsIn: number;
    refsAssigned: number;
    live: number;
    missing: number;
  };
};

const ordinal = (n: number) => {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
};

export function scoreState(row: CommandRow, now: Date): ScoreState {
  if (row.status === "final" || row.status === "forfeit") return "final";
  if (
    row.slotCancelled ||
    row.status === "cancelled" ||
    row.status === "postponed"
  )
    return "called_off";
  if (row.report) return "reported";
  if (row.status === "in_progress" || row.halves.length > 0) return "live";
  if (now < row.startsAt) return "upcoming";
  if (now <= row.endsAt) return "on";
  return "missing";
}

export function refState(row: CommandRow, now: Date): RefState {
  if (!row.referee) return "none";
  if (row.referee.checkedInAt) return "checked_in";
  return now.getTime() >= row.startsAt.getTime() - REF_LATE_MS
    ? "late"
    : "waiting";
}

function runsOf(
  row: CommandRow,
  score: ScoreState,
): { runs: CommandGame["runs"]; inning: string | null } {
  if (score === "final" && row.scoreA !== null && row.scoreB !== null)
    return { runs: { a: row.scoreA, b: row.scoreB }, inning: null };
  if (score === "reported" && row.report)
    return {
      runs: { a: row.report.scoreA, b: row.report.scoreB },
      inning: null,
    };
  if (score === "live") {
    const line = lineScore(row.halves, row.kicksFirst ?? "A");
    const last = line.last;
    return {
      runs: { a: line.totalA, b: line.totalB },
      inning: last
        ? `${last.half === "top" ? "Top" : "Bottom"} ${ordinal(last.inning)}`
        : null,
    };
  }
  return { runs: null, inning: null };
}

/** The screen's state from the day's rows, games in kickoff and field order. */
export function commandState(
  rows: readonly CommandRow[],
  date: string,
  now: Date,
): CommandState {
  const games = [...rows]
    .sort(
      (x, y) =>
        x.startsAt.getTime() - y.startsAt.getTime() ||
        x.fieldName.localeCompare(y.fieldName),
    )
    .map((row): CommandGame => {
      const score = scoreState(row, now);
      return {
        id: row.id,
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
        fieldName: row.fieldName,
        teamA: row.teamA.name,
        teamB: row.teamB.name,
        score,
        ...runsOf(row, score),
        referee: {
          name: row.referee?.name ?? "",
          state: refState(row, now),
          checkedInAt: row.referee?.checkedInAt?.toISOString() ?? null,
        },
      };
    });
  const playing = games.filter((g) => g.score !== "called_off");
  return {
    date,
    readAt: now.toISOString(),
    games,
    counts: {
      games: games.length,
      fields: new Set(playing.map((g) => g.fieldName)).size,
      refsIn: playing.filter((g) => g.referee.state === "checked_in").length,
      refsAssigned: playing.filter((g) => g.referee.state !== "none").length,
      live: games.filter((g) => g.score === "live" || g.score === "on").length,
      missing: games.filter((g) => g.score === "missing").length,
    },
  };
}
