import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { rebateBoard } from "@/db/queries/rebates";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { formatCents } from "@/domain/registration/pricing";
import { requirePermission } from "@/lib/auth/permission";
import { issueRebateAction } from "./actions";

export const metadata: Metadata = { title: "Rain-out rebates" };

export default function RebatesPage(
  props: PageProps<"/app/admin/seasons/[season]/rebates">,
) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<p>Loading…</p>}>
        <Rebates {...props} />
      </Suspense>
    </main>
  );
}

const ERRORS: Record<string, string> = {
  unknown_team: "That team isn't in this season.",
  not_eligible: "That team hasn't lost enough games for a rebate.",
  already_issued: "That team already has its rebate.",
};

async function Rebates({
  params,
  searchParams,
}: PageProps<"/app/admin/seasons/[season]/rebates">) {
  const { season: slug } = await params;
  const query = await searchParams;
  await requirePermission("refund.issue", {
    next: `/app/admin/seasons/${slug}/rebates`,
  });
  const season = await seasonBySlug(db, slug);
  if (!season) notFound();
  const { thresholdPct, rows } = await rebateBoard(db, season.id);
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const day = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: season.timeZone,
  });
  const due = rows.filter((r) => r.eligible && !r.issued && r.rebateCents > 0);

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href={`/app/admin/seasons/${slug}`} className="underline">
          {season.name}
        </Link>
        <h1 className="text-h1">Rain-out rebates</h1>
        <p className="text-text-muted">
          When more than {thresholdPct}% of a team&apos;s regular games are lost
          and not made up, the team gets that share of its fee back as league
          credit. Each person who paid toward the team gets their part, and an
          email. To return money to a card instead, refund the payment from{" "}
          <Link
            href={`/app/admin/seasons/${slug}/registrations`}
            className="underline"
          >
            Registrations
          </Link>
          .
        </p>
      </header>
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      {query.notice === "issued" && (
        <p role="status" className="rounded-lg border border-success p-3">
          Rebate issued as league credit. The players are being emailed.
        </p>
      )}
      <p>
        {due.length === 0
          ? "No team is due a rebate right now."
          : `${due.length} ${due.length === 1 ? "team is" : "teams are"} due a rebate.`}
      </p>
      {rows.length === 0 ? (
        <p className="text-text-muted">No teams in this season yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left">
            <thead className="text-text-muted">
              <tr>
                <th scope="col">Team</th>
                <th scope="col">Games lost</th>
                <th scope="col">Paid</th>
                <th scope="col">Rebate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.teamSeasonId} className="border-t border-border">
                  <td className="py-2">{r.teamName}</td>
                  <td>
                    {r.gamesLost} of {r.gamesCount}
                    {r.gamesCount > 0 && (
                      <span
                        className={
                          r.eligible ? "text-warning" : "text-text-muted"
                        }
                      >
                        {" "}
                        ({Math.round(r.lostPct)}%)
                      </span>
                    )}
                  </td>
                  <td>
                    {formatCents(r.paidCents)}
                    <span className="text-small text-text-muted">
                      {" "}
                      by {r.payers.length}{" "}
                      {r.payers.length === 1 ? "person" : "people"}
                    </span>
                  </td>
                  <td>
                    {r.issued ? (
                      <span className="text-success">
                        {formatCents(r.issued.rebateCents)} issued{" "}
                        {day.format(r.issued.createdAt)}
                      </span>
                    ) : r.eligible && r.rebateCents > 0 ? (
                      <form
                        action={issueRebateAction.bind(
                          null,
                          slug,
                          r.teamSeasonId,
                        )}
                      >
                        <button type="submit" className="btn btn-primary">
                          Issue {formatCents(r.rebateCents)} credit
                        </button>
                      </form>
                    ) : (
                      <span className="text-text-muted">None due</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
