import { parseId, type UserId } from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import { addDays, daysBetween } from "@/domain/season/rollover";

/**
 * The season ops checklist (ADR 0061): the league-running jobs owners and
 * admins share each season, the template they come from, and when each
 * task's owner hears about it.
 */

export const TITLE_MAX = 120;
export const NOTES_MAX = 1000;
/** How far a template task can sit from the season's first day. */
export const OFFSET_MAX = 365;
/** A reminder goes this many days before a task is due. */
export const REMIND_DAYS_BEFORE = 3;
/** An overdue task older than this no longer sends its one reminder. */
export const OVERDUE_REMINDER_WINDOW = 30;

export type TemplateTaskInput = {
  title: string;
  notes: string;
  offsetDays: number;
};

/**
 * What a new league's template starts with: the jobs most seasons need,
 * dated from the season's first day. Owners change, add and remove them.
 */
export const STARTER_TEMPLATE: readonly TemplateTaskInput[] = [
  {
    title: "Renew the field permits",
    notes: "Apply or renew with the parks department for every field and day.",
    offsetDays: -60,
  },
  {
    title: "Get the insurance certificate",
    notes:
      "The parks department asks for a current certificate with each permit.",
    offsetDays: -45,
  },
  {
    title: "Open registration",
    notes: "Check the prices, deadlines and waiver, then open sign-ups.",
    offsetDays: -42,
  },
  {
    title: "Book the bar for the season party",
    notes: "Confirm the date, headcount and any deposit.",
    offsetDays: -30,
  },
  {
    title: "Order shirts",
    notes: "Order once registration closes, with the sizes from the roster.",
    offsetDays: -21,
  },
  {
    title: "Line up refs",
    notes: "Confirm enough referees for every game day.",
    offsetDays: -14,
  },
  {
    title: "Send the schedule",
    notes: "Publish the schedule and announce it to the league.",
    offsetDays: -7,
  },
  {
    title: "Send the end-of-season survey",
    notes: "Open the survey once the last games are played.",
    offsetDays: 63,
  },
];

/** A template task's due date in a season that starts on `startsOn`. */
export function dueOnFor(startsOn: string, offsetDays: number): string {
  return addDays(startsOn, offsetDays);
}

export type ChecklistFormError =
  "empty_title" | "too_long" | "bad_date" | "bad_offset" | "bad_owner";

export const CHECKLIST_FORM_ERRORS: Record<ChecklistFormError, string> = {
  empty_title: "Give the task a title.",
  too_long: `Keep the title under ${TITLE_MAX} characters and the notes under ${NOTES_MAX}.`,
  bad_date: "Pick a due date.",
  bad_offset: `Pick a number of days within ${OFFSET_MAX} of the season's first day.`,
  bad_owner: "Pick an owner or admin, or nobody yet.",
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function text(
  title: string,
  notes: string,
): Result<{ title: string; notes: string }, ChecklistFormError> {
  const t = title.trim();
  const n = notes.trim();
  if (!t) return err("empty_title");
  if (t.length > TITLE_MAX || n.length > NOTES_MAX) return err("too_long");
  return ok({ title: t, notes: n });
}

/**
 * The owner chosen in a form: empty for nobody, otherwise one of the
 * league's owners and admins.
 */
function owner(
  raw: string,
  staff: ReadonlySet<string>,
): Result<UserId | null, ChecklistFormError> {
  if (!raw) return ok(null);
  const id = parseId<UserId>(raw);
  return id && staff.has(id) ? ok(id) : err("bad_owner");
}

export type TaskInput = {
  title: string;
  notes: string;
  dueOn: string;
  ownerId: UserId | null;
};

/** A season task's form: title, notes, due date and owner. */
export function parseTaskForm(
  values: { title: string; notes: string; dueOn: string; owner: string },
  staff: ReadonlySet<string>,
): Result<TaskInput, ChecklistFormError> {
  const words = text(values.title, values.notes);
  if (!words.ok) return words;
  if (!DATE.test(values.dueOn) || Number.isNaN(Date.parse(values.dueOn)))
    return err("bad_date");
  const who = owner(values.owner, staff);
  if (!who.ok) return who;
  return ok({ ...words.value, dueOn: values.dueOn, ownerId: who.value });
}

export type TemplateInput = TemplateTaskInput & { ownerId: UserId | null };

/** A template task's form: title, notes, days from the start and owner. */
export function parseTemplateForm(
  values: { title: string; notes: string; offsetDays: string; owner: string },
  staff: ReadonlySet<string>,
): Result<TemplateInput, ChecklistFormError> {
  const words = text(values.title, values.notes);
  if (!words.ok) return words;
  const raw = values.offsetDays.trim();
  const offsetDays = Number(raw);
  if (
    !/^-?\d+$/.test(raw) ||
    !Number.isInteger(offsetDays) ||
    Math.abs(offsetDays) > OFFSET_MAX
  )
    return err("bad_offset");
  const who = owner(values.owner, staff);
  if (!who.ok) return who;
  return ok({ ...words.value, offsetDays, ownerId: who.value });
}

export type ReminderKind = "soon" | "overdue";

/**
 * Which reminder an open task is due today, if any: one in the days just
 * before its due date (the day itself included), and one once it is
 * overdue, unless it has been overdue for a long while.
 */
export function reminderFor(dueOn: string, today: string): ReminderKind | null {
  const days = daysBetween(today, dueOn);
  if (days >= 0 && days <= REMIND_DAYS_BEFORE) return "soon";
  if (days < 0 && -days <= OVERDUE_REMINDER_WINDOW) return "overdue";
  return null;
}

/** "Due in 3 days", "Due today", "1 day overdue", for lists and emails. */
export function dueLabel(dueOn: string, today: string): string {
  const days = daysBetween(today, dueOn);
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days > 1) return `Due in ${days} days`;
  return days === -1 ? "1 day overdue" : `${-days} days overdue`;
}

/** "7 days before the start" and the like, for a template task. */
export function offsetLabel(offsetDays: number): string {
  if (offsetDays === 0) return "On the first day";
  const n = Math.abs(offsetDays);
  const days = n === 1 ? "1 day" : `${n} days`;
  return offsetDays < 0
    ? `${days} before the start`
    : `${days} after the start`;
}
