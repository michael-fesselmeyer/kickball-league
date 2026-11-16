"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import {
  checkImportText,
  IMPORT_MAX,
  type ImportedSection,
  splitRulebook,
} from "@/domain/rules/rulebook-import";
import { numberedBlocksOf } from "@/domain/rules/rulebook";
import { BODY_MAX, SUMMARY_MAX, TITLE_MAX } from "@/domain/rules/rules";
import { type ImportState, importRulebookAction } from "./actions";

const control =
  "min-h-11 rounded-input border border-border-strong bg-surface px-3 text-body";

const INITIAL: ImportState = { error: null };

/**
 * Import in two steps (ADR 0086): paste the text, see it split into
 * numbered sections and rules, fix titles and text, leave sections out, then
 * save. The text is split in the browser and sent to the server only when
 * saved; the server checks it again.
 */
export function RulebookImport({
  version,
  hasRules,
}: {
  version: string;
  hasRules: boolean;
}) {
  const [text, setText] = useState("");
  const [split, setSplit] = useState<{
    sections: ImportedSection[];
    warnings: string[];
  } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [state, action] = useActionState(importRulebookAction, INITIAL);

  const review = () => {
    const checked = checkImportText(text);
    if (!checked.ok) {
      setProblem(
        checked.error === "empty"
          ? "Paste the rulebook text first."
          : `That's more than ${IMPORT_MAX.toLocaleString("en-US")} characters. Import it in parts.`,
      );
      return;
    }
    const result = splitRulebook(checked.value);
    if (result.sections.length === 0) {
      setProblem("No sections found in that text.");
      return;
    }
    setProblem(null);
    setSplit(result);
  };

  if (!split)
    return (
      <div className="flex flex-col gap-3">
        <label htmlFor="rulebook-text" className="font-bold">
          Rulebook text
        </label>
        <p id="rulebook-text-help" className="text-small text-text-muted">
          Copy the text out of the rulebook and paste it here. Put each
          section&apos;s heading on its own line, such as &ldquo;3.
          Pitching&rdquo;, and number each rule, such as &ldquo;3.1&rdquo;.
          You&apos;ll check how it was split before anything is saved.
        </p>
        <textarea
          id="rulebook-text"
          aria-describedby="rulebook-text-help"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          className={`${control} py-2`}
        />
        {problem && (
          <p role="alert" className="rounded-lg border border-danger p-3">
            {problem}
          </p>
        )}
        <button
          type="button"
          onClick={review}
          className="min-h-11 self-start rounded-input bg-brand px-4 font-bold text-on-brand"
        >
          Split into sections
        </button>
      </div>
    );

  return (
    <form action={action} className="flex flex-col gap-6">
      <input type="hidden" name="version" value={version} />
      <p>
        Found {split.sections.length}{" "}
        {split.sections.length === 1 ? "section" : "sections"}. Fix any title or
        text, and tick &ldquo;Leave out&rdquo; for anything that isn&apos;t a
        rule.{" "}
        {hasRules &&
          "A section with the same title as a current one replaces its text; current sections not listed here are removed."}
      </p>
      {split.warnings.length > 0 && (
        <ul role="status" className="rounded-lg border border-warning p-3">
          {split.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {state.error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {state.error}
        </p>
      )}
      <ol className="flex flex-col gap-6">
        {split.sections.map((s, i) => (
          <li key={i}>
            <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <legend className="px-1 font-bold">
                Section {i + 1} ·{" "}
                {
                  numberedBlocksOf("x", s.body).filter((b) => b.kind === "rule")
                    .length
                }{" "}
                numbered rules
              </legend>
              <label className="flex flex-col gap-1">
                Title
                <input
                  name="title"
                  defaultValue={s.title}
                  maxLength={TITLE_MAX}
                  className={control}
                />
              </label>
              <label className="flex flex-col gap-1">
                Text
                <textarea
                  name="body"
                  defaultValue={s.body}
                  rows={8}
                  maxLength={BODY_MAX + 1000}
                  className={`${control} py-2`}
                />
              </label>
              <label className="flex min-h-11 items-center gap-2">
                <input type="checkbox" name="skip" value={i} />
                Leave out
              </label>
            </fieldset>
          </li>
        ))}
      </ol>
      <label className="flex flex-col gap-1">
        What changed, in one line
        <input
          name="summary"
          defaultValue={
            hasRules ? "Replaced the rulebook" : "Added the rulebook"
          }
          maxLength={SUMMARY_MAX}
          className={control}
        />
      </label>
      <label className="flex flex-col gap-1">
        Starts on (blank for today)
        <input type="date" name="effectiveOn" className={control} />
      </label>
      <div className="flex flex-wrap gap-3">
        <SubmitButton className="min-h-11 rounded-input bg-brand px-4 font-bold text-on-brand">
          Save the rulebook
        </SubmitButton>
        <button
          type="button"
          onClick={() => setSplit(null)}
          className="min-h-11 rounded-input border border-border-strong px-4"
        >
          Back to the text
        </button>
      </div>
      <p className="text-small text-text-muted">
        Saving doesn&apos;t change who can read it. That is the switch above,
        and it starts at owners only.
      </p>
    </form>
  );
}
