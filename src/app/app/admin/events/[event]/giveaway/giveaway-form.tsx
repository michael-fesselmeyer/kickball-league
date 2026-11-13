"use client";

import { useActionState, useId } from "react";
import {
  type GiveawayForm,
  MAX_DONOR_LENGTH,
  MAX_PRIZE_LENGTH,
  MAX_RULES_LENGTH,
  MAX_WINNERS,
} from "@/domain/drive/giveaway";
import type { GiveawayFormState } from "./actions";

const control =
  "min-h-11 rounded-input border border-border-strong bg-surface px-3 text-body";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (props: {
    id: string;
    "aria-describedby"?: string;
  }) => React.ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-bold">
        {label}
      </label>
      {children(hint ? { id, "aria-describedby": hintId } : { id })}
      {hint && (
        <p id={hintId} className="text-small text-text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

/** The giveaway's prize, winners, entry window and official rules. */
export function GiveawayFormFields({
  action,
  values,
  submitLabel,
}: {
  action: (
    previous: GiveawayFormState,
    form: FormData,
  ) => Promise<GiveawayFormState>;
  values: GiveawayForm;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {
    values,
    error: null,
  });
  const v = state.values;
  return (
    <form
      action={formAction}
      className="flex flex-col gap-4"
      // Keyed by the values, so a failed save shows what was sent.
      key={JSON.stringify(v)}
    >
      {state.error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {state.error}
        </p>
      )}
      <Field
        label="Prize"
        hint="What the winners get, such as “A $50 bar tab”."
      >
        {(p) => (
          <input
            {...p}
            name="prize"
            required
            maxLength={MAX_PRIZE_LENGTH}
            defaultValue={v.prize}
            className={control}
          />
        )}
      </Field>
      <Field
        label="Donated by (optional)"
        hint="A sponsor or bar that gave the prize, to thank them."
      >
        {(p) => (
          <input
            {...p}
            name="donatedBy"
            maxLength={MAX_DONOR_LENGTH}
            defaultValue={v.donatedBy}
            className={control}
          />
        )}
      </Field>
      <Field label="Number of winners">
        {(p) => (
          <input
            {...p}
            name="winnerCount"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_WINNERS}
            required
            defaultValue={v.winnerCount}
            className={`${control} w-28`}
          />
        )}
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-bold">Entry opens</legend>
        <div className="flex flex-wrap gap-3">
          <Field label="Date">
            {(p) => (
              <input
                {...p}
                name="opensOn"
                type="date"
                required
                defaultValue={v.opensOn}
                className={control}
              />
            )}
          </Field>
          <Field label="Time">
            {(p) => (
              <input
                {...p}
                name="opensTime"
                type="time"
                required
                defaultValue={v.opensTime}
                className={control}
              />
            )}
          </Field>
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-bold">Entry closes</legend>
        <div className="flex flex-wrap gap-3">
          <Field label="Date">
            {(p) => (
              <input
                {...p}
                name="closesOn"
                type="date"
                required
                defaultValue={v.closesOn}
                className={control}
              />
            )}
          </Field>
          <Field label="Time">
            {(p) => (
              <input
                {...p}
                name="closesTime"
                type="time"
                required
                defaultValue={v.closesTime}
                className={control}
              />
            )}
          </Field>
        </div>
      </fieldset>
      <Field
        label="Official rules"
        hint="Shown on the giveaway page. They must say no purchase is necessary: entry is always free."
      >
        {(p) => (
          <textarea
            {...p}
            name="officialRules"
            required
            rows={10}
            maxLength={MAX_RULES_LENGTH}
            defaultValue={v.officialRules}
            className={`${control} py-2`}
          />
        )}
      </Field>
      <button
        type="submit"
        disabled={pending}
        className="btn self-start btn-primary"
      >
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
