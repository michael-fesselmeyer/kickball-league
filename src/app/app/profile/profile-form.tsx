"use client";

import { useActionState } from "react";
import type { ProfileField, ProfileForm } from "@/domain/profile/profile-form";
import { type ProfileFormState, saveProfileAction } from "./actions";

const input =
  "rounded-md border border-border bg-surface px-2 py-1 aria-[invalid=true]:border-danger";

const GENDER_LABELS: [string, string][] = [
  ["woman", "Woman"],
  ["man", "Man"],
  ["nonbinary", "Nonbinary"],
  ["self_described", "I describe myself another way"],
  ["undisclosed", "Prefer not to say"],
];
const SHIRT_LABELS: [string, string][] = [
  ["xs", "XS"],
  ["s", "S"],
  ["m", "M"],
  ["l", "L"],
  ["xl", "XL"],
  ["xxl", "XXL"],
];

export function ProfileSettingsForm({ values }: { values: ProfileForm }) {
  const [state, action, pending] = useActionState<ProfileFormState, FormData>(
    saveProfileAction,
    { values, errors: {} },
  );
  const v = state.values;

  const described = (name: ProfileField, hint?: boolean) =>
    [state.errors[name] && `${name}-error`, hint && `${name}-hint`]
      .filter(Boolean)
      .join(" ") || undefined;
  const after = (name: ProfileField, hint?: string) => (
    <>
      {hint && (
        <span id={`${name}-hint`} className="text-small text-text-muted">
          {hint}
        </span>
      )}
      {state.errors[name] && (
        <span id={`${name}-error`} className="text-small text-danger">
          {state.errors[name]}
        </span>
      )}
    </>
  );
  const text = (
    name: ProfileField,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement> = {},
    hint?: string,
  ) => (
    <label className="flex flex-col gap-1">
      {label}
      <input
        name={name}
        defaultValue={v[name]}
        aria-invalid={state.errors[name] ? true : undefined}
        aria-describedby={described(name, Boolean(hint))}
        className={input}
        {...props}
      />
      {after(name, hint)}
    </label>
  );
  const select = (
    name: ProfileField,
    label: string,
    options: [string, string][],
    hint?: string,
  ) => (
    <label className="flex flex-col gap-1">
      {label}
      <select
        name={name}
        defaultValue={v[name]}
        aria-invalid={state.errors[name] ? true : undefined}
        aria-describedby={described(name, Boolean(hint))}
        className={input}
      >
        <option value="">Choose…</option>
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
      {after(name, hint)}
    </label>
  );

  const row = "grid grid-cols-1 gap-3 sm:grid-cols-2";
  return (
    <form
      key={JSON.stringify(v)}
      action={action}
      className="flex flex-col gap-8"
      noValidate
    >
      {state.message && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {state.message}
        </p>
      )}
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-h2">About you</legend>
        <div className={row}>
          {text("firstName", "First name", {
            autoComplete: "given-name",
            required: true,
          })}
          {text("lastName", "Last name", {
            autoComplete: "family-name",
            required: true,
          })}
        </div>
        {text("phone", "Mobile phone", {
          type: "tel",
          autoComplete: "tel",
          inputMode: "tel",
          required: true,
        })}
        {text(
          "birthDate",
          "Birth date",
          { type: "date", autoComplete: "bday", required: true },
          "Players must be 18 or older. Only you and the league owners see it.",
        )}
        <div className={row}>
          {select("gender", "Gender", GENDER_LABELS)}
          {select(
            "lineupGender",
            "For the fielding rule, count me with",
            [
              ["woman", "Women"],
              ["man", "Men"],
            ],
            "Only needed if you chose another option.",
          )}
        </div>
        {select("shirtSize", "Shirt size", SHIRT_LABELS)}
      </fieldset>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-h2">Emergency contact</legend>
        <div className={row}>
          {text("emergencyContactName", "Name", { required: true })}
          {text("emergencyContactPhone", "Phone", {
            type: "tel",
            inputMode: "tel",
            required: true,
          })}
        </div>
      </fieldset>
      <button
        type="submit"
        disabled={pending}
        className="btn self-start btn-primary disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save profile"}
      </button>
    </form>
  );
}
