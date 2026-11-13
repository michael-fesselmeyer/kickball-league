"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import type { UploadState } from "./actions";

const input =
  "min-h-11 rounded-input border border-border-strong bg-bg px-3 py-2";

/** The longest edge the phone sends; the server stores at most 1440. */
const SEND_LONG_EDGE = 2048;
/** Smaller files go as they are. */
const SHRINK_OVER_BYTES = 1_500_000;

/**
 * Shrinks a phone photo before it is sent, so a 5–10 MB camera file goes up
 * as a few hundred kilobytes on a weak signal. Drawing it on a canvas also
 * leaves its metadata behind; the server strips it again either way. When
 * the browser can't decode the file, the original goes and the server says
 * what is wrong with it.
 */
async function shrink(file: File): Promise<File> {
  if (file.size <= SHRINK_OVER_BYTES) return file;
  try {
    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    });
    const scale = Math.min(
      1,
      SEND_LONG_EDGE / Math.max(bitmap.width, bitmap.height),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas
      .getContext("2d")
      ?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.9),
    );
    return blob ? new File([blob], "photo.jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

type Option = { value: string; label: string };

type Props = {
  action: (previous: UploadState, form: FormData) => Promise<UploadState>;
  games: Option[];
  events: Option[];
  teams: Option[];
  /** Chosen from the link that opened the page, or the only team. */
  defaults: { game: string; event: string; team: string };
};

export function UploadForm({ action, ...fields }: Props) {
  const [state, formAction, pending] = useActionState(action, { sent: 0 });
  return (
    <>
      <p role="status" className="font-bold empty:hidden">
        {state.sent > 0 && !state.error
          ? "Thanks! Your photo is with the league for review. We'll let you know if it's used."
          : ""}
      </p>
      {/* A new form after each upload that went through, cleared for the next. */}
      <Form
        key={state.sent}
        state={state}
        formAction={formAction}
        pending={pending}
        {...fields}
      />
    </>
  );
}

function Form({
  state,
  formAction,
  pending,
  games,
  events,
  teams,
  defaults,
}: Omit<Props, "action"> & {
  state: UploadState;
  formAction: (form: FormData) => void;
  pending: boolean;
}) {
  const [shrinking, setShrinking] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  /**
   * With JavaScript, the photo is shrunk first, and the form keeps what was
   * entered if the server refuses it. Without, the form posts as it is.
   */
  async function submit(data: FormData) {
    const file = data.get("photo");
    if (file instanceof File && file.size > 0) {
      setShrinking(true);
      data.set("photo", await shrink(file));
      setShrinking(false);
    }
    startTransition(() => formAction(data));
  }

  const busy = pending || shrinking;
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        e.preventDefault();
        void submit(new FormData(e.currentTarget));
      }}
      className="flex flex-col gap-4 rounded-card border-2 border-text bg-surface p-4 shadow-sticker"
    >
      {state.error && (
        <p role="alert" className="font-bold text-danger">
          {state.error}
        </p>
      )}
      {/* Hints sit outside the labels, so each field's name stays short. */}
      <div className="flex flex-col gap-1">
        <label className="flex flex-col gap-1 font-bold">
          Photo
          <input
            type="file"
            name="photo"
            required
            accept="image/jpeg,image/png,image/webp"
            aria-describedby="photo-hint"
            className={`${input} font-normal`}
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              setPreview(file ? URL.createObjectURL(file) : null);
            }}
          />
        </label>
        <p id="photo-hint" className="text-small text-text-muted">
          A JPEG, PNG or WebP photo. Videos can&apos;t be uploaded.
        </p>
      </div>
      {/* Holds its space, so choosing a photo moves nothing below it. */}
      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-card border border-border bg-surface-2">
        {preview ? (
          // A local preview of the chosen file: never sent anywhere.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt="What you chose to upload"
            className="size-full object-contain"
          />
        ) : (
          <span className="text-small text-text-muted">
            Your photo shows here
          </span>
        )}
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 font-bold">What&apos;s it from?</legend>
        <p className="text-small text-text-muted">
          Pick at least one. The photo shows on those pages once the league
          approves it.
        </p>
        <Choice
          name="game"
          label="Game day"
          options={games}
          value={defaults.game}
        />
        <Choice
          name="event"
          label="Event"
          options={events}
          value={defaults.event}
        />
        <Choice
          name="team"
          label="Team"
          options={teams}
          value={defaults.team}
        />
      </fieldset>

      <div className="flex flex-col gap-1">
        <label className="flex flex-col gap-1 font-bold">
          Caption (optional)
          <textarea
            name="caption"
            maxLength={200}
            rows={2}
            aria-describedby="caption-hint"
            className={`${input} font-normal`}
          />
        </label>
        <p id="caption-hint" className="text-small text-text-muted">
          Up to 200 characters. It also describes the photo for people using
          screen readers.
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            name="consent"
            value="yes"
            required
            aria-describedby="consent-hint"
            className="mt-1 size-5 shrink-0"
          />
          The league may repost this on its socials
        </label>
        <p id="consent-hint" className="pl-8 text-small text-text-muted">
          Only upload photos you took, and check the people in it are happy to
          be posted.
        </p>
      </div>

      <button
        type="submit"
        disabled={busy}
        className="btn self-start btn-primary"
      >
        {busy ? "Sending…" : "Send to the league"}
      </button>
    </form>
  );
}

function Choice({
  name,
  label,
  options,
  value,
}: {
  name: string;
  label: string;
  options: Option[];
  value: string;
}) {
  if (options.length === 0) return null;
  return (
    <label className="flex flex-col gap-1">
      {label}
      <select name={name} defaultValue={value} className={input}>
        <option value="">None</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
