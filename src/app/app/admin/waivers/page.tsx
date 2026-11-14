import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { WaiverText } from "@/components/waiver-text";
import { db } from "@/db/client";
import { currentLeague } from "@/db/queries/seasons";
import { waiversOf } from "@/db/queries/waivers";
import { season as seasonTable } from "@/db/schema/season";
import { waiver as waiverTable } from "@/db/schema/waiver";
import { requirePermission } from "@/lib/auth/permission";
import { desc, eq } from "drizzle-orm";
import { assignWaiverAction } from "./actions";
import { WaiverDraftForm } from "./draft-form";
import { PageLoading } from "@/components/page-loading";

export const metadata: Metadata = { title: "Waivers" };

export default function WaiversPage(props: PageProps<"/app/admin/waivers">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <Waivers {...props} />
      </Suspense>
    </main>
  );
}

const ERRORS: Record<string, string> = {
  unknown_season: "That season is gone.",
  unknown_waiver: "Pick one of the league's waiver versions.",
};

const day = (d: Date) =>
  new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(d);

async function Waivers({ searchParams }: PageProps<"/app/admin/waivers">) {
  await requirePermission("season.manage", { next: "/app/admin/waivers" });
  const query = await searchParams;
  const league = await currentLeague(db);
  if (!league) notFound();
  const versions = await waiversOf(db, league.id);
  const seasons = await db
    .select({
      slug: seasonTable.slug,
      name: seasonTable.name,
      waiverId: seasonTable.waiverId,
    })
    .from(seasonTable)
    .where(eq(seasonTable.leagueId, league.id))
    .orderBy(desc(seasonTable.startsOn));
  const [latest] = versions[0]
    ? await db
        .select({ bodyMd: waiverTable.bodyMd, title: waiverTable.title })
        .from(waiverTable)
        .where(eq(waiverTable.id, versions[0].id))
    : [];
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href="/app/admin/seasons" className="underline">
          All seasons
        </Link>
        <h1 className="text-h1">Waivers</h1>
        <p className="text-text-muted">
          Players sign their season&apos;s waiver before they can pay. Each
          signature keeps the typed name, time, IP address and a fingerprint of
          the exact text shown.
        </p>
      </header>
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      {(query.published || query.assigned) && (
        <p role="status" className="rounded-lg border border-success p-3">
          {query.published
            ? `Version ${String(query.published)} published. Choose which seasons use it below.`
            : `Saved the waiver for ${String(query.assigned)}.`}
        </p>
      )}

      <section aria-labelledby="seasons" className="flex flex-col gap-3">
        <h2 id="seasons" className="text-h2">
          Which waiver each season uses
        </h2>
        {seasons.map((s) => (
          <form
            key={s.slug}
            action={assignWaiverAction.bind(null, s.slug)}
            className="flex flex-wrap items-end gap-3"
          >
            <label className="flex flex-col gap-1">
              {s.name}
              <select
                name="waiverId"
                defaultValue={s.waiverId ?? ""}
                className="rounded-md border border-border bg-surface px-2 py-1"
              >
                <option value="">No waiver yet</option>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    Version {v.version}: {v.title}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn btn-secondary">
              Save
            </button>
          </form>
        ))}
      </section>

      <section aria-labelledby="versions" className="flex flex-col gap-3">
        <h2 id="versions" className="text-h2">
          Versions
        </h2>
        {versions.length === 0 ? (
          <p className="text-text-muted">No waiver yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {versions.map((v) => (
              <li key={v.id}>
                <strong>Version {v.version}</strong>: {v.title}{" "}
                <span className="text-text-muted">
                  · {day(v.effectiveAt)} · fingerprint{" "}
                  <code>{v.bodySha256.slice(0, 12)}</code>
                </span>
              </li>
            ))}
          </ul>
        )}
        {latest && (
          <details className="rounded-lg border border-border p-3">
            <summary>Read the latest version</summary>
            <div className="mt-3">
              <WaiverText body={latest.bodyMd} />
            </div>
          </details>
        )}
      </section>

      <section aria-labelledby="new" className="flex flex-col gap-3">
        <h2 id="new" className="text-h2">
          Publish a new version
        </h2>
        <WaiverDraftForm
          title={latest?.title ?? ""}
          body={latest?.bodyMd ?? ""}
        />
      </section>
    </>
  );
}
