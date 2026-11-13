import type { gameStatus } from "@/db/schema/game";

/**
 * Builders for the schema.org structured data (JSON-LD) the public pages
 * carry: docs/seo-plan.md, section 3, "Structured data". Each takes plain
 * values, so a page can call it with whatever its query returns.
 *
 * Every URL passed in must be absolute (see absoluteUrl in src/lib/site.ts).
 */

export type JsonLd = { "@context": "https://schema.org"; "@type": string } & {
  [key: string]: unknown;
};

const CONTEXT = "https://schema.org" as const;

/** Drops keys whose value is undefined, so optional facts leave no empty keys. */
function compact<T extends Record<string, unknown>>(node: T): T {
  return Object.fromEntries(
    Object.entries(node).filter(([, value]) => value !== undefined),
  ) as T;
}

export type PostalAddress = {
  streetAddress: string;
  addressLocality: string;
  addressRegion: string;
  postalCode?: string | undefined;
  addressCountry: string;
};

export type ParkInfo = {
  name: string;
  url: string;
  address: PostalAddress;
  geo?: { latitude: number; longitude: number } | undefined;
  mapUrl?: string | undefined;
};

export type LeagueInfo = {
  name: string;
  /** The site's home page. */
  url: string;
  description: string;
  sport: string;
  areaServed: readonly string[];
  logo?: string | undefined;
  email?: string | undefined;
  /** The league's own social profiles. Left out until it has real ones. */
  sameAs?: readonly string[] | undefined;
  park?: ParkInfo | undefined;
};

/** The stable identifier other nodes use to point at the league. */
export const leagueId = (league: Pick<LeagueInfo, "url">) =>
  `${league.url}/#league`;

const address = (a: PostalAddress) =>
  compact({ "@type": "PostalAddress", ...a });

const place = (park: ParkInfo) =>
  compact({
    "@type": "Park",
    name: park.name,
    url: park.url,
    address: address(park.address),
    geo: park.geo && { "@type": "GeoCoordinates", ...park.geo },
    hasMap: park.mapUrl,
  });

/** A short reference to the league, for teams and games that belong to it. */
const leagueRef = (league: LeagueInfo) => ({
  "@type": "SportsOrganization",
  "@id": leagueId(league),
  name: league.name,
  url: league.url,
  sport: league.sport,
});

/** The league itself: a SportsOrganization serving an area, with no storefront. */
export function leagueJsonLd(league: LeagueInfo): JsonLd {
  return compact({
    "@context": CONTEXT,
    "@type": "SportsOrganization",
    "@id": leagueId(league),
    name: league.name,
    url: league.url,
    description: league.description,
    sport: league.sport,
    logo: league.logo,
    email: league.email,
    areaServed: league.areaServed.map((name) => ({
      "@type": "City",
      name,
    })),
    location: league.park && place(league.park),
    sameAs:
      league.sameAs && league.sameAs.length > 0
        ? [...league.sameAs]
        : undefined,
  });
}

/** The site, so search engines show the league's name rather than the domain. */
export function websiteJsonLd(site: { name: string; url: string }): JsonLd {
  return {
    "@context": CONTEXT,
    "@type": "WebSite",
    name: site.name,
    url: site.url,
  };
}

export type TeamInfo = {
  name: string;
  /** The team's public page. */
  url: string;
  logo?: string | undefined;
};

const teamNode = (team: TeamInfo, league: LeagueInfo) =>
  compact({
    "@type": "SportsTeam",
    name: team.name,
    url: team.url,
    sport: league.sport,
    logo: team.logo,
    memberOf: leagueRef(league),
  });

/** A team page. The captain is never named here: rosters are not public data. */
export function teamJsonLd(team: TeamInfo, league: LeagueInfo): JsonLd {
  return { "@context": CONTEXT, ...teamNode(team, league) };
}

export type GameStatus = (typeof gameStatus.enumValues)[number];

