import type { StaffMember } from "@/db/queries/checklist";
import { NOTES_MAX, OFFSET_MAX, TITLE_MAX } from "@/domain/checklist/tasks";

/** Form pieces shared by a season's checklist and its template (ADR 0053). */

const field = "min-h-11 rounded-md border border-border bg-surface px-2 py-1";

export function TitleField({ value }: { value?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-bold">Task</span>
      <input
        name="title"
        required
        maxLength={TITLE_MAX}
        defaultValue={value}
        autoComplete="off"
        className={field}
      />
    </label>
  );
}

export function NotesField({ value }: { value?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-bold">Notes</span>
      <textarea
        name="notes"
        rows={2}
        maxLength={NOTES_MAX}
        defaultValue={value}
        className={field}
      />
    </label>
  );
}

export function OwnerField({
  staff,
  value,
}: {
  staff: readonly StaffMember[];
  value?: string | null;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-bold">Owner</span>
      <select name="owner" defaultValue={value ?? ""} className={field}>
        <option value="">Nobody yet</option>
        {staff.map((s) => (
          <option key={s.userId} value={s.userId}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function DueField({ value }: { value?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-bold">Due</span>
      <input
        type="date"
        name="dueOn"
        required
        defaultValue={value}
        className={field}
      />
    </label>
  );
}

/** Days before or after the season's first day, phone-friendly: no minus sign. */
export function OffsetField({ value }: { value?: number }) {
  const days = value === undefined ? "" : String(Math.abs(value));
  const side = value !== undefined && value > 0 ? "after" : "before";
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="font-bold">Due</legend>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">
          <input
            name="days"
            inputMode="numeric"
            pattern="[0-9]*"
            required
            maxLength={3}
            defaultValue={days}
            aria-label="Days"
            className={`${field} w-20`}
          />
          <span>days</span>
        </label>
        <select
          name="side"
          defaultValue={side}
          aria-label="Before or after the season starts"
          className={field}
        >
          <option value="before">before the season starts</option>
          <option value="after">after the season starts</option>
        </select>
      </div>
      <span className="text-small text-text-muted">
        Up to {OFFSET_MAX} days. 0 days is the first day.
      </span>
    </fieldset>
  );
}
