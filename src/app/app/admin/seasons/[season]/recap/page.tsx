import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AnnouncementForm } from "@/components/announcements";
import { db } from "@/db/client";
import { savedRecapDraft } from "@/db/queries/ai";
import { DAILY_LIMIT, teamsToAnnounceTo } from "@/db/queries/announcements";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import type { AiAvailability } from "@/domain/ai/budget";
import { formatDollars } from "@/domain/ai/models";
import { dayHeading } from "@/domain/schedule/format";
import { weeklyRecap } from "@/domain/stats/recap";
import { requirePermission } from "@/lib/auth/permission";
import { recapAvailability } from "@/lib/ai/config";
import type { RecapFailure } from "@/lib/ai/recap";
import { sendLeagueAnnouncementAction } from "../announcements/actions";
import { writeAiRecapAction } from "./actions";
import { recapData } from "./recap-data";
import { WriteButton } from "./write-button";

export const metadata: Metadata = { title: "Weekly recap" };

export default function RecapPage(
  props: PageProps<"/app/admin/seasons/[season]/recap">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<p>Loading…</p>}>
        <Recap {...props} />
      </Suspense>
    </main>
  );
}

async function Recap({
  params,
  searchParams,
}: PageProps<"/app/admin/seasons/[season]/recap">) {
  const { season: slug } = await params;
  const query = await searchParams;
  await requirePermission("announcement.send", {
    next: `/app/admin/seasons/${slug}/recap`,
    scope: "league",
  });
  const season = await seasonBySlug(db, slug);
  if (!season) notFound();
  const [{ days, day, input }, teams, ai] = await Promise.all([
    recapData(season, typeof query.day === "string" ? query.day : null),
    teamsToAnnounceTo(db, season.id),
    recapAvailability(new Date()),
  ]);
  const template = input === null ? null : weeklyRecap(input);
  // With no key or the feature off, a saved AI draft stays out of sight too.
  const saved =
    ai.kind === "hidden" || day === null
      ? null
      : await savedRecapDraft(db, season.id, day);
  const showTemplate = query.draft === "template" || saved === null;
  const draft = showTemplate ? template : saved;
  const aiError =
    typeof query.ai_error === "string" && query.ai_error in AI_ERRORS
      ? AI_ERRORS[query.ai_error as RecapFailure]
      : null;

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href={`/app/admin/seasons/${slug}`} className="underline">
          {season.name}
        </Link>
        <h1 className="text-h1">Weekly recap</h1>
        <p className="text-text-muted">
          A draft written from the final scores, power rankings, streaks and
          records. Make it yours, then send it as an announcement.
        </p>
      </header>

      {day === null || draft === null ? (
        <p className="text-text-muted">
          No final scores yet. The draft appears after the first game day.
        </p>
      ) : (
        <>
          {days.length > 1 && (
            <nav aria-label="Game days" className="flex flex-wrap gap-2">
              {days.map((d) => (
                <Link
                  key={d}
                  href={`/app/admin/seasons/${slug}/recap?day=${d}`}
                  aria-current={d === day ? "page" : undefined}
                  className={`btn ${d === day ? "btn-primary" : "btn-secondary"}`}
                >
                  {dayHeading(d)}
                </Link>
              ))}
            </nav>
          )}
          {ai.kind !== "hidden" && (
            <AiPanel
              ai={ai}
              slug={slug}
              day={day}
              hasSaved={saved !== null}
              showingTemplate={showTemplate}
              written={query.ai === "written" && !showTemplate}
              error={aiError}
            />
          )}
          <section aria-labelledby="draft" className="flex flex-col gap-3">
            <h2 id="draft" className="text-h2">
              Recap for {dayHeading(day)}
            </h2>
            <AnnouncementForm
              key={`${day}-${showTemplate ? "template" : "ai"}`}
              action={sendLeagueAnnouncementAction.bind(null, slug)}
              audience={[
                { value: "league", label: `Everyone in ${season.name}` },
                ...teams.map((t) => ({ value: t.id, label: t.name })),
              ]}
              limitNote={`Nothing goes out until you send it. Up to ${DAILY_LIMIT.admin} announcements a day.`}
              defaults={draft}
            />
          </section>
        </>
      )}
    </>
  );
}

const AI_ERRORS: Record<RecapFailure, string> = {
  over_budget:
    "This month's AI budget is used up, so the AI draft is off until next month. The template draft is below.",
  too_big:
    "This game day has too much to fit in one AI draft. The template draft is below.",
  no_answer:
    "The AI provider didn't send a usable draft. Try again in a minute, or use the template draft below.",
  malformed:
    "The AI draft came back in the wrong shape, so we left it out. Try again, or use the template draft below.",
  too_long:
    "The AI draft was too long for an announcement, so we left it out. Try again, or use the template draft below.",
  unknown_score:
    "The AI draft quoted a score that wasn't played, so we left it out. Try again, or use the template draft below.",
  unknown_link:
    "The AI draft added a link we didn't give it, so we left it out. Try again, or use the template draft below.",
};

const monthDay = (d: Date) =>
  d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

function AiPanel({
  ai,
  slug,
  day,
  hasSaved,
  showingTemplate,
  written,
  error,
}: {
  ai: Exclude<AiAvailability, { kind: "hidden" }>;
  slug: string;
  day: string;
  hasSaved: boolean;
  showingTemplate: boolean;
  written: boolean;
  error: string | null;
}) {
  const base = `/app/admin/seasons/${slug}/recap?day=${day}`;
  return (
    <section
      aria-labelledby="ai-draft"
      className="flex flex-col gap-3 rounded-lg border border-border p-4"
    >
      <h2 id="ai-draft" className="text-h3">
        AI draft
      </h2>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      {written && (
        <p role="status">
          Here&apos;s the AI draft. Check every line before you send it.
        </p>
      )}
      {ai.kind === "over_budget" ? (
        <p className="text-text-muted">
          This month&apos;s AI budget is used up, so AI drafts are off until{" "}
          {monthDay(ai.resumesOn)}. The template draft below still works.
        </p>
      ) : (
        <>
          <p className="text-text-muted">
            The AI provider writes a livelier draft from the same scores,
            rankings, streaks and records. Every score it quotes is checked
            against the real ones. You still edit it and decide whether it goes
            out.
          </p>
          <form
            action={writeAiRecapAction.bind(null, slug)}
            className="flex flex-col gap-2"
          >
            <input type="hidden" name="day" value={day} />
            <WriteButton
              label={hasSaved ? "Write a new AI draft" : "Write it with AI"}
            />
          </form>
          <p className="text-small text-text-muted">
            This month: {formatDollars(ai.spentMicrodollars)} of{" "}
            {formatDollars(ai.budgetMicrodollars)} spent on AI drafts.
          </p>
        </>
      )}
      {hasSaved && (
        <p className="text-small">
          {showingTemplate ? (
            <Link href={base} className="underline">
              Edit the AI draft instead
            </Link>
          ) : (
            <Link href={`${base}&draft=template`} className="underline">
              Edit the template draft instead
            </Link>
          )}
        </p>
      )}
    </section>
  );
}
