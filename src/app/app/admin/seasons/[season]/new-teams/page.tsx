import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import {
  type AdminNewTeamRequest,
  newTeamRequestsBoard,
} from "@/db/queries/new-teams";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { REASON_MAX } from "@/domain/registration/new-team";
import { requirePermission } from "@/lib/auth/permission";
import { approveNewTeamAction, declineNewTeamAction } from "./actions";
import { PageLoading } from "@/components/page-loading";

export const metadata: Metadata = { title: "New-team requests" };

export default function NewTeamRequestsPage(
  props: PageProps<"/app/admin/seasons/[season]/new-teams">,
) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <NewTeamRequests {...props} />
      </Suspense>
    </main>
  );
}

const ERRORS: Record<string, string> = {
  not_found: "That request no longer exists.",
  not_pending: "Someone already answered that request.",
  season_full:
    "The season has reached its team limit. Raise the limit in season setup or decline.",
  name_taken:
    "A team with that name already exists. Decline and ask them to pick another name.",
  captain:
    "They now captain another team this season. They need to hand it over first.",
  no_price: "Set the season's team price before approving teams.",
  reason_too_long: "Keep the reason to 500 characters.",
};
const NOTICES: Record<string, string> = {
  approved: "Approved. The team is forming and the captain has been emailed.",
  declined: "Declined. The requester has been emailed.",
};
const STATUS: Record<AdminNewTeamRequest["status"], string> = {
  pending: "Waiting",
  approved: "Approved",
  declined: "Declined",
  withdrawn: "Withdrawn",
};
const ROLE: Record<string, string> = {
  captain: "Captain",
  co_captain: "Co-captain",
  player: "Player",
};

function Standing({ r }: { r: AdminNewTeamRequest }) {
  if (!r.now) return null;
  const { team, registered, paid, paidOwnWay } = r.now;
  return (
    <p className="text-small text-text-muted">
      {!registered
        ? "Not registered this season; approving registers them as captain."
        : team
          ? `${ROLE[team.role]} on ${team.name}; approving moves them and tells that captain.`
          : "A free agent this season."}
      {paidOwnWay
        ? " Already paid for their spot, so the team splits its fee."
        : paid && registered
          ? " Covered by their team's fee; they will owe for the new team."
          : ""}
    </p>
  );
}

function OpenRequest({
  slug,
  r,
  timeZone,
}: {
  slug: string;
  r: AdminNewTeamRequest;
  timeZone: string;
}) {
  const asked = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone,
  }).format(r.createdAt);
  const headingId = `request-${r.id}`;
  return (
    <li
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-lg border border-border p-4"
    >
      <div className="flex flex-col gap-1">
        <h3 id={headingId} className="text-h3">
          {r.proposedName}
        </h3>
        <p>
          {r.requester.name}{" "}
          <span className="text-text-muted">
            · about {r.expectedSize} players ·{" "}
            {r.paymentMode === "full" ? "captain pays in full" : "split fee"} ·
            asked {asked}
          </span>
        </p>
        <Standing r={r} />
      </div>
      {r.note && (
        <blockquote className="border-l-4 border-border pl-3">
          {r.note}
        </blockquote>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <form action={approveNewTeamAction.bind(null, slug, r.id)}>
          <button type="submit" className="btn btn-primary">
            Approve<span className="sr-only"> {r.proposedName}</span>
          </button>
        </form>
        <form
          action={declineNewTeamAction.bind(null, slug, r.id)}
          className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-end"
        >
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-small">Reason (optional, they see it)</span>
            <input
              name="reason"
              maxLength={REASON_MAX}
              className="rounded-md border border-border bg-surface px-2 py-1"
            />
          </label>
          <button type="submit" className="btn self-start btn-secondary">
            Decline<span className="sr-only"> {r.proposedName}</span>
          </button>
        </form>
      </div>
    </li>
  );
}

async function NewTeamRequests({
  params,
  searchParams,
}: PageProps<"/app/admin/seasons/[season]/new-teams">) {
  const { season: slug } = await params;
  const query = await searchParams;
  await requirePermission("team.approve_new", {
    next: `/app/admin/seasons/${slug}/new-teams`,
  });
  const season = await seasonBySlug(db, slug);
  if (!season) notFound();
  const board = await newTeamRequestsBoard(db, season.id);
  const open = board.filter((r) => r.status === "pending");
  const answered = board.filter((r) => r.status !== "pending");
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const notice =
    typeof query.notice === "string" ? NOTICES[query.notice] : undefined;
  const day = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeZone: season.timeZone,
    }).format(d);

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href={`/app/admin/seasons/${slug}`} className="underline">
          {season.name}
        </Link>
        <h1 className="text-h1">New-team requests</h1>
        <p className="text-text-muted">
          Players asking to start a team. Approving creates it in
          &ldquo;forming&rdquo; status with them as captain; they invite their
          players from there.
        </p>
      </header>
      {error && (
        <p role="alert" className="rounded-lg border border-warning p-3">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-lg border border-success p-3">
          {notice}
        </p>
      )}
      <section aria-labelledby="open" className="flex flex-col gap-3">
        <h2 id="open" className="text-h2">
          Waiting{open.length > 0 && ` (${open.length})`}
        </h2>
        {open.length === 0 ? (
          <p className="text-text-muted">No requests are waiting.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {open.map((r) => (
              <OpenRequest
                key={r.id}
                slug={slug}
                r={r}
                timeZone={season.timeZone}
              />
            ))}
          </ul>
        )}
      </section>
      {answered.length > 0 && (
        <section aria-labelledby="answered" className="flex flex-col gap-3">
          <h2 id="answered" className="text-h2">
            Answered
          </h2>
          <ul className="flex flex-col">
            {answered.map((r) => (
              <li
                key={r.id}
                className="flex flex-col gap-0.5 border-t border-border py-3"
              >
                <span>
                  <strong>{r.proposedName}</strong> · {r.requester.name}
                </span>
                <span className="text-small text-text-muted">
                  {STATUS[r.status]} {day(r.decidedAt ?? r.createdAt)}
                  {r.declineReason && `: ${r.declineReason}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
