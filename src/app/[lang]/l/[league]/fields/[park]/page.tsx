import type { Metadata } from "next";
import { cacheLife, cacheTag } from "next/cache";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { ParkToday, type TodayDay } from "@/components/park-today";
import { db } from "@/db/client";
import type { LeagueInfo } from "@/db/queries/leagues";
import {
  type PublicPark,
  parkPermitWindows,
  publicParkBySlug,
} from "@/db/queries/park-page";
import { leagueHref } from "@/domain/league/paths";
import {
  dayText,
  parkDays,
  rangeText,
  type ParkDay,
} from "@/domain/parks/field-hours";
import { HOUSE_RULES, PERMIT_ISSUER } from "@/domain/parks/house-rules";
import { readUnlessBuildHasNoDatabase } from "@/lib/build-phase";
import { cachedLeague, publicLeague } from "@/lib/league/public";
import { PARKS_TAG, PUBLIC_PAGE_LIFE, parkTag } from "@/lib/public-cache";
import {
  NO_PARK,
  publicParkParams,
  type LeagueParams,
} from "@/lib/static-params";

type Props = PageProps<"/l/[league]/fields/[park]">;

/** How many permitted days the page lists. */
const DAYS_SHOWN = 14;

/** A cache life Next.js leaves out of the prerender and reads per request. */
const NOT_KEPT = { stale: 0, revalidate: 0, expire: 0 } as const;

export async function generateStaticParams(props: LeagueParams) {
  return publicParkParams(props);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { league: segment, park: slug } = await params;
  const league = await cachedLeague(segment);
  const park = league ? await findPark(league, slug) : null;
  if (!league || !park) return { title: "Who has this field" };
  return {
    title: `Who has the field at ${park.name}`,
    description: `The fields the league holds at ${park.name} under a NYC Parks permit, with the permit hours and house rules.`,
    alternates: { canonical: leagueHref(league, `/fields/${park.slug}`) },
  };
}

export default function ParkPage(props: Props) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 md:px-6">
      <Suspense fallback={<PageLoading>Loading the park…</PageLoading>}>
        <Park {...props} />
      </Suspense>
    </main>
  );
}

/** The park for the page's metadata, read inside the cache like the page. */
async function findPark(
  league: LeagueInfo,
  slug: string,
): Promise<PublicPark | null> {
  "use cache";
  cacheTag(PARKS_TAG, parkTag(slug));
  cacheLife(PUBLIC_PAGE_LIFE);
  if (slug === NO_PARK) return null;
  return readUnlessBuildHasNoDatabase(() =>
    publicParkBySlug(db, league.id, slug),
  );
}

async function Park({ params }: Props) {
  const { league: segment, park: slug } = await params;
  const league = await publicLeague(segment, `/fields/${slug}`);
  if (slug === NO_PARK) notFound();
  return <ParkDetails league={league} slug={slug} />;
}

/**
 * Cached, so the page is served as static HTML; a permit, field or park
 * change expires it through its tags. "Today" is not decided here: the
 * server lists the days not yet over, and the page works out which is today
 * in the visitor's browser (src/components/park-today.tsx).
 */
async function ParkDetails({
  league,
  slug,
}: {
  league: LeagueInfo;
  slug: string;
}) {
  "use cache";
  cacheTag(PARKS_TAG, parkTag(slug));
  const found = await readUnlessBuildHasNoDatabase(async () => {
    const park = await publicParkBySlug(db, league.id, slug);
    if (!park) return null;
    const windows = await parkPermitWindows(db, park.id, new Date());
    return { park, windows };
  });
  cacheLife(found ? PUBLIC_PAGE_LIFE : NOT_KEPT);
  if (!found) notFound();
  const { park, windows } = found;
  const zone = league.timeZone;
  const days = parkDays(windows, new Date(), zone, DAYS_SHOWN);
  const today: TodayDay[] = days.map((d) => ({
    date: d.date,
    label: dayText(d.date),
    lines: d.fields.map((f) => `${f.fieldName}: ${rangeText(f, zone)}`),
    endsAt: new Date(
      Math.max(...d.fields.map((f) => f.endsAt.getTime())),
    ).toISOString(),
  }));

  return (
    <>
      <header className="flex flex-col gap-2">
        <p>
          <span className="sticker">Who has this field 🏟️</span>
        </p>
        <h1 className="text-h1">
          <span className="swipe">{park.name}</span>
        </h1>
        {(park.address || park.neighborhood) && (
          <p className="text-text-muted">
            {[park.address, park.neighborhood].filter(Boolean).join(" · ")}
          </p>
        )}
        <p className="text-body-lg text-text-muted">
          Permitted by {PERMIT_ISSUER}: {league.name} holds the fields and hours
          below, and only those.
        </p>
      </header>

      <ParkToday days={today} timeZone={zone} />

      <section aria-labelledby="holds" className="flex flex-col gap-3">
        <h2 id="holds" className="text-h2">
          Fields and hours
        </h2>
        {days.length === 0 ? (
          <p className="rounded-card border border-border bg-surface p-4 text-text-muted">
            The league has no permit at {park.name} right now, so the fields
            here are open to everyone. Permitted days show here as soon as they
            are confirmed.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {days.map((d) => (
              <DayCard key={d.date} day={d} zone={zone} />
            ))}
          </ul>
        )}
        <p className="text-small text-text-muted">
          Times are in {zone.replace("_", " ")} time. Only a permit&apos;s
          number, field, dates and hours are shown here.
        </p>
      </section>

      <section aria-labelledby="rules" className="flex flex-col gap-3">
        <h2 id="rules" className="text-h2">
          House rules
        </h2>
        <ul className="list-disc pl-6">
          {HOUSE_RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </section>
    </>
  );
}

function DayCard({ day, zone }: { day: ParkDay; zone: string }) {
  return (
    <li className="rounded-card border border-border bg-surface p-4">
      <h3 className="text-h3">{dayText(day.date)}</h3>
      <ul className="mt-2 flex flex-col gap-1">
        {day.fields.map((f) => (
          <li key={`${f.fieldId}-${f.startsAt.toISOString()}`}>
            <strong>{f.fieldName}</strong>: {rangeText(f, zone)}
            <span className="block text-small text-text-muted">
              {f.permitNumbers.length > 0
                ? `Permit ${f.permitNumbers.join(", ")}, issued by ${PERMIT_ISSUER}`
                : `Issued by ${PERMIT_ISSUER}`}
            </span>
          </li>
        ))}
      </ul>
    </li>
  );
}
