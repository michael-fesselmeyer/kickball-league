import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { requirePermission } from "@/lib/auth/permission";
import { loadReport } from "../../../report";
import { ReportCard } from "../../../report-card";

export const metadata: Metadata = { title: "Season report" };

type Props = PageProps<"/app/owner/[season]/report/share">;

/**
 * The report card owners can show sponsors: the same lines and charts with
 * no money, and nothing that names anyone. It stays behind the owners'
 * sign-in; they share it by printing it or saving it as a PDF.
 */
export default function ShareReportPage(props: Props) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading the report…</PageLoading>}>
        <ShareReport {...props} />
      </Suspense>
    </main>
  );
}

async function ShareReport({ params }: Props) {
  const { season: slug } = await params;
  await requirePermission("dashboard.view", {
    next: `/app/owner/${slug}/report/share`,
  });
  const { league, season, current, previous } = await loadReport(slug);

  return (
    <>
      <header className="flex flex-col gap-2">
        <p className="text-text-muted">{league.name}</p>
        <h1 className="text-h1">{season.name} season report</h1>
        <p>
          How the season went
          {previous ? `, beside ${previous.name}` : ""}: players, games and the
          community around the league.
        </p>
        <p className="text-small text-text-muted print:hidden">
          This version leaves out the league&apos;s money and anything about any
          one person. To share it, use your browser&apos;s Print to save it as a
          PDF.{" "}
          <Link href={`/app/owner/${season.slug}/report`} className="underline">
            Back to the full report card
          </Link>
        </p>
      </header>
      <ReportCard current={current} previous={previous} share />
    </>
  );
}
