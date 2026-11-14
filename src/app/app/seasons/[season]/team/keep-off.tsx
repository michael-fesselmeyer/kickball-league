import type { KeepOffRow } from "@/db/queries/keep-off";
import { REASON_MAX } from "@/domain/keep-off/keep-off";
import { SubmitButton } from "@/components/submit-button";

/** Messages by code; an unknown code from the URL finds nothing. */
export const KEEP_OFF_MESSAGES: Record<string, { ok: boolean; text: string }> =
  {
    added: { ok: true, text: "Added. Nobody tells them." },
    removed: { ok: true, text: "Taken off the list." },
    invalid_email: { ok: false, text: "Enter their email address." },
    not_found: {
      ok: false,
      text: "We couldn't find a league member with that email address.",
    },
    self: { ok: false, text: "You can't add yourself." },
    on_team: {
      ok: false,
      text: "They're on the roster this season. Ask the league to move them first.",
    },
    already_listed: { ok: false, text: "They're already on the list." },
    reason_too_long: {
      ok: false,
      text: `Keep the reason to ${REASON_MAX} characters.`,
    },
  };

const field = "rounded-md border border-border bg-surface px-2 py-2";

/**
 * The fields for adding someone: their email address and an optional
 * private reason. The admin page puts a team picker in front of them.
 */
export function KeepOffFields({ idPrefix }: { idPrefix: string }) {
  return (
    <>
      <label htmlFor={`${idPrefix}-email`}>Their email address</label>
      <input
        id={`${idPrefix}-email`}
        name="email"
        type="email"
        autoComplete="off"
        required
        className={field}
      />
      <label htmlFor={`${idPrefix}-reason`}>
        Reason <span className="text-text-muted">(optional, private)</span>
      </label>
      <textarea
        id={`${idPrefix}-reason`}
        name="reason"
        rows={2}
        maxLength={REASON_MAX}
        className={field}
      />
    </>
  );
}

/**
 * A captain's private "not on my team" list (ADR 0036), folded away so it
 * isn't read over a shoulder. It opens after a change, to show the result.
 */
export function KeepOffSection({
  entries,
  notice,
  add,
  remove,
  when,
}: {
  entries: readonly KeepOffRow[];
  notice: string | undefined;
  add: (form: FormData) => Promise<void>;
  remove: (id: string) => (form: FormData) => Promise<void>;
  when: (d: Date) => string;
}) {
  const message = notice ? KEEP_OFF_MESSAGES[notice] : undefined;
  return (
    <section aria-labelledby="keep-off" className="flex flex-col gap-3">
      <details open={message !== undefined} className="flex flex-col gap-3">
        <summary className="cursor-pointer">
          <h2 id="keep-off" className="inline text-h2">
            Not on my team
          </h2>{" "}
          <span className="text-text-muted">(private, {entries.length})</span>
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          <p>
            People here can&apos;t join through your team&apos;s link, the
            league won&apos;t place them on your team, and they won&apos;t see
            your sub requests. They&apos;re never told, and it changes nothing
            else for them. Only your captains and the league&apos;s admins see
            this list. For anything unsafe, report an incident to the league
            instead.
          </p>
          {message && (
            <p
              role={message.ok ? "status" : "alert"}
              className={`rounded-lg border p-3 ${message.ok ? "border-success" : "border-danger"}`}
            >
              {message.text}
            </p>
          )}
          {entries.length === 0 ? (
            <p className="text-text-muted">Nobody is on the list.</p>
          ) : (
            <ul className="flex flex-col">
              {entries.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-wrap items-start justify-between gap-2 border-t border-border py-2"
                >
                  <span className="flex flex-col">
                    <span>{e.name}</span>
                    <span className="text-small break-all text-text-muted">
                      {e.email} · added {when(e.addedAt)}
                    </span>
                    {e.reason && (
                      <span className="text-small whitespace-pre-line">
                        {e.reason}
                      </span>
                    )}
                  </span>
                  <form action={remove(e.id)}>
                    <SubmitButton className="inline-flex min-h-11 items-center underline">
                      Remove
                      <span className="sr-only"> {e.name} from the list</span>
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <form action={add} className="flex flex-col gap-2">
            <KeepOffFields idPrefix="keep-off" />
            <SubmitButton className="btn self-start btn-secondary">
              Add to the list
            </SubmitButton>
          </form>
        </div>
      </details>
    </section>
  );
}
