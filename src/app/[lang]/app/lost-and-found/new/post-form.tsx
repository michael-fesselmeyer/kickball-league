"use client";

import { startTransition, useActionState, useState } from "react";
import { shrink } from "@/lib/member-photos/shrink-client";
import { ELSEWHERE } from "@/domain/lost-found/rules";
import type { PostState } from "../actions";

const input =
  "min-h-11 rounded-input border border-border-strong bg-bg px-3 py-2";

type Props = {
  action: (previous: PostState, form: FormData) => Promise<PostState>;
  kind: "found" | "lost";
  places: string[];
};

export function PostForm({ action, kind, places }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const [place, setPlace] = useState(places[0] ?? ELSEWHERE);
  const [shrinking, setShrinking] = useState(false);

  /** With JavaScript the photo is shrunk first; without, the form posts as is. */
  async function submit(data: FormData) {
    const file = data.get("photo");
    if (file instanceof File && file.size > 0) {
      setShrinking(true);
      data.set("photo", await shrink(file));
      setShrinking(false);
    }
    startTransition(() => formAction(data));
  }

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
      <input type="hidden" name="kind" value={kind} />
      <label className="flex flex-col gap-1 font-bold">
        What is it?
        <input
          name="description"
          required
          maxLength={300}
          className={`${input} font-normal`}
          placeholder="Black cleats, size 10"
        />
      </label>
      <label className="flex flex-col gap-1 font-bold">
        {kind === "found" ? "Where did you find it?" : "Where did you lose it?"}
        <select
          name="place"
          value={place}
          onChange={(e) => setPlace(e.target.value)}
          className={`${input} font-normal`}
        >
          {places.map((p) => (
            <option key={p}>{p}</option>
          ))}
          <option>{ELSEWHERE}</option>
        </select>
      </label>
      {place === ELSEWHERE && (
        <label className="flex flex-col gap-1 font-bold">
          Which place?
          <input
            name="placeOther"
            required
            maxLength={80}
            className={`${input} font-normal`}
          />
        </label>
      )}
      {kind === "found" && (
        <label className="flex flex-col gap-1 font-bold">
          Where is it now?
          <input
            name="whereNow"
            required
            maxLength={120}
            className={`${input} font-normal`}
            placeholder="With me, or behind the bar"
          />
        </label>
      )}
      <div className="flex flex-col gap-1">
        <label className="flex flex-col gap-1 font-bold">
          Photo (optional)
          <input
            type="file"
            name="photo"
            accept="image/jpeg,image/png,image/webp"
            aria-describedby="photo-hint"
            className={`${input} font-normal`}
          />
        </label>
        <p id="photo-hint" className="text-small text-text-muted">
          A JPEG, PNG or WebP photo. Its location is removed. Members only see
          it, and it is deleted when the post closes.
        </p>
      </div>
      <button
        type="submit"
        className="btn self-start btn-primary"
        aria-disabled={pending || shrinking}
        onClick={(e) => {
          if (pending || shrinking) e.preventDefault();
        }}
      >
        {pending || shrinking ? "Posting…" : "Post it"}
      </button>
    </form>
  );
}
