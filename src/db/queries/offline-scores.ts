import { eq } from "drizzle-orm";
import type { TeamSeasonId, UserId } from "@/domain/ids";
import {
  describeScore,
  halfDecision,
  halfResult,
  type OfflineEnd,
  type OfflineEntry,
  type OfflineHalf,
  type OfflineResult,
  type OfflineScore,
  scoreStillCurrent,
  scoreVersion,
} from "@/domain/scores/offline";
import {
  MIN_CALLED_INNINGS,
  type ReporterRole,
  type ScoreErrors,
} from "@/domain/scores/scores";
import { game, offlineReceipt, scoreReport } from "../schema/game";
import {
  enterHalf,
  type EndError,
  liveGame,
  reportFromInnings,
} from "./live-scores";
import type { Db } from "./schedule";
import { currentScoreState, reportScore, type ScoringGame } from "./scores";

/**
 * Score entries made with no signal and sent later (ADR 0025). Each runs in
 * the caller's transaction: the receipt for its key goes in first, so a
 * resend of the same entry, even at the same moment, waits for the first
 * and then gets the answer the first one got.
 */

export type Applied = {
  result: OfflineResult;
  /** Whether this call changed the game's score, so pages must refresh. */
  changed: boolean;
};

const isResult = (value: unknown): value is OfflineResult =>
  typeof value === "object" &&
  value !== null &&
  "status" in value &&
  "message" in value &&
  (value.status === "saved" ||
    value.status === "unchanged" ||
    value.status === "kept" ||
    value.status === "refused") &&
  typeof value.message === "string";

const refused = (message: string): OfflineResult => ({
  status: "refused",
  message,
});

export async function applyOfflineEntry(
  db: Db,
  input: {
    entry: OfflineEntry;
    g: ScoringGame;
    userId: UserId;
    /** How a final score from this person counts. */
    role: ReporterRole;
    teamSeasonId: TeamSeasonId | null;
    now: Date;
  },
): Promise<Applied> {
  const { entry } = input;
  const [claimed] = await db
    .insert(offlineReceipt)
    .values({
      key: entry.key,
      userId: input.userId,
      gameId: input.g.id,
      kind: entry.kind,
      result: refused("Still being saved."),
      enteredAt: new Date(entry.enteredAt),
      receivedAt: input.now,
    })
    .onConflictDoNothing()
    .returning({ key: offlineReceipt.key });
  if (!claimed) {
    const [receipt] = await db
      .select({
        userId: offlineReceipt.userId,
        gameId: offlineReceipt.gameId,
        result: offlineReceipt.result,
      })
      .from(offlineReceipt)
      .where(eq(offlineReceipt.key, entry.key));
    // A key is only ever its own phone's; anyone else's copy is refused.
    if (
      !receipt ||
      receipt.userId !== input.userId ||
      receipt.gameId !== input.g.id ||
      !isResult(receipt.result)
    )
      return {
        result: refused("This entry was already used."),
        changed: false,
      };
    return { result: receipt.result, changed: false };
  }

  // One change to a game's score at a time: a second phone waits here.
  await db
    .select({ id: game.id })
    .from(game)
    .where(eq(game.id, input.g.id))
    .for("update");
  const applied =
    entry.kind === "half"
      ? await applyHalf(db, entry, input)
      : await applyReport(db, entry, input);
  await db
    .update(offlineReceipt)
    .set({ result: applied.result })
    .where(eq(offlineReceipt.key, entry.key));
  return applied;
}

async function applyHalf(
  db: Db,
  entry: OfflineHalf,
  input: { g: ScoringGame; userId: UserId; now: Date },
): Promise<Applied> {
  const live = await liveGame(db, input.g.id);
  if (!live) return { result: refused("That game is gone."), changed: false };
  const current =
    live.halves.find((h) => h.inning === entry.inning && h.half === entry.half)
      ?.runs ?? null;
  const decision = halfDecision(current, entry);
  if (decision !== "apply")
    return { result: halfResult(entry, decision, current), changed: false };
  const saved = await enterHalf(db, {
    gameId: input.g.id,
    userId: input.userId,
    inning: entry.inning,
    half: entry.half,
    runs: entry.runs,
    now: input.now,
  });
  if (!saved.ok)
    return { result: refused(ERRORS[saved.error]), changed: false };
  return { result: halfResult(entry, "apply", current), changed: true };
}

