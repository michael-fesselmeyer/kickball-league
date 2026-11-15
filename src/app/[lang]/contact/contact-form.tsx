"use client";

import { useActionState } from "react";
import { PARK_RULES, PUBLIC_CATEGORIES } from "@/domain/concerns/concerns";
import { type ContactState, sendContact } from "./actions";

const initial: ContactState = { status: "idle" };
const input =
  "min-h-11 rounded-input border-2 border-border-strong bg-surface px-3 py-2 text-body text-text";

export function ContactForm() {
  const [state, action, pending] = useActionState(sendContact, initial);
  if (state.status === "sent")
    return (
      <p
        role="status"
        className="rounded-card border border-border bg-surface p-4 shadow-card dark:shadow-none"
      >
        <span className="mb-3 sticker">Got it!</span>
        <br />
        Thanks. The league&apos;s admins read every message. If you left an
        email address, the answer comes there.
      </p>
    );
  const error = state.status === "error" ? state.message : undefined;
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <label className="flex flex-col gap-1 font-medium">
        What is it about?
        <select name="category" required className={input} defaultValue="">
          <option value="" disabled>
            Pick one
          </option>
          {Object.entries(PUBLIC_CATEGORIES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 font-medium">
        If it is about the park, which rule?{" "}
        <span className="font-normal text-text-muted">(optional)</span>
        <select name="parkRule" className={input} defaultValue="">
          <option value="">Not sure, or not about the park</option>
          {Object.entries(PARK_RULES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 font-medium">
          Date <span className="font-normal text-text-muted">(optional)</span>
          <input type="date" name="occurredOn" className={input} />
        </label>
        <label className="flex flex-col gap-1 font-medium">
          Field or spot{" "}
          <span className="font-normal text-text-muted">(optional)</span>
          <input name="place" maxLength={80} className={input} />
        </label>
      </div>
      <label className="flex flex-col gap-1 font-medium">
        Your message
        <textarea
          name="body"
          required
          maxLength={2000}
          rows={6}
          className={`${input} min-h-32`}
        />
      </label>
      <label className="flex flex-col gap-1 font-medium">
        Your email, if you want a reply{" "}
        <span className="font-normal text-text-muted">
          (only the league&apos;s admins see it; we delete it a year after we
          close your message)
        </span>
        <input
          type="email"
          name="replyEmail"
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
        {pending ? "Sending…" : "Send to the league"}
      </button>
    </form>
  );
}
