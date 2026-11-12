import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import {
  type BoardPerson,
  registrationsBoard,
} from "@/db/queries/registrations-admin";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { formatCents } from "@/domain/registration/pricing";
import { requirePermission } from "@/lib/auth/permission";
import { RECORD_PAYMENT_MESSAGES } from "@/app/app/seasons/[season]/record-payment";
import { placeFreeAgentAction, recordPaymentAction } from "./actions";

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
  full: "That team's roster is full.",
};
const NOTICES: Record<string, string> = {
  payment_recorded: "Payment recorded. They're paid up.",
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

const input = "rounded-md border border-border bg-surface px-2 py-1";

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
      <button type="submit" className="underline">
        Record payment
      </button>
    </form>
  );
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
      </td>
    </>
  );
}

async function Registrations({
  params,
  searchParams,
}: PageProps<"/app/admin/seasons/[season]/registrations">) {
  const { season: slug } = await params;
  const query = await searchParams;
  await requirePermission("season.manage", {
    next: `/app/admin/seasons/${slug}/registrations`,
  });
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

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href={`/app/admin/seasons/${slug}`} className="underline">
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
            className="underline"
          >
            Download rosters (CSV)
          </a>
          <a
            href={`/app/seasons/${slug}/export/payments.csv`}
            download
            className="underline"
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
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-left">
                <thead className="text-text-muted">
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Role</th>
                    <th scope="col">Waiver</th>
                    <th scope="col">Paid</th>
                    <th scope="col">
                      <span className="sr-only">Record a payment</span>
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
                          <RecordPayment slug={slug} person={m} />
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        ))}
      </section>

      <section aria-labelledby="free-agents" className="flex flex-col gap-3">
        <h2 id="free-agents" className="text-h2">
          Free agents
        </h2>
        {board.freeAgents.length === 0 ? (
          <p className="text-text-muted">Nobody in the pool.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left">
              <thead className="text-text-muted">
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Waiver</th>
                  <th scope="col">Paid</th>
                  <th scope="col">Place on a team</th>
                  <th scope="col">
                    <span className="sr-only">Record a payment</span>
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
                          <button type="submit" className="underline">
                            Place
                          </button>
                        </form>
                      )}
                    </td>
                    <td>
                      <RecordPayment slug={slug} person={p} />
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
