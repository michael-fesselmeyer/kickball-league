import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { requirePermission } from "@/lib/auth/permission";
import { loadReport } from "../../report";
import { ReportCard } from "../../report-card";

export const metadata: Metadata = { title: "Season report card" };

type Props = PageProps<"/[lang]/app/owner/[season]/report">;

/**
 * The season report card for owners (issue #371): the season beside the
 * one before, money included, with a CSV and a shareable version.
 */
export default function ReportPage(props: Props) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading the report card…</PageLoading>}>
        <Report {...props} />
      </Suspense>
    </main>
  );
}

async function Report({ params }: Props) {
  const { season: slug } = await params;
  const page = `/app/owner/${slug}/report`;
  await requirePermission("dashboard.view", { next: page });
  const { season, current, previous } = await loadReport(slug);

  return (
    <>
      <header className="flex flex-col gap-3">
        <p className="text-text-muted">
          <Link href={`/app/owner/${season.slug}`} className="underline">
            Owner dashboard
          </Link>{" "}
          · {season.name}
        </p>
        <h1 className="text-h1">Season report card</h1>
        <p className="text-text-muted">
          {previous
            ? `${season.name} beside ${previous.name}, the season before.`
            : `${season.name}. There's no season before it to compare with yet.`}{" "}
          Numbers are at most five minutes old.
        </p>
        <div className="flex flex-wrap gap-3">
          <a href={`${page}.csv`} className="btn btn-secondary">
            Download CSV
          </a>
          <Link href={`${page}/share`} className="btn btn-secondary">
            Shareable version
          </Link>
        </div>
      </header>
      <ReportCard current={current} previous={previous} />
    </>
  );
}