const EVENT_STATUS: Record<GameStatus, string> = {
  scheduled: "https://schema.org/EventScheduled",
  in_progress: "https://schema.org/EventScheduled",
  final: "https://schema.org/EventScheduled",
  forfeit: "https://schema.org/EventScheduled",
  postponed: "https://schema.org/EventPostponed",
  cancelled: "https://schema.org/EventCancelled",
};

export type GameInfo = {
  /** The game's public page. */
  url: string;
  status: GameStatus;
  /** Unknown while a postponed game waits for a makeup slot. */
  startsAt?: Date | undefined;
  endsAt?: Date | undefined;
  /**
   * Set when a game moved: the time it was first scheduled for. A postponed
   * game with no new time keeps this as its start date, as search engines ask.
   */
  previousStartsAt?: Date | undefined;
  teams: readonly [TeamInfo, TeamInfo];
  /** Where it is played, such as "Field 2" at the park. */
  field?: string | undefined;
  park: ParkInfo;
  /** A one-line summary, such as the final score. */
  description?: string | undefined;
};

/**
 * A game: a SportsEvent between two teams. The league has no home or away
 * side (docs/open-questions.md, question 23), so both teams are competitors.
 * A game moved to a new time reads as rescheduled, with its old start time;
 * a postponed game without a new time stays postponed.
 */
export function gameJsonLd(game: GameInfo, league: LeagueInfo): JsonLd {
  const [a, b] = game.teams;
  const rescheduled =
    game.previousStartsAt !== undefined &&
    game.startsAt !== undefined &&
    game.status !== "cancelled";
  const location = place(game.park);
  return compact({
    "@context": CONTEXT,
    "@type": "SportsEvent",
    name: `${a.name} vs ${b.name}`,
    url: game.url,
    description: game.description,
    sport: league.sport,
    startDate: (game.startsAt ?? game.previousStartsAt)?.toISOString(),
    endDate: game.startsAt ? game.endsAt?.toISOString() : undefined,
    previousStartDate: rescheduled
      ? game.previousStartsAt?.toISOString()
      : undefined,
    eventStatus: rescheduled
      ? "https://schema.org/EventRescheduled"
      : EVENT_STATUS[game.status],
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: game.field
      ? { ...location, name: `${game.park.name}, ${game.field}` }
      : location,
    competitor: [teamNode(a, league), teamNode(b, league)],
    organizer: leagueRef(league),
  });
}

export type SocialEventInfo = {
  name: string;
  /** The event's page. */
  url: string;
  description?: string | undefined;
  startsAt: Date;
  endsAt: Date;
  /** Where, as the league wrote it: "Bar name, 123 Example St". */
  place?: string | undefined;
  cancelled: boolean;
  capacity?: number | undefined;
  spotsLeft?: number | undefined;
  /** A ticketed event's full price, in cents; left out for a free one. */
  priceCents?: number | undefined;
};

/** A league social event: a bar night, a BBQ, a tournament or a theme week. */
export function socialEventJsonLd(
  e: SocialEventInfo,
  league: LeagueInfo,
): JsonLd {
  return compact({
    "@context": CONTEXT,
    "@type": "SocialEvent",
    name: e.name,
    url: e.url,
    description: e.description || undefined,
    startDate: e.startsAt.toISOString(),
    endDate: e.endsAt.toISOString(),
    eventStatus: e.cancelled
      ? "https://schema.org/EventCancelled"
      : "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: e.place
      ? { "@type": "Place", name: e.place, address: e.place }
      : undefined,
    maximumAttendeeCapacity: e.capacity,
    remainingAttendeeCapacity: e.spotsLeft,
    isAccessibleForFree: e.priceCents === undefined,
    offers:
      e.priceCents === undefined
        ? undefined
        : {
            "@type": "Offer",
            price: (e.priceCents / 100).toFixed(2),
            priceCurrency: "USD",
            url: e.url,
            availability:
              e.spotsLeft === 0
                ? "https://schema.org/SoldOut"
                : "https://schema.org/InStock",
          },
    organizer: leagueRef(league),
  });
}

