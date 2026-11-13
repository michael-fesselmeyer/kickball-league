"use client";

import { useActionState, useId, useState } from "react";
import {
  EVENT_KINDS,
  type EventForm,
  KIND_LABELS,
  MAX_CAPACITY,
  MAX_DESCRIPTION_LENGTH,
  MAX_PLACE_LENGTH,
  MAX_TITLE_LENGTH,
} from "@/domain/events/event";
import type { EventFormState } from "./actions";

const control =
  "min-h-11 rounded-input border border-border-strong bg-surface px-3 text-body";

/**
 * A labelled control with an optional hint. The hint sits outside the label
 * and is tied to the control with aria-describedby, so the field's name stays
 * short ("Place") and the hint is read after it.
 */
function Field({
  label,
  hint,
  hidden,
  className = "",
  children,
}: {
  label: string;
  hint?: string;
  hidden?: boolean;
  className?: string;
  children: (props: {
    id: string;
    "aria-describedby"?: string;
  }) => React.ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className={`flex flex-col gap-1 ${className}`} hidden={hidden}>
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

/**
 * The admin's event form. A theme week needs only its days, so the time and
 * capacity fields hide while it is picked. Hidden fields are still sent and
 * ignored, so switching back keeps what was typed.
 */
export function EventFormFields({
  action,
  values,
  submitLabel,
}: {
  action: (previous: EventFormState, form: FormData) => Promise<EventFormState>;
  values: EventForm;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {
    values,
    error: null,
  });
  const v = state.values;
  const [kind, setKind] = useState(v.kind);
  const themeWeek = kind === "theme_week";
  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {state.error}
        </p>
      )}
      <Field label="Kind">
        {(props) => (
          <select
            {...props}
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className={control}
          >
            {EVENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Name">
        {(props) => (
          <input
            {...props}
            name="title"
            required
            maxLength={MAX_TITLE_LENGTH}
            defaultValue={v.title}
            className={control}
          />
        )}
      </Field>
      <Field
        label="Place"
        hint={`A name and address, such as "The Example Tavern, 123 Example St". Optional for a theme week.`}
      >
        {(props) => (
          <input
            {...props}
            name="place"
            maxLength={MAX_PLACE_LENGTH}
            defaultValue={v.place}
            className={control}
          />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={themeWeek ? "First day" : "Date"}>
          {(props) => (
            <input
              {...props}
              type="date"
              name="startsOn"
              required
              defaultValue={v.startsOn}
              className={control}
            />
          )}
        </Field>
        <Field
          label={themeWeek ? "Last day" : "End date (optional)"}
          hint={
            themeWeek
              ? "Blank for a one-day theme."
              : "Only for an event that runs over more than one night."
          }
        >
          {(props) => (
            <input
              {...props}
              type="date"
              name="endsOn"
              defaultValue={v.endsOn}
              className={control}
            />
          )}
        </Field>
        <Field label="Starts at" hidden={themeWeek}>
          {(props) => (
            <input
              {...props}
              type="time"
              name="startTime"
              defaultValue={v.startTime}
              className={control}
            />
          )}
        </Field>
        <Field
          label="Ends at"
          hint="An end time earlier than the start runs past midnight."
          hidden={themeWeek}
        >
          {(props) => (
            <input
              {...props}
              type="time"
              name="endTime"
              defaultValue={v.endTime}
              className={control}
            />
          )}
        </Field>
      </div>
      <Field
        label="Capacity (optional)"
        hint="Leave blank for no limit. When it fills, players can join a waitlist."
        hidden={themeWeek}
      >
        {(props) => (
          <input
            {...props}
            type="number"
            name="capacity"
            min={1}
            max={MAX_CAPACITY}
            inputMode="numeric"
            defaultValue={v.capacity}
            className={`${control} sm:max-w-40`}
          />
        )}
      </Field>
      <Field label="Description">
        {(props) => (
          <textarea
            {...props}
            name="description"
            rows={6}
            maxLength={MAX_DESCRIPTION_LENGTH}
            defaultValue={v.description}
            className="rounded-input border border-border-strong bg-surface px-3 py-2 text-body"
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
