"use client";

import { useActionState } from "react";
import {
  type EmergencyField,
  FIRST_AID_MAX,
  RELATIONSHIP_MAX,
} from "@/domain/emergency/emergency";
import type { ProfileField } from "@/domain/profile/profile-form";
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

type Field = ProfileField | EmergencyField;

export function ProfileSettingsForm({
  values,
}: {
  values: ProfileFormState["values"];
}) {
  const [state, action, pending] = useActionState<ProfileFormState, FormData>(
    saveProfileAction,
    { values, errors: {} },
  );
  const v = state.values;

  const described = (name: Field, hint?: boolean) =>
    [state.errors[name] && `${name}-error`, hint && `${name}-hint`]
      .filter(Boolean)
      .join(" ") || undefined;
  const after = (name: Field, hint?: string) => (
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
    name: Field,
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
      <fieldset
        className="flex flex-col gap-3"
        aria-describedby="emergency-consent"
      >
        <legend className="mb-2 text-h2">Emergency contact</legend>
        <p id="emergency-consent" className="text-text-muted">
          Who should we call if you&apos;re hurt at a game? The league keeps
          this encrypted. Only the two captains and the ref of a game
          you&apos;re in can see it, and only on that game&apos;s day, so
          whoever is at the field can reach someone. Each time one of them opens
          it, the league records who and when. League admins don&apos;t see it.
          Saving it means you agree to that; you can change it any time, and
          it&apos;s deleted with your account.
        </p>
        <div className={row}>
          {text("emergencyContactName", "Name", { required: true })}
          {text(
            "emergencyContactRelationship",
            "Relationship (optional)",
            { maxLength: RELATIONSHIP_MAX },
            "Such as partner, parent or friend.",
          )}
        </div>
        {text("emergencyContactPhone", "Phone", {
          type: "tel",
          inputMode: "tel",
          required: true,
        })}
        <label className="flex flex-col gap-1">
          First-aid note (optional)
          <textarea
            name="firstAidNote"
            defaultValue={v.firstAidNote}
            rows={3}
            maxLength={FIRST_AID_MAX}
            aria-invalid={state.errors.firstAidNote ? true : undefined}
            aria-describedby={described("firstAidNote", true)}
            className={input}
          />
          {after(
            "firstAidNote",
            "Only what you choose to share, such as an allergy or a condition someone helping you should know about.",
          )}
        </label>
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
