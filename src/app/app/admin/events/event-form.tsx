"use client";

import { useActionState } from "react";
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

const input =
  "min-h-11 rounded-input border border-border-strong bg-surface px-3 text-body";

/**
 * The admin's event form. A theme week needs only its days, so the time and
 * capacity fields hide while it is picked (CSS only, no script).
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
  const timed = "group-has-[option[value=theme_week]:checked]:hidden";
  return (
    <form action={formAction} className="group flex flex-col gap-4">
      {state.error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {state.error}
        </p>
      )}
      <label className="flex flex-col gap-1 font-bold">
        Kind
        <select
          name="kind"
          defaultValue={v.kind}
          className={`${input} font-normal`}
        >
          {EVENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 font-bold">
        Name
        <input
          name="title"
          required
          maxLength={MAX_TITLE_LENGTH}
          defaultValue={v.title}
          className={`${input} font-normal`}
        />
      </label>
      <label className="flex flex-col gap-1 font-bold">
        Place
        <input
          name="place"
          maxLength={MAX_PLACE_LENGTH}
          defaultValue={v.place}
          aria-describedby="place-hint"
          className={`${input} font-normal`}
        />
        <span
          id="place-hint"
          className="text-small font-normal text-text-muted"
        >
          A name and address, such as &ldquo;The Example Tavern, 123 Example
          St&rdquo;. Optional for a theme week.
        </span>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 font-bold">
          Date
          <input
            type="date"
            name="startsOn"
            required
            defaultValue={v.startsOn}
            className={`${input} font-normal`}
          />
        </label>
        <label className="flex flex-col gap-1 font-bold">
          End date (optional)
          <input
            type="date"
            name="endsOn"
            defaultValue={v.endsOn}
            aria-describedby="ends-hint"
            className={`${input} font-normal`}
          />
          <span
            id="ends-hint"
            className="text-small font-normal text-text-muted"
          >
            For a theme week, its last day. Otherwise only for events that run
            over more than one night.
          </span>
        </label>
        <label className={`flex flex-col gap-1 font-bold ${timed}`}>
          Starts at
          <input
            type="time"
            name="startTime"
            defaultValue={v.startTime}
            className={`${input} font-normal`}
          />
        </label>
        <label className={`flex flex-col gap-1 font-bold ${timed}`}>
          Ends at
          <input
            type="time"
            name="endTime"
            defaultValue={v.endTime}
            aria-describedby="end-time-hint"
            className={`${input} font-normal`}
          />
          <span
            id="end-time-hint"
            className="text-small font-normal text-text-muted"
          >
            An end time earlier than the start runs past midnight.
          </span>
        </label>
      </div>
      <label className={`flex flex-col gap-1 font-bold ${timed}`}>
        Capacity (optional)
        <input
          type="number"
          name="capacity"
          min={1}
          max={MAX_CAPACITY}
          inputMode="numeric"
          defaultValue={v.capacity}
          aria-describedby="capacity-hint"
          className={`${input} font-normal sm:max-w-40`}
        />
        <span
          id="capacity-hint"
          className="text-small font-normal text-text-muted"
        >
          Leave blank for no limit. When it fills, players can join a waitlist.
        </span>
      </label>
      <label className="flex flex-col gap-1 font-bold">
        Description
        <textarea
          name="description"
          rows={6}
          maxLength={MAX_DESCRIPTION_LENGTH}
          defaultValue={v.description}
          className="rounded-input border border-border-strong bg-surface px-3 py-2 text-body font-normal"
        />
      </label>
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