/** The park page. */
export function parkJsonLd(park: ParkInfo): JsonLd {
  return { "@context": CONTEXT, ...place(park) };
}

export type Question = { question: string; answer: string };

/** The FAQ page: plain-text answers, the same words the page shows. */
export function faqJsonLd(questions: readonly Question[]): JsonLd {
  return {
    "@context": CONTEXT,
    "@type": "FAQPage",
    mainEntity: questions.map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  };
}

export type ArticleInfo = {
  headline: string;
  description: string;
  /** The article's page. */
  url: string;
  datePublished: Date;
  dateModified?: Date | undefined;
};

/** A guide or news post, written and published by the league. */
export function articleJsonLd(
  article: ArticleInfo,
  league: LeagueInfo,
): JsonLd {
  return compact({
    "@context": CONTEXT,
    "@type": "Article",
    headline: article.headline,
    description: article.description,
    url: article.url,
    mainEntityOfPage: article.url,
    datePublished: article.datePublished.toISOString(),
    dateModified: article.dateModified?.toISOString(),
    inLanguage: "en-US",
    about: { "@type": "Thing", name: league.sport },
    author: leagueRef(league),
    publisher: leagueRef(league),
  });
}

/** The path to a page, from the home page down. */
export function breadcrumbJsonLd(
  trail: readonly { name: string; url: string }[],
): JsonLd {
  return {
    "@context": CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: trail.map((crumb, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: crumb.name,
      item: crumb.url,
    })),
  };
}

export type SponsorInfo = {
  name: string;
  kind: "bar" | "restaurant" | "brand" | "other";
  /** The sponsor's page on this site. */
  url: string;
  /** The business's own website. */
  sameAs?: string | undefined;
  /** One line, as the sponsor wrote it. */
  address?: string | undefined;
  description?: string | undefined;
};

const SPONSOR_TYPES: Record<SponsorInfo["kind"], string> = {
  bar: "BarOrPub",
  restaurant: "Restaurant",
  brand: "Organization",
  other: "Organization",
};

/**
 * A sponsor's page: a bar or restaurant is a LocalBusiness with premises
 * (BarOrPub, Restaurant); any other sponsor is an Organization.
 */
export function sponsorJsonLd(sponsor: SponsorInfo): JsonLd {
  return {
    "@context": CONTEXT,
    ...compact({
      "@type": SPONSOR_TYPES[sponsor.kind],
      name: sponsor.name,
      url: sponsor.url,
      sameAs: sponsor.sameAs,
      address: sponsor.address,
      description: sponsor.description,
    }),
  };
}

/**
 * JSON for a <script type="application/ld+json"> tag. Characters that could
 * close the tag or start markup are escaped, so a team named "</script>" is
 * data, not HTML (node_modules/next/dist/docs/01-app/02-guides/json-ld.md).
 */
export function serializeJsonLd(data: JsonLd | readonly JsonLd[]): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export type FriendLeagueInfo = {
  name: string;
  /** The league's own website. */
  url: string;
  /** What schema.org calls the sport; null for games and quizzes. */
  sport: string | null;
  description?: string | undefined;
  /** An absolute address of its logo on this site. */
  logo?: string | undefined;
  area?: string | undefined;
};

/**
 * The friends of the league page: an ItemList of the other local leagues
 * it links, each a SportsOrganization (or an Organization when it plays
 * games rather than a sport), pointing at the league's own site.
 */
export function friendsJsonLd(
  page: { name: string; url: string },
  friends: readonly FriendLeagueInfo[],
): JsonLd {
  return {
    "@context": CONTEXT,
    "@type": "ItemList",
    name: page.name,
    url: page.url,
    numberOfItems: friends.length,
    itemListElement: friends.map((f, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: f.name,
      item: compact({
        "@type": f.sport ? "SportsOrganization" : "Organization",
        name: f.name,
        url: f.url,
        sport: f.sport ?? undefined,
        description: f.description,
        logo: f.logo,
        areaServed: f.area,
      }),
    })),
  };
}
