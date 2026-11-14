"use client";

import { useActionState, useId } from "react";
import {
  MAX_NOTES_LENGTH,
  MAX_PLACE_LENGTH,
  MAX_SPOTS,
  ROLE_LABELS,
  VOLUNTEER_ROLES,
} from "@/domain/volunteer/limits";
import type { ShiftForm } from "@/domain/volunteer/shifts";
import type { ShiftFormState } from "./actions";

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

/** A volunteer shift: the job, the game day or event, when, where, spots. */
export function ShiftFormFields({
  action,
  values,
  occasions,
  submitLabel,
}: {
  action: (previous: ShiftFormState, form: FormData) => Promise<ShiftFormState>;
  values: ShiftForm;
  occasions: readonly { value: string; label: string }[];
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
      <Field label="Job">
        {(p) => (
          <select
            {...p}
            name="role"
            required
            defaultValue={v.role}
            className={control}
          >
            {VOLUNTEER_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="For" hint="A season's game day, or an upcoming event.">
        {(p) => (
          <select
            {...p}
            name="occasion"
            required
            defaultValue={v.occasion}
            className={control}
          >
            <option value="">Choose…</option>
            {occasions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      <div className="flex flex-wrap gap-3">
        <Field label="Date">
          {(p) => (
            <input
              {...p}
              name="on"
              type="date"
              required
              defaultValue={v.on}
              className={control}
            />
          )}
        </Field>
        <Field label="Starts">
          {(p) => (
            <input
              {...p}
              name="starts"
              type="time"
              required
              defaultValue={v.starts}
              className={control}
            />
          )}
        </Field>
        <Field label="Ends">
          {(p) => (
            <input
              {...p}
              name="ends"
              type="time"
              required
              defaultValue={v.ends}
              className={control}
            />
          )}
        </Field>
      </div>
      <Field label="Spots" hint={`How many people, 1 to ${MAX_SPOTS}.`}>
        {(p) => (
          <input
            {...p}
            name="spots"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_SPOTS}
            required
            defaultValue={v.spots}
            className={`${control} w-28`}
          />
        )}
      </Field>
      <Field label="Where (optional)" hint="Such as “Field 2, by the gate”.">
        {(p) => (
          <input
            {...p}
            name="place"
            maxLength={MAX_PLACE_LENGTH}
            defaultValue={v.place}
            className={control}
          />
        )}
      </Field>
      <Field
        label="Notes (optional)"
        hint="Anything a volunteer should know or bring."
      >
        {(p) => (
          <textarea
            {...p}
            name="notes"
            rows={3}
            maxLength={MAX_NOTES_LENGTH}
            defaultValue={v.notes}
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
