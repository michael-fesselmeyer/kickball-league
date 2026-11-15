"use client";

import { useActionState } from "react";
import { publishWaiverAction, type WaiverDraftState } from "./actions";

const input =
  "rounded-md border border-border bg-surface px-2 py-1 aria-[invalid=true]:border-danger";

export function WaiverDraftForm({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  const [state, action, pending] = useActionState<WaiverDraftState, FormData>(
    publishWaiverAction,
    { title, body, errors: {} },
  );
  return (
    <form
      key={`${state.title}\u0000${state.body}`}
      action={action}
      className="flex flex-col gap-3"
      noValidate
    >
      <label className="flex flex-col gap-1">
        Title
        <input
          name="title"
          defaultValue={state.title}
          maxLength={120}
          aria-invalid={state.errors.title ? true : undefined}
          aria-describedby={state.errors.title ? "title-error" : undefined}
          className={input}
        />
        {state.errors.title && (
          <span id="title-error" className="text-small text-danger">
            {state.errors.title}
          </span>
        )}
      </label>
      <label className="flex flex-col gap-1">
        Full text
        <textarea
          name="body"
          defaultValue={state.body}
          rows={14}
          aria-invalid={state.errors.body ? true : undefined}
          aria-describedby={
            state.errors.body ? "body-hint body-error" : "body-hint"
          }
          className={`${input} font-mono text-small`}
        />
        <span id="body-hint" className="text-small text-text-muted">
          Start a line with # for a heading and - for a list item. Leave a blank
          line between paragraphs.
        </span>
        {state.errors.body && (
          <span id="body-error" className="text-small text-danger">
            {state.errors.body}
          </span>
        )}
      </label>
      <button
        type="submit"
        disabled={pending}
        className="btn self-start btn-primary disabled:opacity-60"
      >
        {pending ? "Publishing…" : "Publish as a new version"}
      </button>
      <p className="text-small text-text-muted">
        Published versions cannot be edited. Players who signed an earlier
        version sign again once a season uses the new one.
      </p>
    </form>
  );
}
