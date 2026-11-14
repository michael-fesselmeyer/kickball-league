import type { Captaincy } from "@/db/queries/captaincy";
import { SubmitButton } from "@/components/submit-button";

type Action = (form: FormData) => Promise<void>;

/** Messages by code; an unknown code from the URL finds nothing. */
export const CAPTAINCY_MESSAGES: Record<string, { ok: boolean; text: string }> =
  {
    offered: {
      ok: true,
      text: "Offer sent. You stay captain until they accept.",
    },
    cancelled: { ok: true, text: "Offer withdrawn." },
    co_captain: { ok: true, text: "They're a co-captain now." },
    player: { ok: true, text: "They're a player again." },
    stepped_down: {
      ok: true,
      text: "You've stepped down. You're a player on the team.",
    },
    accepted: { ok: true, text: "You're the captain now." },
    declined: { ok: true, text: "You said no. Nothing changed." },
    not_on_team: { ok: false, text: "Pick a teammate on the roster." },
    already_captain: { ok: false, text: "They're already the captain." },
    checkout_open: {
      ok: false,
      text: "Someone is paying the team fee right now. Try again once that's done.",
    },
    no_captain: {
      ok: false,
      text: "The team has no captain to hand over from. Ask the league.",
    },
    captain_changed: {
      ok: false,
      text: "This offer no longer stands: the team has a different captain now.",
    },
    not_pending: {
      ok: false,
      text: "This offer was already answered or withdrawn.",
    },
    is_captain: {
      ok: false,
      text: "The captain's role only changes by handing the team over.",
    },
    unchanged: { ok: false, text: "Nothing to change." },
    not_found: { ok: false, text: "That offer is gone." },
  };

const ROLE = { captain: "Captain", co_captain: "Co-captain", player: "Player" };

const field = "rounded-md border border-border bg-surface px-2 py-2";

export function CaptaincyNotice({ code }: { code: string | undefined }) {
  const message = code ? CAPTAINCY_MESSAGES[code] : undefined;
  if (!message) return null;
  return (
    <p
      role={message.ok ? "status" : "alert"}
      className={`rounded-lg border p-3 ${message.ok ? "border-success" : "border-danger"}`}
    >
      {message.text}
    </p>
  );
}

/**
 * For the teammate offered the captaincy: what it means and their answer.
 * Nothing changes until they accept.
 */
export function CaptaincyOffer({
  team,
  from,
  accept,
  decline,
}: {
  team: string;
  from: string;
  accept: Action;
  decline: Action;
}) {
  return (
    <section
      aria-labelledby="captaincy-offer"
      className="flex flex-col gap-3 rounded-lg border border-warning p-4"
    >
      <h2 id="captaincy-offer" className="text-h3">
        {from} asked you to captain {team}
      </h2>
      <p>
        As captain you run the roster, invites, payments and co-captains. {from}{" "}
        stays on as a co-captain. Nothing changes until you say yes.
      </p>
      <div className="flex flex-wrap gap-3">
        <form action={accept}>
          <SubmitButton className="btn btn-primary">
            Become captain
          </SubmitButton>
        </form>
        <form action={decline}>
          <SubmitButton className="btn btn-secondary">No thanks</SubmitButton>
        </form>
      </div>
    </section>
  );
}

/**
 * Who leads the team and the controls to change it: for the captain and
 * admins, make or unmake co-captains and hand the team over; for a
 * co-captain, step down.
 */
export function CaptaincyPanel({
  idPrefix,
  heading: Heading = "h2",
  data,
  viewerId,
  manage,
  offer,
  cancel,
  setRole,
  stepDown,
}: {
  idPrefix: string;
  heading?: "h2" | "h3" | "h4";
  data: Captaincy;
  viewerId: string;
  /** The team's captain or an admin. */
  manage: boolean;
  offer: Action;
  cancel: Action;
  setRole: (userId: string, role: "co_captain" | "player") => Action;
  /** Only for a co-captain looking at their own team. */
  stepDown?: Action | undefined;
}) {
  const { members, pending } = data;
  const teammates = members.filter((m) => m.role !== "captain");
  return (
    <section
      aria-labelledby={`${idPrefix}-title`}
      id={idPrefix}
      className="flex flex-col gap-3"
    >
      <Heading
        id={`${idPrefix}-title`}
        className={Heading === "h2" ? "text-h2" : "text-h3"}
      >
        Captain and co-captains
      </Heading>
      <p className="text-text-muted">
        Co-captains set kicking orders, ask for subs, enter and confirm scores,
        see who has paid and keep the team&apos;s private list. Only the captain
        hands the team over or changes co-captains.
      </p>
      <ul className="flex flex-col">
        {members.map((m) => (
          <li
            key={m.membershipId}
            className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2"
          >
            <span>
              {m.name}
              {m.userId === viewerId && (
                <span className="text-text-muted"> (you)</span>
              )}{" "}
              <span className="text-small text-text-muted">
                · {ROLE[m.role]}
              </span>
            </span>
            {manage && m.role !== "captain" && (
              <form
                action={setRole(
                  m.userId,
                  m.role === "co_captain" ? "player" : "co_captain",
                )}
              >
                <SubmitButton className="inline-flex min-h-11 items-center underline">
                  {m.role === "co_captain"
                    ? "Make a player"
                    : "Make co-captain"}
                  <span className="sr-only"> for {m.name}</span>
                </SubmitButton>
              </form>
            )}
            {!manage &&
              stepDown &&
              m.userId === viewerId &&
              m.role === "co_captain" && (
                <form action={stepDown}>
                  <SubmitButton className="inline-flex min-h-11 items-center underline">
                    Step down as co-captain
                  </SubmitButton>
                </form>
              )}
          </li>
        ))}
      </ul>

      {manage &&
        (pending ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
            <p>
              Waiting for {pending.toName} to accept the captaincy.{" "}
              {pending.fromName} stays captain until then.
            </p>
            <form action={cancel}>
              <SubmitButton className="inline-flex min-h-11 items-center underline">
                Withdraw the offer
              </SubmitButton>
            </form>
          </div>
        ) : teammates.length > 0 ? (
          <form action={offer} className="flex flex-col gap-2">
            <label htmlFor={`${idPrefix}-to`}>Hand the team to</label>
            <select
              id={`${idPrefix}-to`}
              name="toUserId"
              required
              className={field}
            >
              {teammates.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </select>
            <p className="text-small text-text-muted">
              They have to accept. Until they do, nothing changes; then the
              current captain stays on as a co-captain.
            </p>
            <SubmitButton className="btn self-start btn-secondary">
              Offer the captaincy
            </SubmitButton>
          </form>
        ) : null)}
    </section>
  );
}
