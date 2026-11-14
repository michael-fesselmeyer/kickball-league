"use client";

import { useActionState, useState } from "react";
import { AgeConfirmation } from "@/components/age-confirmation";
import { formatCents, splitShare } from "@/domain/registration/pricing";
import type { RegisterState } from "./actions";

type Action = (
  previous: RegisterState,
  form: FormData,
) => Promise<RegisterState>;

const input = "rounded-md border border-border bg-surface px-2 py-1";

type TeamProps = {
  action: Action;
  pastTeams: { id: string; name: string }[];
  /** The team fee today (after any early bird), or null when priced per player. */
  teamFeeCents: number | null;
  rosterMin: number;
  rosterMax: number;
  minimumAge: number;
};

export function TeamForm({
  action,
  pastTeams,
  teamFeeCents,
  rosterMin,
  rosterMax,
  minimumAge,
}: TeamProps) {
  const [state, formAction, pending] = useActionState(action, { values: {} });
  const v = state.values;
  const [size, setSize] = useState(
    Number(v.rosterSize) || Math.min(Math.max(14, rosterMin), rosterMax),
  );
  const [teamId, setTeamId] = useState(v.teamId ?? "");
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
      {pastTeams.length > 0 && (
        <label className="flex flex-col gap-1">
          Team
          <select
            name="teamId"
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            className={input}
          >
            <option value="">A new team</option>
            {pastTeams.map((t) => (
              <option key={t.id} value={t.id}>
                Bring back {t.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {teamId === "" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
          <label className="flex flex-col gap-1">
            Team name
            <input
              name="name"
              autoComplete="off"
              defaultValue={v.name}
              maxLength={40}
              required
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1">
            Color
            <input
              name="colorHex"
              type="color"
              defaultValue={v.colorHex || "#e4572e"}
              className="h-9 w-16 rounded-md border border-border bg-surface"
            />
          </label>
        </div>
      )}
      <label className="flex flex-col gap-1">
        Expected roster size
        <input
          name="rosterSize"
          type="number"
          inputMode="numeric"
          min={rosterMin}
          max={rosterMax}
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
          className={`${input} w-24`}
        />
        <span className="text-small text-text-muted">
          Between {rosterMin} and {rosterMax} players.
        </span>
      </label>
      {teamFeeCents !== null && (
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
              Split it: everyone pays a fixed{" "}
              {formatCents(
                splitShare(
                  teamFeeCents,
                  Math.min(Math.max(size || rosterMin, rosterMin), rosterMax),
                ),
              )}{" "}
              through their own link, and you see who has paid.
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
      )}
      <AgeConfirmation minimumAge={minimumAge} />
      <button
        type="submit"
        disabled={pending}
        className="btn self-start btn-primary disabled:opacity-60"
      >
        {pending ? "Registering…" : "Register the team"}
      </button>
    </form>
  );
}

export function FreeAgentForm({
  action,
  priceLabel,
  minimumAge,
}: {
  action: Action;
  priceLabel: string;
  minimumAge: number;
}) {
  const [state, formAction, pending] = useActionState(action, { values: {} });
  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded-lg border border-border p-4"
    >
      {state.error && (
        <p role="alert" className="text-danger">
          {state.error}
        </p>
      )}
      <p>
        No team? Join the free-agent pool and the league places you on a team
        that needs players. {priceLabel}
      </p>
      <AgeConfirmation minimumAge={minimumAge} />
      <button
        type="submit"
        disabled={pending}
        className="btn self-start btn-secondary disabled:opacity-60"
      >
        {pending ? "Joining…" : "Join as a free agent"}
      </button>
    </form>
  );
}
