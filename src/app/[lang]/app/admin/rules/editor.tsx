"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import {
  BODY_MAX,
  NOTICE_DAYS,
  SUGGESTED_SECTIONS,
  SUMMARY_MAX,
  TITLE_MAX,
  type SubmittedSection,
} from "@/domain/rules/rules";
import { publishRulesAction, type RulesFormState } from "./actions";
import { FormError } from "@/components/form-error";

const control =
  "min-h-11 rounded-input border border-border-strong bg-surface px-3 text-body";

const INITIAL: RulesFormState = { draft: null, error: null, stale: false };

/**
 * The rules editor (ADR 0062): every section with its title and text, a
 * box to remove it, a blank section to add, and the change's summary, start
 * date and notice. A refusal brings back everything typed.
 */
export function RulesEditor({
  current,
  version,
  today,
  earliestNotice,
}: {
  current: readonly { id: string; title: string; body: string }[];
  version: string;
  today: string;
  /** The first start date a change with a notice may have. */
  earliestNotice: string;
}) {
  const [state, action] = useActionState(publishRulesAction, INITIAL);
  const fromDraft = state.draft && !state.stale ? state.draft : null;
  const blank: SubmittedSection = {
    id: null,
    title: "",
    body: "",
    remove: false,
  };
  const rows: SubmittedSection[] = fromDraft
    ? fromDraft.sections
    : [...current.map((s) => ({ ...s, remove: false })), blank];

  return (
    <form action={action} className="flex flex-col gap-6">
      <input type="hidden" name="version" value={version} />
      <FormError message={state.error} attempt={state} />
      {state.stale && state.draft && (
        <details className="rounded-lg border border-border p-3">
          <summary className="min-h-11 cursor-pointer py-2 font-bold underline">
            Your unpublished text
          </summary>
          <div className="flex flex-col gap-3 pt-2">
            {state.draft.sections
              .filter((s) => s.title || s.body)
              .map((s, i) => (
                <div key={i} className="flex flex-col gap-1">
                  <p className="font-bold">
                    {s.title || "Untitled"}
                    {s.remove && " (to remove)"}
                  </p>
                  <p className="text-small whitespace-pre-line">{s.body}</p>
                </div>
              ))}
          </div>
        </details>
      )}

      <datalist id="rule-section-titles">
        {SUGGESTED_SECTIONS.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>

      {/* One key per editor version, so a reload after a stale publish
          starts from the rules as they are now. */}
      <div key={version} className="flex flex-col gap-6">
        {rows.map((s, i) => {
          const isNew = s.id === null;
          const n = i + 1;
          return (
            <fieldset
              key={s.id ?? `new-${i}`}
              className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
            >
              <legend className="px-1 font-bold">
                {isNew ? "Add a section" : `Section ${n}`}
              </legend>
              <input type="hidden" name="id" value={s.id ?? ""} />
              <label className="flex flex-col gap-1">
                <span className="font-bold">Title</span>
                <input
                  name="title"
                  defaultValue={s.title}
                  maxLength={TITLE_MAX}
                  list="rule-section-titles"
                  autoComplete="off"
                  className={control}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-bold">Text</span>
                <textarea
                  name="body"
                  defaultValue={s.body}
                  maxLength={BODY_MAX}
                  rows={isNew ? 4 : 8}
                  className={`${control} py-2`}
                  aria-describedby="rules-format"
                />
              </label>
              {!isNew && (
                <label className="check-row">
                  <input
                    type="checkbox"
                    name="remove"
                    value={s.id ?? ""}
                    defaultChecked={s.remove}
                    className="size-5"
                  />
                  Remove this section
                </label>
              )}
            </fieldset>
          );
        })}
      </div>
      <p id="rules-format" className="text-small text-text-muted">
        Plain text. Leave a blank line between paragraphs, and start lines with
        &ldquo;- &rdquo; for a list.
      </p>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-h3">About this change</legend>
        <label className="flex flex-col gap-1">
          <span className="font-bold">What changed, in one line</span>
          <input
            name="summary"
            required
            maxLength={SUMMARY_MAX}
            defaultValue={fromDraft?.summary ?? ""}
            autoComplete="off"
            className={control}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-bold">Takes effect</span>
          <input
            type="date"
            name="effectiveOn"
            min={today}
            defaultValue={fromDraft?.effectiveOn || today}
            className={control}
          />
        </label>
        <label className="check-row-top">
          <input
            type="checkbox"
            name="notice"
            value="1"
            defaultChecked={fromDraft?.notice ?? false}
            className="mt-1 size-5"
            aria-describedby="notice-hint"
          />
          <span>Email every player in the active seasons about it</span>
        </label>
        <p id="notice-hint" className="text-small text-text-muted">
          Players get the email at least {NOTICE_DAYS} days before the change
          takes effect, so a change with a notice can start on {earliestNotice}{" "}
          at the earliest. The email follows each player&apos;s quiet hours and
          email settings.
        </p>
      </fieldset>

      <SubmitButton className="btn self-start btn-primary">
        Publish the change
      </SubmitButton>
    </form>
  );
}
