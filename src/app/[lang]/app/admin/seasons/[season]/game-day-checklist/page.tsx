import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";
import { db } from "@/db/client";
import { seasonChecklist } from "@/db/queries/game-day-checklist";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import {
  CHECKLIST_PHASES,
  ITEM_MAX,
  ITEMS_PER_PHASE_MAX,
  PHASE_LABELS,
  SCRIPT_MAX,
} from "@/domain/gameday/checklist";
import { requirePermission } from "@/lib/auth/permission";
import { activeLeagueId } from "@/lib/league/active";
import { saveChecklistAction } from "./actions";

export const metadata: Metadata = { title: "Edit the game-day checklist" };

const ERRORS: Record<string, string> = {
  too_many_items: `Keep each list to ${ITEMS_PER_PHASE_MAX} items.`,
  item_too_long: `Keep each item to ${ITEM_MAX} characters.`,
  no_items: "Write at least one item.",
  script_too_long: `Keep the script to ${SCRIPT_MAX} characters.`,
};

/**
 * An admin writes a season's game-day checklist (issue #409): the short
 * before and after lists each team's captains tick on game day, and the
 * set-up lead's script for asking park users to move.
 */
export default function GameDayChecklistPage(
  props: PageProps<"/app/admin/seasons/[season]/game-day-checklist">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <Editor {...props} />
      </Suspense>
    </main>
  );
}

const FIELD = "rounded-md border border-border bg-surface px-2 py-2 text-text";

async function Editor({
  params,
  searchParams,
}: PageProps<"/app/admin/seasons/[season]/game-day-checklist">) {
  const { season: slug } = await params;
  const query = await searchParams;
  const page = `/app/admin/seasons/${slug}/game-day-checklist`;
  await requirePermission("game_checklist.manage", { next: page });
  const season = await seasonBySlug(db, await activeLeagueId(), slug);
  if (!season) notFound();
  const list = await seasonChecklist(db, season.id);
  const error =
    typeof query.error === "string" ? (ERRORS[query.error] ?? null) : null;

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href={`/app/admin/seasons/${slug}`} className="underline">
          {season.name}
        </Link>
        <h1 className="text-h1">Game-day checklist</h1>
        <p className="text-text-muted">
          Each team&apos;s captains tick these on their game page on game day.
          The set-up lead sees them too, with the script below and the permit.
          One item per line.
          {list.custom ? "" : " These are the league's defaults."}
        </p>
      </header>
      {error && (
        <p role="alert" className="rounded-lg border-2 border-danger p-3">
          {error}
        </p>
      )}
      {query.notice === "saved" && (
        <p role="status" className="font-bold">
          Saved. Items you kept keep today&apos;s ticks.
        </p>
      )}
      <form
        action={saveChecklistAction.bind(null, slug)}
        className="flex flex-col gap-4"
      >
        {CHECKLIST_PHASES.map((p) => (
          <label key={p} htmlFor={`items-${p}`} className="flex flex-col gap-1">
            <span className="font-bold">{PHASE_LABELS[p]}</span>
            <textarea
              id={`items-${p}`}
              name={p}
              rows={Math.max(4, list.items[p].length + 1)}
              defaultValue={list.items[p].map((i) => i.text).join("\n")}
              className={FIELD}
            />
          </label>
        ))}
        <label htmlFor="script" className="flex flex-col gap-1">
          <span className="font-bold">Script for asking people to move</span>
          <span className="text-small text-text-muted">
            The set-up lead reads this before asking a group on the permitted
            field to make room. Leave it empty for the default.
          </span>
          <textarea
            id="script"
            name="script"
            rows={4}
            maxLength={SCRIPT_MAX}
            defaultValue={list.script}
            className={FIELD}
          />
        </label>
        <SubmitButton className="btn self-start btn-primary">Save</SubmitButton>
      </form>
    </>
  );
}
