"use client";

import { useActionState } from "react";
import type { SeasonField, SeasonForm } from "@/domain/season/settings";
import type { SeasonFormState } from "./actions";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft (hidden from players)",
  registration_open: "Registration open",
  registration_closed: "Registration closed",
  in_progress: "In progress",
  playoffs: "Playoffs",
  completed: "Completed",
};

const input =
  "rounded-md border border-border bg-surface px-2 py-1 aria-[invalid=true]:border-danger";

type Props = {
  action: (
    previous: SeasonFormState,
    form: FormData,
  ) => Promise<SeasonFormState>;
  values: SeasonForm;
  /** The current status, when editing; creating always makes a draft. */
  status?: string;
  submitLabel: string;
};

export function SeasonSettingsForm({
  action,
  values,
  status,
  submitLabel,
}: Props) {
  const [state, formAction, pending] = useActionState(action, {
    values,
    status,
    errors: {},
  });
  const v = state.values;

  const field = (
    name: SeasonField,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement> = {},
    hint?: string,
  ) => {
    const error = state.errors[name];
    const described = [error && `${name}-error`, hint && `${name}-hint`]
      .filter(Boolean)
      .join(" ");
    return (
      <label className="flex flex-col gap-1">
        {label}
        <input
          name={name}
          defaultValue={v[name]}
          aria-invalid={error ? true : undefined}
          aria-describedby={described || undefined}
          className={input}
          {...props}
        />
        {hint && (
          <span id={`${name}-hint`} className="text-small text-text-muted">
            {hint}
          </span>
        )}
        {error && (
          <span id={`${name}-error`} className="text-small text-danger">
            {error}
          </span>
        )}
      </label>
    );
  };

  const fieldset = "flex flex-col gap-3";
  const row = "grid grid-cols-1 gap-3 sm:grid-cols-2";

  return (
    // The key resets the uncontrolled inputs to the values the server sent back.
    <form
      key={JSON.stringify(v)}
      action={formAction}
      className="flex flex-col gap-8"
      noValidate
    >
      {state.message && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {state.message}
        </p>
      )}

      <fieldset className={fieldset}>
        <legend className="mb-2 text-h2">Season</legend>
        {field("name", "Name", { required: true, maxLength: 80 })}
        <div className={row}>
          {field("startsOn", "First game day", {
            type: "date",
            required: true,
          })}
          {field("endsOn", "Last game day", { type: "date", required: true })}
        </div>
        {status !== undefined && (
          <label className="flex flex-col gap-1">
            Status
            <select name="status" defaultValue={state.status} className={input}>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
      </fieldset>

      <fieldset className={fieldset}>
        <legend className="mb-2 text-h2">Price</legend>
        <div className="flex flex-wrap gap-4">
          {(
            [
              ["per_player", "Per player"],
              ["per_team", "Per team"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2">
              <input
                type="radio"
                name="feeModel"
                value={value}
                defaultChecked={v.feeModel === value}
              />
              {label}
            </label>
          ))}
        </div>
        {state.errors.feeModel && (
          <p className="text-small text-danger">{state.errors.feeModel}</p>
        )}
        <div className={row}>
          {field("playerFee", "Player fee ($)", { inputMode: "decimal" })}
          {field("teamFee", "Team fee ($)", { inputMode: "decimal" })}
          {field("freeAgentFee", "Free agent fee ($)", {
            inputMode: "decimal",
          })}
        </div>
        <div className={row}>
          {field("earlyBirdDiscount", "Early-bird discount ($)", {
            inputMode: "decimal",
          })}
          {field("earlyBirdEndsOn", "Early bird ends", { type: "date" })}
        </div>
      </fieldset>

      <fieldset className={fieldset}>
        <legend className="mb-2 text-h2">Registration</legend>
        <div className={row}>
          {field("registrationOpensOn", "Opens", { type: "date" })}
          {field("registrationClosesOn", "Closes", { type: "date" })}
          {field(
            "paymentDeadlineOn",
            "Payment deadline",
            { type: "date" },
            "Deadlines last until 11:59 pm league time.",
          )}
        </div>
      </fieldset>

      <fieldset className={fieldset}>
        <legend className="mb-2 text-h2">Teams and games</legend>
        <div className={row}>
          {field(
            "maxTeams",
            "Most teams",
            { inputMode: "numeric" },
            "Leave empty for no limit.",
          )}
          <span />
          {field("rosterMin", "Smallest roster", {
            inputMode: "numeric",
            required: true,
          })}
          {field("rosterMax", "Largest roster", {
            inputMode: "numeric",
            required: true,
          })}
        </div>
        <label className="flex flex-col gap-1">
          Games per team on a game day
          <select
            name="gamesPerTeamPerDay"
            defaultValue={v.gamesPerTeamPerDay}
            className={input}
          >
            <option value="1">One game</option>
            <option value="2">A doubleheader</option>
          </select>
        </label>
      </fieldset>

      <button
        type="submit"
        disabled={pending}
        className="btn self-start btn-primary disabled:opacity-60"
      >
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
