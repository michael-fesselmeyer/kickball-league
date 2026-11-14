"use client";

import { useActionState, useId, useState } from "react";
import {
  ACTIVITIES,
  ACTIVITY_LABELS,
  type FriendForm,
  MAX_AREA_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_NAME_LENGTH,
  MAX_URL_LENGTH,
} from "@/domain/friends/friend-form";
import {
  LOGO_ERRORS,
  LOGO_UPLOAD_TYPES,
  MAX_LOGO_UPLOAD_BYTES,
} from "@/domain/friends/logo";
import type { FriendFormState } from "./actions";

const control =
  "min-h-11 rounded-input border border-border-strong bg-surface px-3 text-body";

/** A labelled control, with its hint tied to it by aria-describedby. */
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

/** Adding or editing a directory entry, with an optional logo upload. */
export function FriendFormFields({
  action,
  values,
  submitLabel,
  hasLogo,
}: {
  action: (
    previous: FriendFormState,
    form: FormData,
  ) => Promise<FriendFormState>;
  values: FriendForm;
  submitLabel: string;
  hasLogo: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {
    values,
    error: null,
  });
  // A file too big for the upload is refused here, before it is sent.
  const [fileError, setFileError] = useState<string | null>(null);
  const v = state.values;
  const error = fileError ?? state.error;

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        const file = new FormData(e.currentTarget).get("logo");
        if (file instanceof File && file.size > MAX_LOGO_UPLOAD_BYTES) {
          e.preventDefault();
          setFileError(LOGO_ERRORS.logo_too_large);
        } else setFileError(null);
      }}
    >
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      <Field label="League name">
        {(p) => (
          <input
            {...p}
            name="name"
            autoComplete="off"
            required
            maxLength={MAX_NAME_LENGTH}
            defaultValue={v.name}
            className={control}
          />
        )}
      </Field>
      <Field label="Sport or activity">
        {(p) => (
          // After a refused save React resets the form, and a select goes
          // back to the option it was first drawn with; a new key redraws it
          // with the value the admin sent.
          <select
            key={v.activity}
            {...p}
            name="activity"
            defaultValue={v.activity}
            className={control}
          >
            {ACTIVITIES.map((a) => (
              <option key={a} value={a}>
                {ACTIVITY_LABELS[a]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field
        label="Neighborhood or park"
        hint="Optional. For example, Prospect Park."
      >
        {(p) => (
          <input
            {...p}
            name="area"
            maxLength={MAX_AREA_LENGTH}
            defaultValue={v.area}
            className={control}
          />
        )}
      </Field>
      <Field
        label="Short description"
        hint={`Optional. Up to ${MAX_DESCRIPTION_LENGTH} characters.`}
      >
        {(p) => (
          <textarea
            {...p}
            name="description"
            rows={3}
            maxLength={MAX_DESCRIPTION_LENGTH}
            defaultValue={v.description}
            className={`${control} py-2`}
          />
        )}
      </Field>
      <Field
        label="Website"
        hint="The full https:// address. Plain http links aren't allowed."
      >
        {(p) => (
          <input
            {...p}
            name="url"
            type="url"
            inputMode="url"
            required
            maxLength={MAX_URL_LENGTH}
            placeholder="https://"
            defaultValue={v.url}
            className={control}
          />
        )}
      </Field>
      <label className="flex min-h-11 items-center gap-3">
        <input
          type="checkbox"
          name="linksBack"
          value="yes"
          defaultChecked={v.linksBack}
          className="size-5"
        />
        They link back to us
      </label>
      <Field
        label={hasLogo ? "Replace the logo" : "Logo"}
        hint="Optional. PNG, JPEG or WebP under 800 KB. It's shrunk to a small square copy."
      >
        {(p) => (
          <input
            {...p}
            name="logo"
            type="file"
            accept={LOGO_UPLOAD_TYPES.join(",")}
            className="min-h-11 text-body"
          />
        )}
      </Field>
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
