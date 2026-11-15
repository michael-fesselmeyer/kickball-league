import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import {
  RuleChangeLog,
  upcomingWording,
} from "@/components/rulebook/rule-change-log";
import { RuleHighlight } from "@/components/rulebook/rule-highlight";
import { RulebookSearch } from "@/components/rulebook/rulebook-search";
import { RulebookSections } from "@/components/rulebook/rulebook-sections";
import { db } from "@/db/client";
import { changeLog, currentRules, rulebookVisibility } from "@/db/queries/rules";
import { localDate } from "@/domain/books/ledger-csv";
import { leagueHref } from "@/domain/league/paths";
import {
  canReadRulebook,
  VISIBILITY_LABELS,
} from "@/domain/rules/rulebook";
import { currentSubject } from "@/lib/auth/permission";
import { activeLeague } from "@/lib/league/active";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "League rules" };

/**
 * The rulebook inside the app (ADR 0065): for the owners while it is owners
 * only, and for everyone signed in while it is members only. Read when
 * asked, never cached, so turning the switch back takes effect at once.
 */
export default function MemberRulesPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-10 md:px-6">
      <Suspense fallback={<PageLoading>Loading the rules…</PageLoading>}>
        <Rules />
      </Suspense>
    </main>
  );
}

async function Rules() {
  const subject = await currentSubject();
  if (!subject.userId) redirect("/sign-in?next=%2Fapp%2Frules");
  const league = await activeLeague();
  if (!league) notFound();
  const visibility = await rulebookVisibility(db, league.id);
  if (!canReadRulebook(visibility, subject.globalRole))
    return (
      <header className="flex flex-col gap-3">
        <h1 className="text-h1">League rules</h1>
        <p className="text-text-muted">
          The league hasn&apos;t shared its rules here yet. Ask your captain for
          now.
        </p>
      </header>
    );
  const [sections, changes] = await Promise.all([
    currentRules(db, league.id),
    changeLog(db, league.id, 20),
  ]);
  const today = localDate(new Date(), league.timeZone);
  return (
    <>
      <header className="flex flex-col gap-3">
        <h1 className="text-h1">League rules</h1>
        {visibility === "owners" && (
          <p
            role="status"
            className="rounded-card border border-warning p-3 text-small"
          >
            {VISIBILITY_LABELS.owners.label}: only the league&apos;s owners can
            see this page until they{" "}
            <Link href="/app/admin/rules/rulebook" className="underline">
              share it
            </Link>
            .
          </p>
        )}
      </header>
      <RulebookSearch
        searchUrl={leagueHref(league, "/rules/search")}
        pagePath="/app/rules"
      />
      <RuleHighlight />
      <RulebookSections
        sections={sections}
        upcoming={upcomingWording(changes, today)}
        today={today}
      />
      <RuleChangeLog
        changes={changes}
        sections={sections}
        today={today}
        timeZone={league.timeZone}
      />
    </>
  );
}
