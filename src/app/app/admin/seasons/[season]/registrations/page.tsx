import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import {
  type BoardPayment,
  type BoardPerson,
  registrationsBoard,
} from "@/db/queries/registrations-admin";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { can } from "@/domain/authz/permissions";
import { formatCents } from "@/domain/registration/pricing";
import { refundableCents } from "@/domain/registration/refund";
import { requirePermission } from "@/lib/auth/permission";
import { RECORD_PAYMENT_MESSAGES } from "@/app/app/seasons/[season]/record-payment";
import {
  placeFreeAgentAction,
  recordPaymentAction,
  refundPaymentAction,
} from "./actions";

export const metadata: Metadata = { title: "Registrations" };

export default function RegistrationsPage(
  props: PageProps<"/app/admin/seasons/[season]/registrations">,
) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-4 py-10">
      <Suspense fallback={<p>Loading…</p>}>
        <Registrations {...props} />
      </Suspense>
    </main>
  );
}

const ERRORS: Record<string, string> = {
  ...RECORD_PAYMENT_MESSAGES,
  unknown_team: "Pick one of this season's teams.",
  already_on_team: "That player is already on a team.",
  suspended:
    "That player is suspended, so they can't be placed until it's served.",
  full: "That team's roster is full.",
  unknown_payment: "That payment is gone.",
  bad_amount:
    "Enter the refund in dollars, such as 20 or 12.50, or leave it blank to refund everything left.",
  too_much: "That is more than is left to refund on this payment.",
  nothing_left: "This payment has already been refunded in full.",
  refund_failed:
    "Stripe did not take the refund. Nothing was refunded; try again in a minute.",
  stale:
    "Your sign-in is more than 15 minutes old. Sign out and back in, then refund again. Nothing was refunded.",
  payments_off:
    "Online payments are not set up, so Stripe refunds cannot be sent.",
};
const NOTICES: Record<string, string> = {
  payment_recorded: "Payment recorded. They're paid up.",
  refund_sent: "Refund sent to Stripe. It shows here once Stripe confirms it.",
  refund_recorded: "Refund recorded.",
  placed: "Free agent placed on the team.",
};
const ROLE: Record<string, string> = {
  captain: "Captain",
  co_captain: "Co-captain",
  player: "Player",
};
const PAID_BY: Record<string, string> = {
  stripe: "Paid online",
  cash: "Paid cash",
  venmo: "Paid by Venmo",
  other: "Paid (other)",
};

const input =
  "min-h-11 rounded-input border border-border-strong bg-surface px-3";

function Mark({ yes, label }: { yes: boolean; label: string }) {
  return (
    <span className={yes ? "text-success" : "text-text-muted"}>
      <span aria-hidden="true">{yes ? "✓" : "–"}</span>
      <span className="sr-only">
        {label}: {yes ? "yes" : "not yet"}
      </span>
    </span>
  );
}

/** Cash, Venmo or other, with a note, for someone signed and not yet paid. */
function RecordPayment({
  slug,
  person,
}: {
  slug: string;
  person: BoardPerson;
}) {
  if (person.paid || !person.signed) return null;
  return (
    <form
      action={recordPaymentAction.bind(null, slug, person.registrationId)}
      className="flex flex-wrap items-center gap-2"
    >
      <select
        name="method"
        defaultValue="cash"
        aria-label={`How ${person.name} paid`}
        className={input}
      >
        <option value="cash">Cash</option>
        <option value="venmo">Venmo</option>
        <option value="other">Other</option>
      </select>
      <input
        name="note"
        maxLength={200}
        placeholder="Note (optional)"
        aria-label={`Note about ${person.name}'s payment`}
        className={`${input} w-40`}
      />
      <button
        type="submit"
        className="inline-flex min-h-11 items-center underline"
      >
        Record payment<span className="sr-only"> for {person.name}</span>
      </button>
    </form>
  );
}

/** What went back on a payment: refunded, partly, or waiting on Stripe. */
function RefundState({ payment }: { payment: BoardPayment }) {
  const { amountCents, refundedCents, requestedCents } = payment;
  const pending = requestedCents - refundedCents;
  return (
    <>
      {refundedCents > 0 && (
        <span className="block text-small text-text-muted">
          {refundedCents >= amountCents
            ? `Refunded ${formatCents(refundedCents)}`
            : `Refunded ${formatCents(refundedCents)} of ${formatCents(amountCents)}`}
        </span>
      )}
      {pending > 0 && (
        <span className="block text-small text-text-muted">
          Refund of {formatCents(pending)} pending
        </span>
      )}
    </>
  );
}

