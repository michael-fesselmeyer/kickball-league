import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";
import { db } from "@/db/client";
import { handoverCandidates, listActingAdmins } from "@/db/queries/acting-admin";
import {
  ACTING_POWER_LABELS,
  ACTING_POWERS,
  isActingPower,
  MAX_GRANT_DAYS,
} from "@/domain/authz/acting-admin";
import { requirePermission } from "@/lib/auth/permission";
import { activeLeague } from "@/lib/league/active";
import { endAction, grantAction } from "./actions";

export const metadata: Metadata = { title: "Acting admins" };

const ERRORS: Record<string, string> = {
  not_a_player: "Pick a player from the list.",
  already_staff: "That person is already an admin or owner.",
  no_powers: "Tick at least one power to hand over.",
  bad_dates: "Pick a first day, and a last day that is not before it.",
  in_the_past: "That handover has already ended.",
  too_long: `A handover can run ${MAX_GRANT_DAYS} days at most. Make a new one to go on.`,
  not_found: "That handover is not in this league.",
  already_over: "That handover is already over.",
};

const input =
  "min-h-11 rounded-input border-2 border-border-strong bg-surface px-3 py-2 text-body text-text";

export default function ActingAdminsPage(
  props: PageProps<"/app/admin/acting-admins">,
) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <ActingAdmins {...props} />
      </Suspense>
    </main>
  );
}

async function ActingAdmins({
  searchParams,
}: PageProps<"/app/admin/acting-admins">) {
  await requirePermission("admins.manage", { next: "/app/admin/acting-admins" });
  const league = await activeLeague();
  if (!league) notFound();
  const query = await searchParams;
  const now = new Date();
  const [rows, players] = await Promise.all([
    listActingAdmins(db, league.id, now),
    handoverCandidates(db, league.id),
  ]);
  const when = new Intl.DateTimeFormat("en-US", {
    timeZone: league.timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const error = typeof query.error === "string" ? ERRORS[query.error] : null;
  const notice =
    query.notice === "granted"
      ? "Handover saved."
      : query.notice === "ended"
        ? "Handover ended."
        : null;
  return (
    <>
      <header className="flex flex-col gap-2">
        <h1 className="text-h1 font-bold">Acting admins</h1>
        <p className="text-text-muted">
          Hand some admin powers to a trusted player for set dates, so
          schedules, scores and rain calls don&apos;t stall while the
          organizers are away. Access starts and ends by itself, and you can end
          it early. Money, roles, exports and the audit log are never part of a
          handover. Everything they do is in the audit log under their name, and
          they and every owner are told when it starts and ends.
        </p>
      </header>
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className="font-semibold text-danger">
          {error}
        </p>
      )}
      <section aria-labelledby="handovers" className="flex flex-col gap-3">
        <h2 id="handovers" className="text-h2 font-bold">
          Handovers
        </h2>
        {rows.length === 0 ? (
          <p>No handovers yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((r) => (
              <li
                key={r.id}
                className="flex flex-col gap-1 rounded-lg border border-border p-3"
              >
                <p className="font-bold">
                  {r.name}{" "}
                  <span className="text-small font-normal text-text-muted">
                    {r.status === "active"
                      ? "acting now"
                      : r.status === "upcoming"
                        ? "starts later"
                        : r.endedAt
                          ? "ended early"
                          : "ended"}
                  </span>
                </p>
                <p>
                  {when.format(r.startsAt)} through{" "}
                  {when.format(new Date((r.endedAt ?? r.endsAt).getTime() - 1))}
                </p>
                <p className="text-small text-text-muted">
                  {r.powers
                    .filter(isActingPower)
                    .map((p) => ACTING_POWER_LABELS[p].label)
                    .join(", ")}
                </p>
                {r.status !== "ended" && (
                  <form action={endAction.bind(null, r.id)}>
                    <SubmitButton className="btn btn-secondary">
                      End now
                    </SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="new" className="flex flex-col gap-3">
        <h2 id="new" className="text-h2 font-bold">
          Name an acting admin
        </h2>
        <form action={grantAction} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="font-semibold">Player</span>
            <select name="player" required className={input} defaultValue="">
              <option value="" disabled>
                Choose a player
              </option>
              {players.map((p) => (
                <option key={p.userId} value={p.userId}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-4">
            <label className="flex flex-col gap-1">
              <span className="font-semibold">First day</span>
              <input type="date" name="from" required className={input} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-semibold">Last day</span>
              <input type="date" name="through" required className={input} />
            </label>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="font-semibold">Powers</legend>
            {ACTING_POWERS.map((p) => (
              <label key={p} className="flex min-h-11 items-start gap-3">
                <input
                  type="checkbox"
                  name="powers"
                  value={p}
                  className="mt-1 size-5"
                />
                <span>
                  <span className="font-semibold">
                    {ACTING_POWER_LABELS[p].label}
                  </span>
                  <span className="block text-small text-text-muted">
                    {ACTING_POWER_LABELS[p].hint}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <SubmitButton className="btn btn-primary self-start">
            Hand over
          </SubmitButton>
        </form>
      </section>
    </>
  );
}
