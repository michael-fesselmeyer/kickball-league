import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { db } from "@/db/client";
import {
  currentRules,
  ruleChanges,
  rulebookVisibility,
  rulesVersion,
} from "@/db/queries/rules";
import { localDate } from "@/domain/books/ledger-csv";
import { earliestWithNotice } from "@/domain/rules/rules";
import { can } from "@/domain/authz/permissions";
import { canReadRulebook } from "@/domain/rules/rulebook";
import { requirePermission } from "@/lib/auth/permission";
import { leagueHref } from "@/domain/league/paths";
import { activeLeague } from "@/lib/league/active";
import { RulesEditor } from "./editor";

export const metadata: Metadata = { title: "Edit the rules" };

export default function AdminRulesPage(props: PageProps<"/[lang]/app/admin/rules">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <Rules {...props} />
      </Suspense>
    </main>
  );
}

const dayLabel = (on: string) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${on}T12:00:00Z`));

async function Rules({ searchParams }: PageProps<"/[lang]/app/admin/rules">) {
  const query = await searchParams;
  const subject = await requirePermission("rules.manage", {
    next: "/app/admin/rules",
  });
  const isOwner = can(subject, "rulebook.manage", {});
  const league = await activeLeague();
  if (!league) notFound();
  // The editor shows the full text, so it follows the visibility switch: an
  // admin who is not an owner sees it only once the owners share the rulebook.
  const visibility = await rulebookVisibility(db, league.id);
  if (!canReadRulebook(visibility, subject.globalRole))
    return (
      <header className="flex flex-col gap-1">
        <Link href="/app/admin" className="underline">
          ← League admin
        </Link>
        <h1 className="text-h1">League rules</h1>
        <p className="text-text-muted">
          The league&apos;s owners haven&apos;t shared the rulebook with admins
          yet. Ask an owner to change who can read it.
        </p>
      </header>
    );
  const [sections, changes, version] = await Promise.all([
    currentRules(db, league.id),
    ruleChanges(db, league.id, 10),
    rulesVersion(db, league.id),
  ]);
  const today = localDate(new Date(), league.timeZone);
  const told = typeof query.told === "string" ? Number(query.told) : 0;

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href="/app/admin" className="underline">
          ← League admin
        </Link>
        <h1 className="text-h1">League rules</h1>
        <p className="text-text-muted">
          Write the rules in sections. Each publish is saved as a dated change
          and listed on the{" "}
          <Link href={leagueHref(league, "/rules")} className="underline">
            public rules page
          </Link>{" "}
          under &ldquo;What changed&rdquo;. Each division&apos;s game settings
          (innings, time limit, bunting and stealing) appear there on their own,
          from its rule set.
        </p>
      </header>
      {isOwner && (
        <p>
          <Link
            href="/app/admin/rules/rulebook"
            className="font-bold underline"
          >
            Import the rulebook and choose who can read it
          </Link>
        </p>
      )}
      {query.published === "1" && (
        <p role="status" className="rounded-lg border border-success p-3">
          Published.
          {told > 0 &&
            ` The notice is on its way to ${told} ${told === 1 ? "player" : "players"}.`}
        </p>
      )}

      <RulesEditor
        current={sections.map((s) => ({
          id: s.id,
          title: s.title,
          body: s.body,
        }))}
        version={version}
        today={today}
        earliestNotice={dayLabel(earliestWithNotice(today))}
      />

      <section aria-labelledby="recent" className="flex flex-col gap-3">
        <h2 id="recent" className="text-h2">
          Recent changes
        </h2>
        {changes.length === 0 ? (
          <p className="text-text-muted">Nothing published yet.</p>
        ) : (
          <ul className="flex flex-col">
            {changes.map((c) => (
              <li
                key={c.id}
                className="flex flex-col gap-0.5 border-t border-border py-2"
              >
                <span className="font-bold">{c.summary}</span>
                <span className="text-small text-text-muted">
                  Published {dayLabel(localDate(c.createdAt, league.timeZone))}
                  {" · "}starts {dayLabel(c.effectiveOn)}
                  {c.notice &&
                    ` · notice sent to ${c.noticeRecipients ?? 0} ${c.noticeRecipients === 1 ? "player" : "players"}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
