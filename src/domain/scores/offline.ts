import { type Half, type HalfInning, HALVES, ordinal } from "./live";
import type { OfflineEntry, OfflineHalf } from "./offline-entry";
import type { ScoreInput } from "./scores";

/**
 * Score entries made with no signal (product-spec.md, section 6; ADR 0025).
 *
 * The phone saves each entry with a key it makes itself and sends it when
 * signal returns. The server takes each key once, and never lets a late
 * entry overwrite a score that changed after the entry was made:
 *
 * - A final score carries the version of the score the person was looking
 *   at. If anyone reported, confirmed or disputed a score since, the
 *   server's score stands and the person is told what it is.
 * - A half-inning carries the runs the person saw in it (none for a new
 *   half). If someone else saved different runs there since, theirs stand.
 *
 * Pure: the caller passes what the server has now. Free of the schema
 * library, so the score screens can use it without loading that.
 */

export type {
  OfflineEnd,
  OfflineEntry,
  OfflineHalf,
  OfflineKind,
  OfflineScore,
} from "./offline-entry";

/** What the person is told once an entry reaches the server. */
export type OfflineResult = {
  /**
   * - saved: the server took it.
   * - unchanged: the server already had exactly this.
   * - kept: something changed on the server first, and that stands.
   * - refused: it could not be saved (a rule, a permission, a final game).
   */
  status: "saved" | "unchanged" | "kept" | "refused";
  message: string;
};

/**
 * The version of a game's score: its latest report and how many answers
 * that report has. It changes whenever anyone reports, confirms or
 * disputes a score.
 */
export function scoreVersion(
  reports: readonly { id: string; reportedAt: Date }[],
  responses: readonly { reportId: string }[],
): string {
  const latest = [...reports].sort(
    (a, b) => b.reportedAt.getTime() - a.reportedAt.getTime(),
  )[0];
  if (!latest) return "none";
  const answers = responses.filter((r) => r.reportId === latest.id).length;
  return `${latest.id}:${answers}`;
}

/** Whether a late final score may still go in. */
export const scoreStillCurrent = (sent: string, now: string) => sent === now;

/**
 * What to do with a half-inning saved offline:
 * - "same": the server already has these runs there; nothing to do.
 * - "apply": the half is as the person saw it, so their runs go in.
 * - "keep": someone saved other runs there since; theirs stand.
 */
export function halfDecision(
  current: number | null,
  entry: Pick<OfflineHalf, "runs" | "was">,
): "same" | "apply" | "keep" {
  if (current === entry.runs) return "same";
  if (current === entry.was) return "apply";
  return "keep";
}

type Names = { A: string; B: string };

/** "Aces 5, Bees 3", "Aces forfeited", or "… (called after 5 innings)". */
export function describeScore(names: Names, score: ScoreInput): string {
  if (score.outcome === "forfeit_a") return `${names.A} forfeited`;
  if (score.outcome === "forfeit_b") return `${names.B} forfeited`;
  const line = `${names.A} ${score.scoreA}, ${names.B} ${score.scoreB}`;
  return score.outcome === "called"
    ? `${line} (called after ${score.inningsPlayed} innings)`
    : line;
}

/** "the top of the 3rd" */
export const halfName = (inning: number, half: Half) =>
  `the ${half} of the ${ordinal(inning)}`;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The answer for a half-inning saved offline. */
export function halfResult(
  entry: Pick<OfflineHalf, "inning" | "half" | "runs">,
  decision: "same" | "apply" | "keep",
  current: number | null,
): OfflineResult {
  const where = halfName(entry.inning, entry.half);
  if (decision === "same")
    return {
      status: "unchanged",
      message: `${capitalize(where)} already had ${plural(entry.runs, "run")}.`,
    };
  if (decision === "apply")
    return {
      status: "saved",
      message: `Saved ${plural(entry.runs, "run")} in ${where}.`,
    };
  return {
    status: "kept",
    message: `Someone else saved ${
      current === null ? "no runs" : plural(current, "run")
    } in ${where} first, so yours (${entry.runs}) wasn't used.`,
  };
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * What the live scorer shows: the server's halves with the halves still
 * waiting on the phone laid over them, oldest first, in the order of play.
 */
export function withWaiting(
  halves: readonly HalfInning[],
  waiting: readonly OfflineEntry[],
): HalfInning[] {
  const merged = [...halves];
  for (const e of waiting) {
    if (e.kind !== "half") continue;
    const half = { inning: e.inning, half: e.half, runs: e.runs };
    const at = merged.findIndex(
      (h) => h.inning === e.inning && h.half === e.half,
    );
    if (at === -1) merged.push(half);
    else merged[at] = half;
  }
  return merged.sort(
    (a, b) =>
      a.inning - b.inning || HALVES.indexOf(a.half) - HALVES.indexOf(b.half),
  );
}
