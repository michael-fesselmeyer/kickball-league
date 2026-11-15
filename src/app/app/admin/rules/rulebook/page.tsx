import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { db } from "@/db/client";
import { currentRules, rulebookVisibility, rulesVersion } from "@/db/queries/rules";
import { leagueHref } from "@/domain/league/paths";
import {
  RULEBOOK_VISIBILITIES,
  VISIBILITY_LABELS,
} from "@/domain/rules/rulebook";
import { requirePermission } from "@/lib/auth/permission";
import { activeLeague } from "@/lib/league/active";
import { setVisibilityAction } from "./actions";
import { RulebookImport } from "./rulebook-import";

export const metadata: Metadata = { title: "Rulebook" };

export default function RulebookAdminPage(
  props: PageProps<"/app/admin/rules/rulebook">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <Rulebook {...props} />
      </Suspense>
    </main>
  );
}

async function Rulebook({ searchParams }: PageProps<"/app/admin/rules/rulebook">) {
  const query = await searchParams;
  await requirePermission("rulebook.manage", {
    next: "/app/admin/rules/rulebook",
  });
  const league = await activeLeague();
  if (!league) notFound();
  const [visibility, sections, version] = await Promise.all([
    rulebookVisibility(db, league.id),
    currentRules(db, league.id),
    rulesVersion(db, league.id),
  ]);
  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href="/app/admin/rules" className="underline">
          ← League rules
        </Link>
        <h1 className="text-h1">Rulebook</h1>
        <p className="text-text-muted">
          Import the league&apos;s rulebook as numbered sections and rules,
          then choose who can read and search it. The text is kept in the app,
          and every import is saved as a dated change.
        </p>
      </header>
      {query.saved === "visibility" && (
        <p role="status" className="rounded-lg border border-success p-3">
          Saved.
        </p>
      )}
      {query.saved === "import" && (
        <p role="status" className="rounded-lg border border-success p-3">
          The rulebook is saved
          {visibility === "owners" && ", and only owners can see it yet"}.
        </p>
      )}

      <form action={setVisibilityAction} className="flex flex-col gap-3">
        <fieldset className="flex flex-col gap-1">
          <legend className="text-h2">Who can read it</legend>
          {RULEBOOK_VISIBILITIES.map((v) => (
            <label key={v} className="flex min-h-11 items-start gap-3 py-1">
              <input
                type="radio"
                name="visibility"
                value={v}
                defaultChecked={visibility === v}
                className="mt-1.5"
              />
              <span>
                <span className="font-bold">{VISIBILITY_LABELS[v].label}</span>
                <br />
                <span className="text-small text-text-muted">
                  {VISIBILITY_LABELS[v].help}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <button
          type="submit"
          className="min-h-11 self-start rounded-input bg-brand px-4 font-bold text-on-brand"
        >
          Save who can read it
        </button>
        <p className="text-small text-text-muted">
          Preview it in the app at{" "}
          <Link href="/app/rules" className="underline">
            League rules
          </Link>
          {visibility === "public" && (
            <>
              , or on the{" "}
              <Link href={leagueHref(league, "/rules")} className="underline">
                public page
              </Link>
            </>
          )}
          .
        </p>
      </form>

      <section aria-labelledby="import" className="flex flex-col gap-3">
        <h2 id="import" className="text-h2">
          Import the rulebook
        </h2>
        <RulebookImport version={version} hasRules={sections.length > 0} />
      </section>
    </>
  );
}
