"use client";

import { useActionState } from "react";
import { MAX_FRIENDS } from "@/domain/interest/interest";
import { type InterestState, sendInterest } from "./actions";

const initial: InterestState = { status: "idle" };
const input =
  "min-h-11 rounded-input border-2 border-border-strong bg-surface px-3 py-2 text-body text-text";

export function InterestForm({
  formId,
  options,
}: {
  formId: string;
  options: { id: string; label: string }[];
}) {
  const [state, action, pending] = useActionState(sendInterest, initial);
  if (state.status === "sent")
    return (
      <p
        role="status"
        className="rounded-card border border-border bg-surface p-4 shadow-card dark:shadow-none"
      >
        <span className="mb-3 sticker">Got it!</span>
        <br />
        Thanks. If the league goes ahead with something you picked, we email you
        once. Answer again with the same address to change your mind.
      </p>
    );
  const error = state.status === "error" ? state.message : undefined;
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="formId" value={formId} />
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 font-medium">
          Which of these would you play?
        </legend>
        {options.map((o) => (
          <label key={o.id} className="flex flex-col gap-1">
            <span>{o.label}</span>
            <select name={`option-${o.id}`} defaultValue="no" className={input}>
              <option value="no">No</option>
              <option value="unsure">Not sure</option>
              <option value="yes">Yes</option>
            </select>
          </label>
        ))}
      </fieldset>
      <label className="flex flex-col gap-1 font-medium">
        How many friends might join you?
        <select name="friends" defaultValue="unsure" className={input}>
          <option value="unsure">Not sure</option>
          <option value="0">Just me</option>
          {Array.from({ length: MAX_FRIENDS }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              {i + 1}
              {i + 1 === MAX_FRIENDS ? " or more" : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 font-medium">
        Your email
        <span className="font-normal text-text-muted">
          (we email you once if something you picked goes ahead, and delete it
          six months after the form closes)
        </span>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          maxLength={254}
          className={input}
        />
      </label>
      {/* Honeypot: hidden from people and from assistive tech, tempting to bots. */}
      <div aria-hidden="true" className="sr-only">
        <label>
          Leave this empty
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      {error && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="btn btn-primary disabled:opacity-60"
      >
        {pending ? "Sending…" : "Send my answer"}
      </button>
    </form>
  );
}
