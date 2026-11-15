import type { AnnouncementSummary } from "@/db/queries/announcements";
import { BODY_MAX, SUBJECT_MAX } from "@/db/queries/announcements";
import { announcementShareText } from "@/domain/share/share-text";
import { CopyForWhatsApp } from "./share";
import { SubmitButton } from "@/components/submit-button";

const field = "rounded-md border border-border bg-surface px-2 py-1";

/** Messages for the `error` and `notice` query parameters after sending. */
export const ANNOUNCE_ERRORS: Record<string, string> = {
  empty: "Write a subject and a message.",
  too_long: `Keep the subject under ${SUBJECT_MAX} characters and the message under ${BODY_MAX}.`,
  rate_limited:
    "You have reached today's limit for announcements. Try again tomorrow.",
  no_recipients: "Nobody is on that list yet, so there is nobody to email.",
  unknown_team: "That team is not in this season.",
  bad_send_time: "Pick when to send it: now, the next morning send, or a day.",
  send_day_passed:
    "That day's send has already gone out. Pick a later day, or send it now.",
  send_day_far: "Schedule it within the next four months.",
  already_sent:
    "That announcement has already gone out or was cancelled, so it can't change.",
};

/**
 * The "when" choice for an admin's announcement (ADR 0058). Scheduled jobs
 * run once a day, so a scheduled announcement goes with the outbox's
 * morning send on the chosen day; the labels say when that is in the
 * league's time zone.
 */
export type ScheduleChoice = {
  /** "Tue, Nov 17, 8:30 AM": when the next morning send is. */
  next: string;
  /** The sweep's time of day in the league's zone, such as "8:30 AM ET". */
  sweepTime: string;
  /** YYYY-MM-DD bounds for the day picker. */
  minDay: string;
  maxDay: string;
};

function WhenToSend({ schedule }: { schedule: ScheduleChoice }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="font-bold">When</legend>
      <label className="flex min-h-11 items-center gap-2">
        <input type="radio" name="when" value="now" defaultChecked />
        Send now
      </label>
      <label className="flex min-h-11 items-center gap-2">
        <input type="radio" name="when" value="next" />
        At the next morning send ({schedule.next})
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-h-11 items-center gap-2">
          <input type="radio" name="when" value="day" />
          On a day:
        </label>
        <input
          type="date"
          name="day"
          min={schedule.minDay}
          max={schedule.maxDay}
          aria-label="Day to send"
          className={field}
        />
      </div>
      <p className="text-small text-text-muted">
        Scheduled messages go out once a day, with the morning send at about{" "}
        {schedule.sweepTime}. You can edit or cancel one until then. Quiet hours
        and the daily email limit still apply.
      </p>
    </fieldset>
  );
}

export function announceNotice(count: unknown): string | undefined {
  const n = typeof count === "string" ? Number.parseInt(count, 10) : NaN;
  if (!Number.isFinite(n)) return undefined;
  return `Sent to ${n} ${n === 1 ? "person" : "people"}. Anyone who turned announcements off is skipped.`;
}

/** The compose form; `audience` adds a "send to" choice for admins. */
export function AnnouncementForm({
  action,
  audience,
  limitNote,
  defaults,
  schedule,
}: {
  action: (form: FormData) => Promise<void>;
  audience?: { value: string; label: string }[];
  limitNote: string;
  /** Starting text to edit, such as a drafted recap. */
  defaults?: { subject: string; body: string };
  /** Lets an admin schedule it instead of sending now. */
  schedule?: ScheduleChoice;
}) {
  return (
    <form action={action} className="flex flex-col gap-4">
      {audience && (
        <label className="flex flex-col gap-1">
          Send to
          <select name="audience" className={field} defaultValue="league">
            {audience.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1">
        Subject
        <input
          name="subject"
          required
          maxLength={SUBJECT_MAX}
          defaultValue={defaults?.subject}
          className={field}
        />
      </label>
      <label className="flex flex-col gap-1">
        Message
        <textarea
          name="body"
          required
          maxLength={BODY_MAX}
          rows={defaults ? 18 : 6}
          defaultValue={defaults?.body}
          aria-describedby="announce-hint"
          className={field}
        />
        <span id="announce-hint" className="text-small text-text-muted">
          Sent by email. {limitNote}
        </span>
      </label>
      {schedule && <WhenToSend schedule={schedule} />}
      <SubmitButton className="min-h-11 self-start rounded-full bg-text px-4 py-2 font-bold text-surface">
        Send announcement
      </SubmitButton>
    </form>
  );
}

const STATUS_LABELS: [string, string][] = [
  ["sent", "sent"],
  ["queued", "waiting"],
  ["sending", "sending"],
  ["suppressed", "turned off"],
  ["failed", "failed"],
];

/** Past announcements with how many emails went out. */
export function AnnouncementList({
  items,
  teamName,
  when,
}: {
  items: AnnouncementSummary[];
  teamName?: (id: string | null) => string;
  when: (d: Date) => string;
}) {
  if (items.length === 0)
    return <p className="text-text-muted">Nothing sent yet.</p>;
  return (
    <ul className="flex flex-col">
      {items.map((a) => (
        <li
          key={a.id}
          className="flex flex-col gap-1 border-t border-border py-3"
        >
          <span className="font-bold">{a.subject}</span>
          <span className="text-small text-text-muted">
            {when(a.createdAt)}
            {teamName ? ` · ${teamName(a.teamSeasonId)}` : ""} ·{" "}
            {STATUS_LABELS.filter(([s]) => a.delivery[s])
              .map(([s, label]) => `${a.delivery[s]} ${label}`)
              .join(", ") || `${a.recipientCount} recipients`}
          </span>
          <p className="whitespace-pre-line">{a.body}</p>
          <CopyForWhatsApp
            about={a.subject}
            text={announcementShareText({ subject: a.subject, body: a.body })}
          />
        </li>
      ))}
    </ul>
  );
}
