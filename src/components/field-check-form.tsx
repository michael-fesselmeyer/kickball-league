import { FILE_MESSAGES, type FileProblem } from "@/domain/books/files";
import { GAME_DAY_MESSAGES, NOTE_MAX } from "@/domain/gameday/checklist";
import { kickoff } from "@/domain/schedule/format";
import { SubmitButton } from "./submit-button";

/** The words for a game-day form's error code, or null. */
export function gameDayError(code: string | undefined): string | null {
  if (!code) return null;
  return (
    GAME_DAY_MESSAGES[code] ??
    (code in FILE_MESSAGES ? FILE_MESSAGES[code as FileProblem] : null) ??
    "That didn't save. Try again."
  );
}

/**
 * A field's set-up or end-of-day check (issue #409): fine, or a problem
 * with a note saying what it was; the end-of-day check takes an optional
 * photo. Shows the check already saved, which saving again replaces.
 */
export function FieldCheckForm({
  kind,
  action,
  saved,
  timeZone,
  idPrefix,
}: {
  kind: "setup" | "close";
  action: (form: FormData) => Promise<void>;
  saved: { status: "ok" | "problem"; at: Date; note: string | null } | null;
  timeZone: string;
  idPrefix: string;
}) {
  const okLabel =
    kind === "setup" ? "Set up inside the permit" : "Field left clean";
  return (
    <form action={action} className="flex flex-col gap-3">
      {saved && (
        <p className="text-small">
          <strong>
            {saved.status === "ok"
              ? okLabel
              : kind === "setup"
                ? "Set-up problem noted"
                : "Problem noted"}
          </strong>{" "}
          at {kickoff(saved.at, timeZone)}
          {saved.note ? `: ${saved.note}` : "."} Saving again replaces it.
        </p>
      )}
      <fieldset className="flex flex-col gap-1">
        <legend className="font-bold">
          {kind === "setup" ? "How did set-up go?" : "How was the field left?"}
        </legend>
        <label className="flex min-h-11 items-center gap-3">
          <input type="radio" name="status" value="ok" required />
          {okLabel}
        </label>
        <label className="flex min-h-11 items-center gap-3">
          <input type="radio" name="status" value="problem" />
          There was a problem
        </label>
      </fieldset>
      <label htmlFor={`${idPrefix}-note`} className="flex flex-col gap-1">
        <span>Note (needed for a problem)</span>
        <textarea
          id={`${idPrefix}-note`}
          name="note"
          rows={2}
          maxLength={NOTE_MAX}
          className="rounded-md border border-border bg-surface px-2 py-2"
        />
      </label>
      {kind === "close" && (
        <label htmlFor={`${idPrefix}-photo`} className="flex flex-col gap-1">
          <span>Photo (optional)</span>
          <input
            id={`${idPrefix}-photo`}
            type="file"
            name="photo"
            accept="image/*"
            capture="environment"
          />
        </label>
      )}
      <SubmitButton className="btn self-start btn-primary">Save</SubmitButton>
    </form>
  );
}