const ERRORS: Record<Exclude<EndError, ScoreErrors>, string> = {
  not_found: "That game is gone.",
  not_started: "The game hadn't started yet.",
  already_final: "The game is already final. Ask an admin to correct it.",
  no_kicks_first: "Nobody had said who kicks first.",
  invalid: "Runs go from 0 to 99.",
  out_of_order:
    "That half wasn't next: an earlier half is missing on the server.",
  too_many_runs: "A team can't have more than 99 runs in a game.",
  no_innings: "No innings were entered.",
  too_few_innings: `A game called before ${MIN_CALLED_INNINGS} complete innings doesn't count.`,
};

/** A final score: typed in, or from the innings entered (`end`). */
async function applyReport(
  db: Db,
  entry: OfflineScore | OfflineEnd,
  input: {
    g: ScoringGame;
    userId: UserId;
    role: ReporterRole;
    teamSeasonId: TeamSeasonId | null;
    now: Date;
  },
): Promise<Applied> {
  const { g } = input;
  const names = { A: g.teamAName, B: g.teamBName };
  // The same key may have reached the server once already as an ordinary
  // submit whose answer never made it back to the phone.
  const [already] = await db
    .select({ id: scoreReport.id })
    .from(scoreReport)
    .where(eq(scoreReport.clientId, entry.key));
  if (already)
    return {
      result: { status: "unchanged", message: "Your score was already saved." },
      changed: false,
    };

  const { state, history } = await currentScoreState(db, g, input.now);
  const latest = history.reports[0];
  const version = scoreVersion(history.reports, history.responses);
  if (latest && !scoreStillCurrent(entry.version, version)) {
    const theirs = describeScore(names, latest);
    const message =
      state.state === "final"
        ? `The score went final while you were offline: ${theirs}. Yours wasn't saved.`
        : state.state === "disputed"
          ? `The score was disputed while you were offline (${theirs}). An admin will settle it, so yours wasn't saved.`
          : `${latest.reporterName} reported ${theirs} while you were offline, so yours wasn't saved. Confirm or dispute theirs on the score screen.`;
    return { result: { status: "kept", message }, changed: false };
  }

  const report =
    entry.kind === "score"
      ? await reportScore(db, {
          gameId: g.id,
          userId: input.userId,
          role: input.role,
          teamSeasonId: input.teamSeasonId,
          score: entry.score,
          clientId: entry.key,
          now: input.now,
        })
      : await reportFromInnings(db, {
          gameId: g.id,
          userId: input.userId,
          role: input.role,
          teamSeasonId: input.teamSeasonId,
          ending: entry.ending,
          clientId: entry.key,
          now: input.now,
        });
  if (!report.ok) {
    const error = report.error;
    if (typeof error !== "string") {
      const first = error.scoreA ?? error.scoreB ?? error.inningsPlayed;
      return {
        result: refused(first ?? "Check the score."),
        changed: false,
      };
    }
    return {
      result: refused(ERRORS[error]),
      changed: false,
    };
  }
  const [mine] = await db
    .select({
      outcome: scoreReport.outcome,
      scoreA: scoreReport.scoreA,
      scoreB: scoreReport.scoreB,
      inningsPlayed: scoreReport.inningsPlayed,
    })
    .from(scoreReport)
    .where(eq(scoreReport.clientId, entry.key));
  const shown = mine ? describeScore(names, mine) : "your score";
  return {
    result: {
      status: "saved",
      message:
        report.value.state === "final"
          ? `Saved as the final score: ${shown}.`
          : `Saved: ${shown}. It goes final once it's confirmed.`,
    },
    changed: true,
  };
}