/** Full or partial refund of each payment that has money left on it. */
function Refund({ slug, person }: { slug: string; person: BoardPerson }) {
  const open = person.payments.flatMap((p) => {
    const left = refundableCents(
      p.amountCents,
      Math.max(p.refundedCents, p.requestedCents),
    );
    return left > 0 ? [{ ...p, left }] : [];
  });
  return open.map((p) => (
    <details key={p.paymentId}>
      <summary className="min-h-11 cursor-pointer content-center underline">
        Refund {person.name}
      </summary>
      <form
        action={refundPaymentAction.bind(null, slug, p.paymentId)}
        className="mt-2 flex flex-wrap items-center gap-2"
      >
        <input
          name="amount"
          inputMode="decimal"
          placeholder={`All ${formatCents(p.left)}`}
          aria-label={`Amount to refund ${person.name}, in dollars (blank refunds ${formatCents(p.left)})`}
          className={`${input} w-28`}
        />
        <input
          name="reason"
          maxLength={200}
          placeholder="Reason (optional)"
          aria-label={`Reason for refunding ${person.name}`}
          className={`${input} w-40`}
        />
        <button
          type="submit"
          className="inline-flex min-h-11 items-center underline"
        >
          {p.method === "stripe" ? "Refund through Stripe" : "Mark refunded"}
          <span className="sr-only"> for {person.name}</span>
        </button>
      </form>
    </details>
  ));
}

function Status({ person }: { person: BoardPerson }) {
  return (
    <>
      <td>
        <Mark yes={person.signed} label="Waiver" />
      </td>
      <td>
        {person.paid ? (
          <span className="text-success">
            {PAID_BY[person.paidBy ?? ""] ?? "Paid"}
          </span>
        ) : (
          <Mark yes={false} label="Paid" />
        )}
        {person.payments.map((p) => (
          <RefundState key={p.paymentId} payment={p} />
        ))}
      </td>
    </>
  );
}

/** Record an off-app payment, or refund one that was made. */
function PaymentActions({
  slug,
  person,
  refunds,
}: {
  slug: string;
  person: BoardPerson;
  refunds: boolean;
}) {
  return (
    <>
      <RecordPayment slug={slug} person={person} />
      {refunds && <Refund slug={slug} person={person} />}
    </>
  );
}

