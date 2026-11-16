"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { LineScore } from "@/components/line-score";
import { OutboxStatus, useOutbox } from "@/components/offline-outbox";
import { isOneOf } from "@/domain/guards";
import {
  calledScore,
  HALVES,
  lineScore,
  type LiveSnapshot,
  ordinal,
  positionLabel,
  sideFor,
} from "@/domain/scores/live";
import { withWaiting } from "@/domain/scores/offline";
import {
  CALL_REASONS,
  type CallReason,
  MIN_CALLED_INNINGS,
} from "@/domain/scores/scores";
import {
  addRun,
  runsSoFar,
  type UndoStep,
  undoStep,
} from "@/domain/scores/tally";
import { canSaveOffline, newKey, saveOffline } from "@/lib/pwa/score-outbox";
import {
  endGameAction,
  kicksFirstAction,
  saveHalfAction,
  undoAction,
} from "./actions";
import { SubmitButton } from "@/components/submit-button";
import {
  PermitWatchNote,
  type PermitProps,
  usePermitWatch,
} from "./permit-watch";
import { type ClockProps, GameClockNote, useGameClock } from "./game-clock";
import {
  clockAnnouncement,
  permitAnnouncement,
} from "@/domain/gameday/announce";
import { useTally } from "./use-tally";

/** Takes back the last tap, and says which. */
function UndoButton({
  step,
  onUndo,
}: {
  step: NonNullable<UndoStep>;
  onUndo: () => Promise<void>;
}) {
  return (
    <form action={onUndo}>
      <SubmitButton className="btn w-full btn-secondary">
        {step.kind === "run"
          ? "Undo the last run"
          : `Undo: reopen the ${positionLabel(step.tally).toLowerCase()}`}
      </SubmitButton>
    </form>
  );
}

/** The phone's clock to the minute; 0 on the server and first paint. */
function subscribeMinute(tick: () => void) {
  const timer = setInterval(tick, 30_000);
  return () => clearInterval(timer);
}
const minuteNow = () => Math.floor(Date.now() / 30_000) * 30_000;
const noClock = () => 0;

const CALL_REASON_LABEL: Record<CallReason | "", string> = {
  daylight: "Daylight: too dark to play",
  field_time: "Field time: the field must be clear",
  "": "Something else, such as rain or an injury",
};

/** A whole number from a form field, or NaN. */
const integer = (value: unknown) =>
  typeof value === "string" && /^\d{1,3}$/.test(value.trim())
    ? Number(value)
    : Number.NaN;

const runsIn = (n: number) => `${n} run${n === 1 ? "" : "s"}`;

/**
 * The live scorer's controls. With no signal, halves and the end of the
 * game are saved on this phone and shown as if entered, then sent in order
 * when the signal is back (ADR 0025). While any are waiting, new entries
 * queue behind them, so the server gets them in the order they were made.
 */
