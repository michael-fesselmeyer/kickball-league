import type { RecruitingSummary } from "@/db/queries/move";
import { MESSAGE_MAX } from "@/domain/move/move";
import { SubmitButton } from "@/components/submit-button";

/** Messages by code; an unknown code from the URL finds nothing. */
const NOTICES: Record<string, { ok: boolean; text: string }> = {
  sent: {
    ok: true,
    text: "Invites sent. Each player decides; you'll hear from those who say yes.",
  },
  none: { ok: true, text: "Nobody new to invite right now." },
  closed: {
    ok: false,
    text: "Registration for this season has closed, so recruiting has too.",
  },
  message_too_long: {
    ok: false,
    text: `Keep the pitch to ${MESSAGE_MAX} characters.`,
  },
};

const players = (n: number) => (n === 1 ? "1 player" : `${n} players`);

/**
 * For a team's captains while next season's registration is open: how many
 * players are quietly open to a new team, an invite for all of them, and
 * the names of those who said yes (ADR 0089). Never who said no.
 */
export function RecruitingSection({
  team,
  summary,
  notice,
  invite,
}: {
  team: string;
  summary: RecruitingSummary;
  notice: string | undefined;
  invite: (form: FormData) => Promise<void>;
}) {
  const message = notice ? NOTICES[notice] : undefined;
  return (
    <section
      id="recruiting"
      aria-labelledby="recruiting-heading"
      className="flex flex-col gap-3"
    >
      <h2 id="recruiting-heading" className="text-h2">
        Players looking for a change
      </h2>
      <p className="text-text-muted">
        Some players are quietly open to a new team next season. You won&apos;t
        see who until one of them says yes to your invite.
      </p>
      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          className={`rounded-lg border p-3 ${message.ok ? "border-success" : "border-danger"}`}
        >
          {message.text}
        </p>
      )}
      <p>
        {summary.waiting === 0
          ? `No one new to invite to ${team} right now.`
          : `${players(summary.waiting)} open to a new team ${summary.waiting === 1 ? "hasn't" : "haven't"} had an invite from ${team} yet.`}
        {summary.invited > 0 &&
          ` You've invited ${players(summary.invited)}; ${summary.accepted.length} said yes.`}
      </p>
      {summary.waiting > 0 && (
        <form action={invite} className="flex flex-col gap-2">
          <label htmlFor="recruit-message" className="flex flex-col gap-1">
            <span>
              A short pitch <span className="text-text-muted">(optional)</span>
            </span>
            <span className="text-small text-text-muted">
              Your night, your vibe, what you&apos;re looking for. Everyone you
              invite reads the same words.
            </span>
          </label>
          <textarea
            id="recruit-message"
            name="message"
            rows={3}
            maxLength={MESSAGE_MAX}
            className="rounded-md border border-border bg-surface px-2 py-2"
          />
          <SubmitButton className="btn self-start btn-primary">
            Invite {players(summary.waiting)}
          </SubmitButton>
        </form>
      )}
      {summary.accepted.length > 0 && (
        <>
          <h3 className="text-h3">Said yes</h3>
          <ul className="flex flex-col gap-2">
            {summary.accepted.map((a) => (
              <li key={a.email} className="rounded-lg border border-border p-3">
                <p className="font-semibold">{a.name}</p>
                <p>
                  <a href={`mailto:${a.email}`} className="underline">
                    {a.email}
                  </a>
                </p>
                {a.note && <p className="text-text-muted">{a.note}</p>}
              </li>
            ))}
          </ul>
          <p className="text-small text-text-muted">
            Send them your team link when you&apos;re ready.
          </p>
        </>
      )}
    </section>
  );
}
