import type { Metadata } from "next";
import { cacheLife, cacheTag } from "next/cache";
import Link from "next/link";
import { db } from "@/db/client";
import {
  changeLog,
  currentRules,
  type GameSettings,
  gameSettings,
  type LogEntry,
  type SectionRow,
} from "@/db/queries/rules";
import { localDate } from "@/domain/books/ledger-csv";
import type { LeagueId } from "@/domain/ids";
import { blocksOf } from "@/domain/rules/rules";
import { ruleSetSummary } from "@/domain/season/divisions";
import { readUnlessBuildHasNoDatabase } from "@/lib/build-phase";
import { publicLeague, withCanonical } from "@/lib/league/public";
import { PUBLIC_PAGE_LIFE, RULES_TAG, seasonTag } from "@/lib/public-cache";

/**
 * The page reads its league from the path outside any <Suspense> boundary,
 * so it has no generic fallback shell: a league the build didn't list, or a
 * page a published change just expired, is rendered in full before it is
 * served, then kept, as the friends page does (ADR 0048).
 */
export const instant = false;

const METADATA: Metadata = {
  title: "League rules",
  description:
    "How we play: the league's rules by section, each division's game settings, and a dated list of every change.",
};

export function generateMetadata({
  params,
}: PageProps<"/l/[league]/rules">): Promise<Metadata> {
  return withCanonical(params, METADATA, "/rules");
}

/** How many changes the page lists. */
const CHANGES_SHOWN = 20;

type RulesData = {
  sections: SectionRow[];
  changes: LogEntry[];
  settings: GameSettings | null;
  today: string;
};

/**
 * Static HTML (ADR 0062): read once inside `use cache` and kept until an
 * admin publishes a change (refreshRulesPage), a division's rule set changes
 * (refreshSeasonPages) or PUBLIC_PAGE_LIFE runs out. No Suspense boundary,
 * so the rules are part of the first paint.
 */
async function cachedRules(
  leagueId: LeagueId,
  timeZone: string,
): Promise<RulesData> {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  cacheTag(RULES_TAG);
  const found = await readUnlessBuildHasNoDatabase(() =>
    Promise.all([
      currentRules(db, leagueId),
      changeLog(db, leagueId, CHANGES_SHOWN),
      gameSettings(db, leagueId),
    ]),
  );
  const [sections, changes, settings] = found ?? [[], [], null];
  if (settings) cacheTag(seasonTag(settings.seasonId));
  return {
    sections,
    changes,
    settings,
    today: localDate(new Date(), timeZone),
  };
}

const dayLabel = (on: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${on}T12:00:00Z`));

const KIND_WORDS = {
  added: "added",
  edited: "changed",
  removed: "removed",
} as const;

export default async function RulesPage({
  params,
}: PageProps<"/l/[league]/rules">) {
  const league = await publicLeague((await params).league, "/rules");
  const { sections, changes, settings, today } = await cachedRules(
    league.id,
    league.timeZone,
  );
  const publishedOn = (at: Date) => localDate(at, league.timeZone);
  // A section changed by a change that hasn't started yet says so.
  const upcoming = new Map<string, string>();
  for (const c of [...changes].reverse())
    for (const s of c.sections)
      if (c.effectiveOn > today && s.kind !== "removed")
        upcoming.set(s.slug, c.effectiveOn);
  const live = new Set(sections.map((s) => s.slug));

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-10 md:px-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-h1">
          League <span className="swipe">rules</span>
        </h1>
        <p className="max-w-prose text-body-lg text-text-muted">
          How we play, as the league has written it. When a rule changes, it
          shows up in{" "}
          <a href="#changes" className="font-bold text-brand underline">
            what changed
          </a>{" "}
          with the day it starts.
        </p>
        {sections.length > 1 && (
          <nav aria-label="Sections">
            <ul className="flex flex-wrap gap-x-4 gap-y-2">
              {sections.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.slug}`} className="underline">
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </header>

      {sections.length === 0 ? (
        <p className="rounded-card border border-border bg-surface p-4 text-text-muted">
          The league hasn&apos;t posted its rules here yet. Ask your captain for
          now.
        </p>
      ) : (
        sections.map((s) => (
          <section
            key={s.id}
            id={s.slug}
            aria-labelledby={`${s.slug}-title`}
            className="flex scroll-mt-20 flex-col gap-3"
          >
            <h2 id={`${s.slug}-title`} className="text-h2">
              {s.title}
            </h2>
            {upcoming.has(s.slug) && (
              <p className="self-start rounded-full border border-warning px-3 py-1 text-small font-bold">
                New wording from {dayLabel(upcoming.get(s.slug) ?? today)}
              </p>
            )}
            {blocksOf(s.body).map((b, i) =>
              b.kind === "list" ? (
                <ul key={i} className="flex list-disc flex-col gap-1 pl-6">
                  {b.items.map((item, j) => (
                    <li key={j}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p key={i} className="max-w-prose whitespace-pre-line">
                  {b.text}
                </p>
              ),
            )}
          </section>
        ))
      )}

      {settings && (
        <section
          id="game-settings"
          aria-labelledby="game-settings-title"
          className="flex flex-col gap-3"
        >
          <h2 id="game-settings-title" className="text-h2">
            Game settings by division
          </h2>
          <p className="text-text-muted">
            For {settings.seasonName}, from each division&apos;s rule set.
          </p>
          <ul className="flex flex-col">
            {settings.divisions.map((d) => (
              <li
                key={d.name}
                className="flex flex-col gap-0.5 border-t border-border py-2"
              >
                <span className="font-bold">{d.name}</span>
                <span className="text-text-muted">
                  {d.ruleSet
                    ? `${d.ruleSet.name}: ${ruleSetSummary(d.ruleSet) || "the league's usual settings"}`
                    : "The league's usual settings"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section
        id="changes"
        aria-labelledby="changes-title"
        className="flex flex-col gap-3"
      >
        <h2 id="changes-title" className="text-h2">
          What changed
        </h2>
        {changes.length === 0 ? (
          <p className="text-text-muted">No changes yet.</p>
        ) : (
          <ol className="flex flex-col">
            {changes.map((c) => (
              <li
                key={c.id}
                className="flex flex-col gap-1 border-t border-border py-3"
              >
                <p className="text-small text-text-muted">
                  <time dateTime={c.createdAt.toISOString()}>
                    {dayLabel(publishedOn(c.createdAt))}
                  </time>
                  {c.effectiveOn !== publishedOn(c.createdAt) && (
                    <>
                      {" · "}
                      {c.effectiveOn > today ? "Starts" : "Started"}{" "}
                      {dayLabel(c.effectiveOn)}
                    </>
                  )}
                </p>
                <p className="font-bold">{c.summary}</p>
                <p className="text-small">
                  {c.sections.map((s, i) => (
                    <span key={`${s.slug}-${s.kind}`}>
                      {i > 0 && ", "}
                      {live.has(s.slug) && s.kind !== "removed" ? (
                        <a href={`#${s.slug}`} className="underline">
                          {s.title}
                        </a>
                      ) : (
                        s.title
                      )}{" "}
                      {KIND_WORDS[s.kind]}
                    </span>
                  ))}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <p className="text-small text-text-muted">
        Questions about a rule? See the{" "}
        <Link href="/help" className="underline">
          help center
        </Link>{" "}
        or ask your captain.
      </p>
    </main>
  );
}
