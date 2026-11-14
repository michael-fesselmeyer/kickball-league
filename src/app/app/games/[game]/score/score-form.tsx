"use client";

import { useState } from "react";
import { OutboxStatus, useOutbox } from "@/components/offline-outbox";
import { describeScore } from "@/domain/scores/offline";
import { isOneOf } from "@/domain/guards";
import { OUTCOMES, type ScoreInput } from "@/domain/scores/scores";
import { canSaveOffline, newKey, saveOffline } from "@/lib/pwa/score-outbox";
import { submitScoreAction } from "./actions";
import { SubmitButton } from "@/components/submit-button";

type Game = { id: string; teamAName: string; teamBName: string };

const input =
  "rounded-md border border-border bg-surface px-3 py-2 text-center text-h2 tabular-nums";

const number = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" && value.trim() !== ""
    ? Number(value)
    : Number.NaN;
};

/** The score as typed, or null when the form can't make one. */
function scoreFrom(form: FormData): ScoreInput | null {
  const outcome = form.get("outcome");
  if (!isOneOf(OUTCOMES, outcome)) return null;
  const forfeit = outcome === "forfeit_a" || outcome === "forfeit_b";
  const innings = number(form, "inningsPlayed");
  const score = {
    outcome,
    scoreA: forfeit ? 0 : number(form, "scoreA"),
    scoreB: forfeit ? 0 : number(form, "scoreB"),
    inningsPlayed:
      outcome === "called" && !Number.isNaN(innings) ? innings : null,
  };
  return Number.isNaN(score.scoreA) || Number.isNaN(score.scoreB)
    ? null
    : score;
}

/** Whether a failed submit failed for want of a connection. */
const isNetworkError = (error: unknown) => error instanceof TypeError;

/** The outbox for one game's score screen. */
export function GameOutbox({ gameId }: { gameId: string }) {
  return <OutboxStatus outbox={useOutbox(gameId)} />;
}

/**
 * The final score form. With a signal it submits as usual; with none it
 * saves the score on this phone, to send when the signal is back (ADR 0025).
 * Either way the same key goes with it, so it is saved once.
 */
export function ScoreForm({
  g,
  label,
  clientId,
  version,
  userId,
}: {
  g: Game;
  label: string;
  /** A fresh key from the server, for the first submit. */
  clientId: string;
  /** The score's version as this screen shows it (`scoreVersion`). */
  version: string;
  userId: string;
}) {
  const [key, setKey] = useState(clientId);
  const [problem, setProblem] = useState<string | null>(null);

  async function saveHere(form: FormData, usedKey: string) {
    const score = scoreFrom(form);
    if (!score) {
      setProblem("Check the score: runs from 0 to 99.");
      return;
    }
    const saved = await saveOffline({
      kind: "score",
      key: usedKey,
      gameId: g.id,
      userId,
      enteredAt: new Date().toISOString(),
      version,
      score,
      summary: `Final: ${describeScore({ A: g.teamAName, B: g.teamBName }, score)}`,
    });
    setProblem(
      saved
        ? null
        : "No signal, and this phone couldn't save the score. Try again when you're back in range.",
    );
  }

  async function submit(form: FormData) {
    const usedKey = key;
    // Every submit gets its own key; a retry of this one reuses `usedKey`.
    setKey(newKey());
    setProblem(null);
    if (!navigator.onLine && canSaveOffline()) return saveHere(form, usedKey);
    try {
      await submitScoreAction(g.id, usedKey, form);
    } catch (error) {
      if (!isNetworkError(error)) throw error;
      if (canSaveOffline()) return saveHere(form, usedKey);
      setProblem("No signal. Try again when you're back in range.");
    }
  }

  return (
    <form
      action={submit}
      className="flex flex-col gap-4 rounded-lg border border-border p-4"
    >
      <div className="grid grid-cols-2 gap-3">
        {(
          [
            ["scoreA", g.teamAName],
            ["scoreB", g.teamBName],
          ] as const
        ).map(([name, team]) => (
          <label key={name} className="flex flex-col gap-1 text-center">
            <span className="truncate">{team}</span>
            <input
              name={name}
              type="number"
              inputMode="numeric"
              min={0}
              max={99}
              required
              className={input}
            />
          </label>
        ))}
      </div>
      <label className="flex flex-col gap-1">
        Result
        <select
          name="outcome"
          defaultValue="normal"
          className="rounded-md border border-border bg-surface px-2 py-2"
        >
          <option value="normal">Played to the end</option>
          <option value="called">Called early</option>
          <option value="forfeit_a">{g.teamAName} forfeited</option>
          <option value="forfeit_b">{g.teamBName} forfeited</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        Complete innings, if called early
        <input
          name="inningsPlayed"
          type="number"
          inputMode="numeric"
          min={4}
          max={20}
          className="w-24 rounded-md border border-border bg-surface px-2 py-1"
        />
        <span className="text-small text-text-muted">
          A called game counts after 4 complete innings, with the score at the
          last complete inning. For a forfeit, leave the runs at 0.
        </span>
      </label>
      {problem && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {problem}
        </p>
      )}
      <SubmitButton className="btn btn-primary">{label}</SubmitButton>
    </form>
  );
}