async function Registrations({
  params,
  searchParams,
}: PageProps<"/app/admin/seasons/[season]/registrations">) {
  const { season: slug } = await params;
  const query = await searchParams;
  const subject = await requirePermission("season.manage", {
    next: `/app/admin/seasons/${slug}/registrations`,
  });
  const refunds = can(subject, "refund.issue", {});
  const season = await seasonBySlug(db, slug);
  if (!season) notFound();
  const board = await registrationsBoard(db, season.id);
  const everyone = [
    ...board.teams.flatMap((t) => t.members),
    ...board.freeAgents,
  ];
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const notice =
    typeof query.notice === "string" ? NOTICES[query.notice] : undefined;
  // A placement the team's "not on my team" list stopped (ADR 0036).
  const conflict = board.freeAgents.find(
    (p) => p.registrationId === query.conflict,
  );
  const conflictTeam = board.teams.find((t) => t.teamSeasonId === query.team);

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link
          href={`/app/admin/seasons/${slug}`}
          className="inline-flex min-h-11 items-center self-start underline"
        >
          {season.name}
        </Link>
        <h1 className="text-h1">Registrations</h1>
        <p className="text-text-muted">
          {board.teams.length} teams · {everyone.length} players ·{" "}
          {everyone.filter((p) => p.signed).length} signed ·{" "}
          {everyone.filter((p) => p.paid).length} paid ·{" "}
          {board.freeAgents.length}{" "}
          {board.freeAgents.length === 1 ? "free agent" : "free agents"}
        </p>
        <p className="flex flex-wrap gap-4">
          <a
            href={`/app/seasons/${slug}/export/roster.csv`}
            download
            className="inline-flex min-h-11 items-center underline"
          >
            Download rosters (CSV)
          </a>
          <a
            href={`/app/seasons/${slug}/export/payments.csv`}
            download
            className="inline-flex min-h-11 items-center underline"
          >
            Download payments (CSV)
          </a>
        </p>
      </header>
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-lg border border-success p-3">
          {notice}
        </p>
      )}
      {conflict && conflictTeam && (
        <section
          id="place-conflict"
          role="alert"
          aria-labelledby="place-conflict-title"
          className="flex flex-col gap-2 rounded-lg border border-warning p-3"
        >
          <h2 id="place-conflict-title" className="font-bold">
            {conflictTeam.name} has {conflict.name} on its not-on-my-team list
          </h2>
          <p>
            The team&apos;s captain asked the league not to add them. Nothing
            was changed. You can still place them; the override goes in the
            audit log.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <form
              action={placeFreeAgentAction.bind(
                null,
                slug,
                conflict.registrationId,
              )}
            >
              <input
                type="hidden"
                name="teamSeasonId"
                value={conflictTeam.teamSeasonId}
              />
              <input type="hidden" name="override" value="yes" />
              <button type="submit" className="btn btn-secondary">
                Place {conflict.name} on {conflictTeam.name} anyway
              </button>
            </form>
            <Link
              href={`/app/admin/seasons/${slug}/registrations`}
              className="inline-flex min-h-11 items-center underline"
            >
              Cancel
            </Link>
          </div>
        </section>
      )}

      <section aria-labelledby="teams" className="flex flex-col gap-6">
        <h2 id="teams" className="text-h2">
          Teams
        </h2>
        {board.teams.length === 0 && (
          <p className="text-text-muted">No teams yet.</p>
        )}
        {board.teams.map((t) => (
          <article
            key={t.teamSeasonId}
            aria-label={t.name}
            className="flex flex-col gap-2 rounded-lg border border-border p-4"
          >
            <h3 className="flex flex-wrap items-center gap-2 text-h3">
              {t.colorHex && (
                <span
                  aria-hidden="true"
                  className="inline-block size-4 rounded-full border border-border"
                  style={{ background: t.colorHex }}
                />
              )}
              {t.name}
              <span className="text-small text-text-muted">
                {t.members.length}
                {t.targetRosterSize ? ` of ${t.targetRosterSize}` : ""} ·{" "}
                {board.feeModel === "per_player"
                  ? "each pays the player fee"
                  : t.paymentMode === "split" && t.shareCents !== null
                    ? `${formatCents(t.shareCents)} each`
                    : "captain pays the fee"}{" "}
                · {t.status === "confirmed" ? "confirmed" : "forming"}
              </span>
            </h3>
            {t.members.length === 0 ? (
              <p className="text-text-muted">Nobody on this team yet.</p>
            ) : (
              <div
                role="region"
                aria-label={`${t.name} players`}
                // A scrolling region must be reachable by keyboard, even with no links.
                // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
                tabIndex={0}
                className="relative overflow-x-auto"
              >
                <table className="w-full min-w-[34rem] text-left">
                  <thead className="text-text-muted">
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Role</th>
                      <th scope="col">Waiver</th>
                      <th scope="col">Paid</th>
                      <th scope="col">
                        <span className="sr-only">Payments and refunds</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.members.map((m) => (
                      <tr
                        key={m.registrationId}
                        className="border-t border-border"
                      >
                        <td className="py-2">{m.name}</td>
                        <td>{ROLE[m.role ?? "player"]}</td>
                        <Status person={m} />
                        <td>
                          {/* Each pays their own unless the captain pays the team fee. */}
                          {board.feeModel === "per_player" ||
                          t.paymentMode === "split" ||
                          m.role === "captain" ? (
                            <PaymentActions
                              slug={slug}
                              person={m}
                              refunds={refunds}
                            />
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>
        ))}
      </section>

      <section aria-labelledby="free-agents" className="flex flex-col gap-3">
        <h2 id="free-agents" className="text-h2">
          Free agents
        </h2>
        {board.freeAgents.length > 0 && (
          <Link
            href={`/app/admin/seasons/${slug}/free-agents`}
            className="underline"
          >
            See suggested placements and build a team from the pool
          </Link>
        )}
        {board.freeAgents.length === 0 ? (
          <p className="text-text-muted">Nobody in the pool.</p>
        ) : (
          <div
            role="region"
            aria-label="Free agents table"
            // A scrolling region must be reachable by keyboard, even with no links.
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
            tabIndex={0}
            className="relative overflow-x-auto"
          >
            <table className="w-full min-w-[40rem] text-left">
              <thead className="text-text-muted">
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Waiver</th>
                  <th scope="col">Paid</th>
                  <th scope="col">Place on a team</th>
                  <th scope="col">
                    <span className="sr-only">Payments and refunds</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {board.freeAgents.map((p) => (
                  <tr key={p.registrationId} className="border-t border-border">
                    <td className="py-2">{p.name}</td>
                    <Status person={p} />
                    <td>
                      {board.teams.length > 0 && (
                        <form
                          action={placeFreeAgentAction.bind(
                            null,
                            slug,
                            p.registrationId,
                          )}
                          className="flex items-center gap-2"
                        >
                          <select
                            name="teamSeasonId"
                            aria-label={`Team for ${p.name}`}
                            className={input}
                          >
                            {board.teams.map((t) => (
                              <option
                                key={t.teamSeasonId}
                                value={t.teamSeasonId}
                              >
                                {t.name} ({t.members.length})
                              </option>
                            ))}
                          </select>
                          <button
                            type="submit"
                            className="inline-flex min-h-11 items-center underline"
                          >
                            Place<span className="sr-only"> {p.name}</span>
                          </button>
                        </form>
                      )}
                    </td>
                    <td>
                      <PaymentActions
                        slug={slug}
                        person={p}
                        refunds={refunds}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
