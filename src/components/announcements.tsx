import type { AnnouncementSummary } from "@/db/queries/announcements";
import { BODY_MAX, SUBJECT_MAX } from "@/db/queries/announcements";
import { announcementShareText } from "@/domain/share/share-text";
import { CopyForWhatsApp } from "./share";

const field = "rounded-md border border-border bg-surface px-2 py-1";

/** Messages for the `error` and `notice` query parameters after sending. */
export const ANNOUNCE_ERRORS: Record<string, string> = {
  empty: "Write a subject and a message.",
  too_long: `Keep the subject under ${SUBJECT_MAX} characters and the message under ${BODY_MAX}.`,
  rate_limited:
    "You have reached today's limit for announcements. Try again tomorrow.",
  no_recipients: "Nobody is on that list yet, so there is nobody to email.",
  unknown_team: "That team is not in this season.",
};

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
}: {
  action: (form: FormData) => Promise<void>;
  audience?: { value: string; label: string }[];
  limitNote: string;
  /** Starting text to edit, such as a drafted recap. */
  defaults?: { subject: string; body: string };
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
      <button
        type="submit"
        className="self-start rounded-full bg-text px-4 py-2 font-bold text-surface"
      >
        Send announcement
      </button>
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
