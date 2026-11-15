"use client";

import { useState } from "react";
import { OutboxStatus, useOutbox } from "@/components/offline-outbox";
import { describeScore } from "@/domain/scores/offline";
import { isOneOf } from "@/domain/guards";
import {
  OUTCOMES,
  type Outcome,
  REASON_MAX,
  type ScoreInput,
} from "@/domain/scores/scores";
import { canSaveOffline, newKey, saveOffline } from "@/lib/pwa/score-outbox";
import { submitScoreAction } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { KICKBALL_FORM, type ScoreFormRules } from "@/domain/sports/sports";

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
  asAdmin = false,
  reasonRequired = false,
  filled = null,
  rules = KICKBALL_FORM,
}: {
  g: Game;
  label: string;
  /** A fresh key from the server, for the first submit. */
  clientId: string;
  /** The score's version as this screen shows it (`scoreVersion`). */
  version: string;
  userId: string;
  /** An admin's score is a ruling when it forfeits or changes a result. */
  asAdmin?: boolean;
  /** Whether even a played game's score needs a reason (it changes one). */
  reasonRequired?: boolean;
  /** The runs kept live, to start the form from; null when none were. */
  filled?: { scoreA: number; scoreB: number } | null;
  /** The sport's words and limits (ADR 0087); kickball's by default. */
  rules?: ScoreFormRules;
}) {
  const [key, setKey] = useState(clientId);
  const [problem, setProblem] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>("normal");
  const forfeiting = outcome === "forfeit_a" || outcome === "forfeit_b";
  const needsReason = asAdmin && (forfeiting || reasonRequired);

  async function saveHere(form: FormData, usedKey: string) {
    // A ruling carries a reason, which the offline outbox doesn't keep.
    if (asAdmin && (needsReason || String(form.get("reason") ?? "").trim())) {
      setProblem(
        "No signal. An admin's ruling is saved with its reason when you're back in range.",
      );
      return;
    }
    const score = scoreFrom(form);
    if (!score) {
      setProblem(`Check the score: ${rules.unit} from 0 to ${rules.max}.`);
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
      {filled && (
        <p className="text-small text-text-muted">
          Filled in from the live score. Check it, then save.
        </p>
      )}
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
              max={rules.max}
              required={!forfeiting}
              defaultValue={filled?.[name]}
              className={input}
            />
          </label>
        ))}
      </div>
      <label className="flex flex-col gap-1">
        Result
        <select
          name="outcome"
          value={outcome}
          onChange={(e) => setOutcome(e.target.value as Outcome)}
          className="rounded-md border border-border bg-surface px-2 py-2"
        >
          <option value="normal">Played to the end</option>
          <option value="called">Called early</option>
          <option value="forfeit_a">{g.teamAName} forfeited</option>
          <option value="forfeit_b">{g.teamBName} forfeited</option>
        </select>
      </label>
      {rules.period ? (
        <label className="flex flex-col gap-1">
          Complete {rules.period}, if called early
          <input
            name="inningsPlayed"
            type="number"
            inputMode="numeric"
            min={rules.minPeriods}
            max={20}
            className="w-24 rounded-md border border-border bg-surface px-2 py-1"
          />
          <span className="text-small text-text-muted">
            {rules.calledRule} For a forfeit, the {rules.unit} are ignored.
          </span>
        </label>
      ) : (
        <p className="text-small text-text-muted">
          {rules.calledRule} For a forfeit, the {rules.unit} are ignored.
        </p>
      )}
      {asAdmin && (
        <label className="flex flex-col gap-1">
          {needsReason ? "Reason for the ruling" : "Reason (optional)"}
          <textarea
            name="reason"
            rows={3}
            maxLength={REASON_MAX}
            required={needsReason}
            className="rounded-md border border-border bg-surface px-2 py-1"
          />
          <span className="text-small text-text-muted">
            Both captains and the ref are told, and see this reason. The public
            game page shows only that it was a ruling.
          </span>
        </label>
      )}
      {problem && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {problem}
        </p>
      )}
      <SubmitButton className="btn btn-primary">{label}</SubmitButton>
    </form>
  );
}
