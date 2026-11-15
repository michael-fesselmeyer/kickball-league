import type { Metadata } from "next";
import { cacheLife, cacheTag } from "next/cache";
import Link from "next/link";
import {
  RuleChangeLog,
  upcomingWording,
} from "@/components/rulebook/rule-change-log";
import { RuleHighlight } from "@/components/rulebook/rule-highlight";
import { RulebookSearch } from "@/components/rulebook/rulebook-search";
import { RulebookSections } from "@/components/rulebook/rulebook-sections";
import { db } from "@/db/client";
import { currentConductCode } from "@/db/queries/conduct";
import {
  changeLog,
  currentRules,
  type GameSettings,
  gameSettings,
  type LogEntry,
  rulebookVisibility,
  type SectionRow,
} from "@/db/queries/rules";
import { localDate } from "@/domain/books/ledger-csv";
import type { LeagueId } from "@/domain/ids";
import { WaiverText } from "@/components/waiver-text";
import { leagueHref } from "@/domain/league/paths";
import type { RulebookVisibility } from "@/domain/rules/rulebook";
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
  visibility: RulebookVisibility;
  sections: SectionRow[];
  changes: LogEntry[];
  settings: GameSettings | null;
  conduct: { title: string; bodyMd: string } | null;
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
  const found = await readUnlessBuildHasNoDatabase(async () => {
    const visibility = await rulebookVisibility(db, leagueId);
    // The rulebook's text and change log are read only when the league made
    // them public; otherwise nothing of them reaches this cached page.
    const open = visibility === "public";
    const [sections, changes, settings, code] = await Promise.all([
      open ? currentRules(db, leagueId) : [],
      open ? changeLog(db, leagueId, CHANGES_SHOWN) : [],
      gameSettings(db, leagueId),
      currentConductCode(db, leagueId),
    ]);
    return { visibility, sections, changes, settings, code };
  });
  const { visibility, sections, changes, settings, code } = found ?? {
    visibility: "owners" as const,
    sections: [],
    changes: [],
    settings: null,
    code: null,
  };
  if (settings) cacheTag(seasonTag(settings.seasonId));
  return {
    visibility,
    sections,
    changes,
    settings,
    conduct: code ? { title: code.title, bodyMd: code.bodyMd } : null,
    today: localDate(new Date(), timeZone),
  };
}

export default async function RulesPage({
  params,
}: PageProps<"/l/[league]/rules">) {
  const league = await publicLeague((await params).league, "/rules");
  const { visibility, sections, changes, settings, conduct, today } =
    await cachedRules(league.id, league.timeZone);
  const open = visibility === "public";

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-10 md:px-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-h1">
          League <span className="swipe">rules</span>
        </h1>
        <p className="max-w-prose text-body-lg text-text-muted">
          {open ? (
            <>
              How we play, as the league has written it. When a rule changes, it
              shows up in{" "}
              <a href="#changes" className="font-bold text-brand underline">
                what changed
              </a>{" "}
              with the day it starts.
            </>
          ) : visibility === "members" ? (
            "The league's rules are for its members."
          ) : (
            "The league hasn't posted its rules here yet."
          )}
        </p>
        {!open && visibility === "members" && (
          <Link href="/app/rules" className="font-bold text-brand underline">
            Read them in the app
          </Link>
        )}
      </header>

      {open && (
        <>
          <RulebookSearch
            searchUrl={leagueHref(league, "/rules/search")}
            pagePath={leagueHref(league, "/rules")}
          />
          <RuleHighlight />
          <RulebookSections
            sections={sections}
            upcoming={upcomingWording(changes, today)}
            today={today}
          />
        </>
      )}

      {conduct && (
        <section
          id="code-of-conduct"
          aria-labelledby="code-of-conduct-title"
          className="flex scroll-mt-20 flex-col gap-3"
        >
          <h2 id="code-of-conduct-title" className="text-h2">
            {conduct.title}
          </h2>
          <p className="text-text-muted">
            Every player accepts this when they register.
          </p>
          <WaiverText body={conduct.bodyMd} />
        </section>
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

      {open && (
        <RuleChangeLog
          changes={changes}
          sections={sections}
          today={today}
          timeZone={league.timeZone}
        />
      )}

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