export function Scoring({
  gameId,
  userId,
  kicksFirst,
  snapshot,
  names,
  scorePage,
  version,
  endKey,
  permit,
  clock,
  endOfPlay,
}: {
  gameId: string;
  userId: string;
  kicksFirst: "A" | "B";
  snapshot: LiveSnapshot;
  names: { A: string; B: string };
  scorePage: string;
  /** The final score's version as this screen shows it (`scoreVersion`). */
  version: string;
  /** A fresh key from the server for ending the game. */
  endKey: string;
  /** The field's permit window and the rules, when the game has them. */
  permit: PermitProps | null;
  /** The game's start and its innings and time limit, when it has a start. */
  clock: ClockProps | null;
  /** When play must end and why (#467), to say why a called game ended. */
  endOfPlay: { endsAt: string; endReason: CallReason } | null;
}) {
  const stamp = useSyncExternalStore(subscribeMinute, minuteNow, noClock);
  const timeUp =
    endOfPlay !== null &&
    stamp !== 0 &&
    stamp >= new Date(endOfPlay.endsAt).getTime();
  // Until the ref picks, a game called once time is up was called for the
  // end of play's reason; before that, for something else.
  const [pickedReason, setPickedReason] = useState<CallReason | "" | null>(
    null,
  );
  const callReason =
    pickedReason ?? (timeUp && endOfPlay ? endOfPlay.endReason : "");
  const outbox = useOutbox(gameId);
  const [stored, setTally] = useTally(gameId);
  const [notice, setNotice] = useState<string | null>(null);
  const [nextEndKey, setNextEndKey] = useState(endKey);
  const halves = withWaiting(snapshot.halves, outbox.entries);
  const shown = { ...snapshot, halves };
  const line = lineScore(halves, kicksFirst);
  const called = calledScore(halves, kicksFirst);
  const next = line.next;
  const last = line.last;
  const clockState = useGameClock(clock, next);
  const watch = usePermitWatch(permit, halves.length);
  const announcement = [
    clockState ? clockAnnouncement(clockState) : "",
    watch && permit ? permitAnnouncement(watch, permit.endReason) : "",
  ]
    .filter((sentence) => sentence !== "")
    .join(" ");
  const team = (side: "A" | "B") => names[side];
  const waiting = outbox.entries.length > 0;
  // Offline, or behind entries still waiting: save it on the phone.
  const onPhone = () => (!navigator.onLine || waiting) && canSaveOffline();

  async function save(entry: Parameters<typeof saveOffline>[0]) {
    const saved = await saveOffline(entry);
    setNotice(
      saved
        ? null
        : "No signal, and this phone couldn't save it. Try again when you're back in range.",
    );
  }

  async function saveHalf(form: FormData) {
    setNotice(null);
    const position = form.get("position");
    const [rawInning, half] =
      typeof position === "string"
        ? position.split(":")
        : [form.get("inning"), form.get("half")];
    const runs = form.has("runs")
      ? integer(form.get("runs"))
      : integer(form.get("typedRuns"));
    const inning = integer(rawInning);
    if (onPhone()) {
      if (!isOneOf(HALVES, half) || Number.isNaN(runs) || Number.isNaN(inning))
        return setNotice("Enter runs from 0 to 99.");
      const was =
        halves.find((h) => h.inning === inning && h.half === half)?.runs ??
        null;
      return save({
        kind: "half",
        key: newKey(),
        gameId,
        userId,
        enteredAt: new Date().toISOString(),
        inning,
        half,
        runs,
        was,
        summary: `${positionLabel({ inning, half })}: ${runsIn(runs)}`,
      });
    }
    await online(() => saveHalfAction(gameId, form));
  }

  async function end(form: FormData) {
    setNotice(null);
    const ending = form.get("ending");
    if (ending !== "normal" && ending !== "called") return;
    const key = nextEndKey;
    setNextEndKey(newKey());
    // Nothing left to count on this phone.
    setTally(null);
    if (onPhone()) {
      const result =
        ending === "called" && called
          ? `called after the ${ordinal(called.inningsPlayed)}: ${names.A} ${called.scoreA}, ${names.B} ${called.scoreB}`
          : `${names.A} ${line.totalA}, ${names.B} ${line.totalB}`;
      return save({
        kind: "end",
        key,
        gameId,
        userId,
        enteredAt: new Date().toISOString(),
        version,
        ending,
        callReason:
          ending === "called" && isOneOf(CALL_REASONS, callReason)
            ? callReason
            : null,
        summary: `Game over, ${result}`,
      });
    }
    await online(() => endGameAction(gameId, key, form));
  }

  /** Runs a Server Action; with no signal, says what to do instead. */
  async function online(run: () => Promise<void>, offline?: string) {
    if (offline && (!navigator.onLine || waiting)) return setNotice(offline);
    try {
      await run();
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      setNotice(offline ?? "No signal. Try again when you're back in range.");
    }
  }

  const NEEDS_SIGNAL =
    "This needs a signal. To fix a half now, change its runs below instead.";

  const kicking = next ? team(sideFor(next.half, kicksFirst)) : "";
  const runs = runsSoFar(stored, next);
  const lastHalf = last
    ? (halves.find((h) => h.inning === last.inning && h.half === last.half) ??
      null)
    : null;
  const step = undoStep(next, runs, lastHalf);

  /** Takes back the last tap: a run on this phone, or the half just ended. */
  async function undo() {
    if (!step) return;
    setNotice(null);
    // A half's runs go back on the counter, ready once it reopens.
    setTally(step.tally);
    if (step.kind === "half")
      await online(() => undoAction(gameId), NEEDS_SIGNAL);
  }

  return (
    <>
      <OutboxStatus outbox={outbox} />
      {clockState && <GameClockNote state={clockState} />}
      {watch && <PermitWatchNote watch={watch} />}
      {/* One hidden status for both clocks, so the screen has one place a
          screen reader hears them; it changes only at phase changes and the
          30, 15 and 5 minute marks. */}
      {(clock || permit) && (
        <p role="status" className="sr-only">
          {announcement}
        </p>
      )}
      {notice && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {notice}
        </p>
      )}
      {snapshot.reported && (
        <p role="status" className="rounded-lg border border-success p-3">
          A final score has been reported.{" "}
          <Link href={scorePage} className="underline">
            See it on the score screen
          </Link>
          .
        </p>
      )}

      <LineScore teamA={names.A} teamB={names.B} snapshot={shown} />

      {next && (
        <section
          aria-labelledby="next-half"
          className="flex flex-col gap-4 rounded-lg border-2 border-text p-4 shadow-sticker"
        >
          <div className="flex items-baseline justify-between gap-3">
            <div className="min-w-0">
              <h2 id="next-half" className="text-h3">
                {positionLabel(next)}
              </h2>
              <p className="truncate text-text-muted">{kicking} kicking</p>
            </div>
            <p
              aria-live="polite"
              className="flex shrink-0 items-baseline gap-2 tabular-nums"
            >
              <span className="font-display text-h1">{runs}</span>
              <span>{runs === 1 ? "run" : "runs"}</span>
            </p>
          </div>
          {/* One thumb: the big button counts, the next one ends the half. */}
          <button
            type="button"
            onClick={() => setTally(addRun(next, runs))}
            className="btn min-h-28 flex-col gap-0 text-h1 btn-primary"
          >
            +1 run
            <span className="text-body font-normal">
              <span className="sr-only">for </span>
              {kicking}
            </span>
          </button>
          <form action={saveHalf}>
            <input type="hidden" name="inning" value={next.inning} />
            <input type="hidden" name="half" value={next.half} />
            <input type="hidden" name="runs" value={runs} />
            <SubmitButton className="btn min-h-16 w-full text-h3 btn-secondary">
              End half{runs === 0 ? ", no runs" : `, ${runsIn(runs)}`}
            </SubmitButton>
          </form>
          {step && <UndoButton step={step} onUndo={undo} />}
          <details className="rounded-lg border border-border p-3">
            <summary className="min-h-11 content-center">
              Type the runs instead
            </summary>
            <form action={saveHalf} className="mt-3 flex items-end gap-2">
              <input type="hidden" name="inning" value={next.inning} />
              <input type="hidden" name="half" value={next.half} />
              <label className="flex flex-col gap-1">
                Runs this half
                <input
                  name="typedRuns"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={99}
                  required
                  className="min-h-11 w-24 rounded-input border border-border-strong bg-surface px-3 text-center tabular-nums"
                />
              </label>
              <SubmitButton className="btn btn-primary">Save</SubmitButton>
            </form>
          </details>
        </section>
      )}
      {!next && step && <UndoButton step={step} onUndo={undo} />}

      {last && (
        <section aria-labelledby="fix" className="flex flex-col gap-3">
          <h2 id="fix" className="text-h3">
            Fix a mistake
          </h2>
          <details className="rounded-lg border border-border p-3">
            <summary className="min-h-11 content-center">
              Change the runs in an earlier half
            </summary>
            <form
              action={saveHalf}
              className="mt-3 flex flex-wrap items-end gap-2"
            >
              <label className="flex flex-col gap-1">
                Half-inning
                <select
                  name="position"
                  defaultValue={`${last.inning}:${last.half}`}
                  className="min-h-11 rounded-input border border-border-strong bg-surface px-3"
                >
                  {halves.map((h) => (
                    <option
                      key={`${h.inning}:${h.half}`}
                      value={`${h.inning}:${h.half}`}
                    >
                      {positionLabel(h)} ({team(sideFor(h.half, kicksFirst))}
                      ): {h.runs}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                Runs
                <input
                  name="typedRuns"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={99}
                  required
                  className="min-h-11 w-20 rounded-input border border-border-strong bg-surface px-3 text-center tabular-nums"
                />
              </label>
              <SubmitButton className="btn btn-primary">Save</SubmitButton>
            </form>
          </details>
        </section>
      )}

      {last && (
        <section aria-labelledby="end" className="flex flex-col gap-3">
          <h2 id="end" className="text-h3">
            End the game
          </h2>
          <p className="text-small text-text-muted">
            This reports the final score. The captains confirm it on the score
            screen as usual.
          </p>
          <form action={end} className="flex flex-col gap-2">
            {called && (
              <fieldset className="flex flex-col gap-1 rounded-lg border border-border p-3">
                <legend className="px-1 text-small font-bold">
                  If you call it, why?
                </legend>
                {(["daylight", "field_time", ""] as const).map((value) => (
                  <label
                    key={value || "other"}
                    className="flex min-h-11 items-center gap-2"
                  >
                    <input
                      type="radio"
                      name="callReason"
                      value={value}
                      checked={callReason === value}
                      onChange={() => setPickedReason(value)}
                      className="size-5"
                    />
                    {CALL_REASON_LABEL[value]}
                  </label>
                ))}
              </fieldset>
            )}
            <SubmitButton
              name="ending"
              value="normal"
              className="btn btn-primary"
            >
              Game over: {names.A} {line.totalA}, {names.B} {line.totalB}
            </SubmitButton>
            {called ? (
              <SubmitButton
                name="ending"
                value="called"
                className="btn btn-secondary"
              >
                Called after the {ordinal(called.inningsPlayed)}: {names.A}{" "}
                {called.scoreA}, {names.B} {called.scoreB}
              </SubmitButton>
            ) : (
              <p className="text-small text-text-muted">
                A game called before {MIN_CALLED_INNINGS} complete innings
                doesn’t count. If the weather stops it, tell an admin it’s a
                rain-out.
              </p>
            )}
          </form>
          {called && line.completeInnings * 2 < halves.length && (
            <p className="text-small text-text-muted">
              A called game stands at the last complete inning, so the runs in
              the unfinished {ordinal(line.completeInnings + 1)} don’t count.
            </p>
          )}
        </section>
      )}

      <details className="rounded-lg border border-border p-3">
        <summary className="min-h-11 content-center">
          {team(kicksFirst)} kick first. Wrong team?
        </summary>
        <form
          action={(form) =>
            online(
              () => kicksFirstAction(gameId, form),
              "Switching who kicks first needs a signal.",
            )
          }
          className="mt-3 flex flex-col gap-2"
        >
          <p className="text-small text-text-muted">
            Switching moves every top half to the other team.
          </p>
          <SubmitButton
            name="side"
            value={kicksFirst === "A" ? "B" : "A"}
            className="btn btn-secondary"
          >
            {team(kicksFirst === "A" ? "B" : "A")} kick first
          </SubmitButton>
        </form>
      </details>
    </>
  );
}
