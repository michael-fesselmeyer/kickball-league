"use client";

import { useActionState, useState } from "react";
import { formatCents, splitShare } from "@/domain/registration/pricing";
import type { NewTeamState } from "./actions";

const input = "rounded-md border border-border bg-surface px-2 py-1";

type Props = {
  action: (previous: NewTeamState, form: FormData) => Promise<NewTeamState>;
  /** The team fee today, or null when everyone pays their own fee. */
  teamFeeCents: number | null;
  /** They already paid for themselves, so the new team splits the fee. */
  splitOnly: boolean;
  rosterMin: number;
  rosterMax: number;
};

export function NewTeamForm({
  action,
  teamFeeCents,
  splitOnly,
  rosterMin,
  rosterMax,
}: Props) {
  const [state, formAction, pending] = useActionState(action, { values: {} });
  const v = state.values;
  const [size, setSize] = useState(
    Number(v.expectedSize) || Math.min(Math.max(14, rosterMin), rosterMax),
  );
  const share =
    teamFeeCents === null
      ? null
      : formatCents(
          splitShare(
            teamFeeCents,
            Math.min(Math.max(size || rosterMin, rosterMin), rosterMax),
          ),
        );
  return (
    <form
      action={formAction}
      className="flex flex-col gap-4 rounded-lg border border-border p-4"
    >
      {state.error && (
        <p role="alert" className="text-danger">
          {state.error}
        </p>
      )}
      <label className="flex flex-col gap-1">
        Team name
        <input
          name="name"
          defaultValue={v.name}
          maxLength={40}
          required
          autoComplete="off"
          className={input}
        />
      </label>
      <label className="flex flex-col gap-1">
        Expected team size
        <input
          name="expectedSize"
          type="number"
          inputMode="numeric"
          min={rosterMin}
          max={rosterMax}
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
          className={`${input} w-24`}
        />
        <span className="text-small text-text-muted">
          Between {rosterMin} and {rosterMax} players, counting you.
        </span>
      </label>
      {teamFeeCents !== null &&
        (splitOnly ? (
          <>
            <input type="hidden" name="paymentMode" value="split" />
            <p className="text-text-muted">
              You&apos;ve already paid for your spot, so it counts as your
              share: the team splits its fee, about {share} each.
            </p>
          </>
        ) : (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1">How will the team pay?</legend>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="paymentMode"
                value="split"
                defaultChecked={v.paymentMode !== "full"}
                className="mt-1"
              />
              <span>
                Split it: everyone pays a fixed {share} through their own link.
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="paymentMode"
                value="full"
                defaultChecked={v.paymentMode === "full"}
                className="mt-1"
              />
              <span>
                I&apos;ll pay it all: {formatCents(teamFeeCents)}, and collect
                from the team myself.
              </span>
            </label>
          </fieldset>
        ))}
      <label className="flex flex-col gap-1">
        Note for the league (optional)
        <textarea
          name="note"
          defaultValue={v.note}
          maxLength={500}
          rows={3}
          placeholder="Who's coming with you, and anything the league should know."
          className="rounded-md border border-border bg-surface px-3 py-2"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="btn self-start btn-primary disabled:opacity-60"
      >
        {pending ? "Sending…" : "Send the request"}
      </button>
    </form>
  );
}
