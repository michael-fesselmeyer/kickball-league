/**
 * When the owners are reminded about permits and insurance (ADR 0034):
 * 30 days and 7 days before an application window opens, a permit renews,
 * or the insurance certificate expires. NYC Parks takes applications months
 * ahead, so a month's notice leaves time to gather what it asks for, and a
 * week's notice is the last call.
 *
 * The job runs once a day. A missed day still sends the closest reminder
 * not yet past, and each is sent once (the dedupe key names its milestone),
 * so a late run never sends both at once.
 */

export const LEAD_DAYS = [30, 7] as const;

export type DeadlineKind = "application_opens" | "permit_renews" | "insurance_expires";

export type Deadline = {
  kind: DeadlineKind;
  /** What the deadline is about, stable across runs, such as a permit number. */
  key: string;
  /** YYYY-MM-DD. */
  on: string;
  /** Words for the email, such as "permit PK-1234 at Field 2". */
  subject: string;
};

export type ReminderDue = Deadline & { daysLeft: number; milestone: number };

const DAY_MS = 86_400_000;

/** Whole days from `today` to `on`, both YYYY-MM-DD; negative once past. */
export function daysUntil(today: string, on: string): number {
  return Math.round(
    (Date.parse(`${on}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) /
      DAY_MS,
  );
}

/**
 * The reminders due `today`: for each deadline still ahead (or today), the
 * smallest lead it is within. A deadline more than 30 days away, or past,
 * has none.
 */
export function remindersDue(
  deadlines: readonly Deadline[],
  today: string,
): ReminderDue[] {
  return deadlines.flatMap((d) => {
    const daysLeft = daysUntil(today, d.on);
    if (Number.isNaN(daysLeft) || daysLeft < 0) return [];
    const milestone = [...LEAD_DAYS]
      .sort((a, b) => a - b)
      .find((lead) => daysLeft <= lead);
    return milestone === undefined ? [] : [{ ...d, daysLeft, milestone }];
  });
}

/** Once per deadline, date and milestone, per person. */
export function reminderKey(r: ReminderDue, userId: string): string {
  return `books-reminder/${r.kind}/${r.key}/${r.on}/${r.milestone}/${userId}`;
}
