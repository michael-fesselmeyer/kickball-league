import { describe, expect, it } from "vitest";
import {
  articleJsonLd,
  breadcrumbJsonLd,
  faqJsonLd,
  gameJsonLd,
  leagueId,
  leagueJsonLd,
  parkJsonLd,
  serializeJsonLd,
  socialEventJsonLd,
  friendsJsonLd,
  sponsorJsonLd,
  teamJsonLd,
  websiteJsonLd,
  type GameInfo,
  type JsonLd,
  type LeagueInfo,
  type ParkInfo,
} from "./structured-data";

/*
 * A small validator for the schema.org types this site emits. It checks what
 * schema.org defines and search engines require for each type, so a builder
 * change that drops a required property, emits a relative URL or a date
 * without a time zone fails here rather than in Search Console.
 */

const REQUIRED: Record<string, readonly string[]> = {
  SportsOrganization: ["name", "url", "sport"],
  WebSite: ["name", "url"],
  SportsTeam: ["name", "url", "sport", "memberOf"],
  SportsEvent: [
    "name",
    "url",
    "startDate",
    "eventStatus",
    "location",
    "competitor",
    "organizer",
  ],
  SocialEvent: [
    "name",
    "url",
    "startDate",
    "endDate",
    "eventStatus",
    "organizer",
  ],
  Place: ["name", "address"],
  Park: ["name", "address"],
  BarOrPub: ["name", "url"],
  Restaurant: ["name", "url"],
  Organization: ["name", "url"],
  PostalAddress: ["streetAddress", "addressLocality", "addressCountry"],
  GeoCoordinates: ["latitude", "longitude"],
  City: ["name"],
  FAQPage: ["mainEntity"],
  Question: ["name", "acceptedAnswer"],
  Answer: ["text"],
  BreadcrumbList: ["itemListElement"],
  ItemList: ["itemListElement"],
  ListItem: ["position", "name", "item"],
  Article: ["headline", "url", "datePublished", "author", "publisher"],
  Offer: ["price", "priceCurrency", "url", "availability"],
  Thing: ["name"],
};

const EVENT_STATUSES = new Set(
  [
    "EventScheduled",
    "EventPostponed",
    "EventCancelled",
    "EventRescheduled",
    "EventMovedOnline",
  ].map((s) => `https://schema.org/${s}`),
);

const URL_KEYS = new Set([
  "url",
  "@id",
  "item",
  "hasMap",
  "logo",
  "sameAs",
  "mainEntityOfPage",
]);
const DATE_KEYS = new Set([
  "startDate",
  "endDate",
  "previousStartDate",
  "datePublished",
  "dateModified",
]);
const ISO_WITH_ZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function validate(node: unknown, path = "$", errors: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((item, i) => validate(item, `${path}[${i}]`, errors));
    return errors;
  }
  if (node === null || typeof node !== "object") return errors;
  const record = node as Record<string, unknown>;
  const type = record["@type"];
  if (typeof type === "string") {
    const required = REQUIRED[type];
    if (!required) errors.push(`${path}: unexpected @type ${type}`);
    for (const key of required ?? []) {
      const value = record[key];
      if (
        value === undefined ||
        value === "" ||
        (Array.isArray(value) && value.length === 0)
      )
        errors.push(`${path}: ${type} needs ${key}`);
    }
  }
  for (const [key, value] of Object.entries(record)) {
    const at = `${path}.${key}`;
    if (value === undefined || value === null || value === "")
      errors.push(`${at}: empty value`);
    // A list item is either a page's URL or the thing itself.
    const isNode = key === "item" && typeof value === "object";
    if (URL_KEYS.has(key) && !isNode) {
      for (const url of [value].flat()) {
        if (typeof url !== "string" || !/^https?:\/\/[^/]+/.test(url))
          errors.push(`${at}: not an absolute URL: ${String(url)}`);
      }
    }
    if (
      DATE_KEYS.has(key) &&
      (typeof value !== "string" || !ISO_WITH_ZONE.test(value))
    )
      errors.push(
        `${at}: not an ISO 8601 date-time with a zone: ${String(value)}`,
      );
    if (key === "eventStatus" && !EVENT_STATUSES.has(String(value)))
      errors.push(`${at}: unknown event status ${String(value)}`);
    validate(value, at, errors);
  }
  if (type === "SportsEvent") {
    const competitors = record.competitor;
    if (!Array.isArray(competitors) || competitors.length !== 2)
      errors.push(`${path}: a game has exactly two competitors`);
  }
  if (type === "BreadcrumbList") {
    const items = record.itemListElement as { position: number }[];
    items.forEach((item, i) => {
      if (item.position !== i + 1)
        errors.push(`${path}: breadcrumb positions must count from 1`);
    });
  }
  return errors;
}

/** Valid JSON-LD at the top level: a schema.org context and a type. */
function expectValid(data: JsonLd) {
  expect(data["@context"]).toBe("https://schema.org");
  // What a crawler reads is the serialized JSON, so validate that.
  const parsed: unknown = JSON.parse(serializeJsonLd(data));
  expect(validate(parsed)).toEqual([]);
}

const ORIGIN = "https://league.example.test";

const park: ParkInfo = {
  name: "McCarren Park",
  url: `${ORIGIN}/parks/mccarren-park`,
  address: {
    streetAddress: "Driggs Ave & Lorimer St",
    addressLocality: "Brooklyn",
    addressRegion: "NY",
    addressCountry: "US",
  },
  geo: { latitude: 40.7206, longitude: -73.9513 },
  mapUrl: "https://www.openstreetmap.org/?mlat=40.7206&mlon=-73.9513",
};

const league: LeagueInfo = {
  name: "Kickball League",
  url: ORIGIN,
  description: "Coed adult kickball.",
  sport: "Kickball",
  areaServed: ["Brooklyn", "New York City"],
  park,
};

const sluggers = {
  name: "Sunday Sluggers",
  url: `${ORIGIN}/teams/sunday-sluggers`,
};
const kickers = {
  name: "Red Rubber Kickers",
  url: `${ORIGIN}/teams/red-rubber-kickers`,
};

const game = (over: Partial<GameInfo> = {}): GameInfo => ({
  url: `${ORIGIN}/games/1`,
  status: "scheduled",
  startsAt: new Date("2027-07-11T18:00:00Z"),
  endsAt: new Date("2027-07-11T19:00:00Z"),
  teams: [sluggers, kickers],
  field: "Field 2",
  park,
  ...over,
});

describe("the validator", () => {
  // Proof that it catches what it is meant to, so a passing test means something.
  it("rejects a missing property, a relative URL and a date without a zone", () => {
    expect(
      validate({
        "@type": "SportsEvent",
        name: "A vs B",
        url: "/games/1",
        startDate: "2027-07-11T14:00",
        eventStatus: "https://schema.org/EventScheduled",
        competitor: [{ "@type": "City", name: "A" }],
        organizer: { "@type": "City", name: "L" },
      }),
    ).toEqual([
      "$: SportsEvent needs location",
      "$.url: not an absolute URL: /games/1",
      "$.startDate: not an ISO 8601 date-time with a zone: 2027-07-11T14:00",
      "$: a game has exactly two competitors",
    ]);
  });

  it("rejects unknown types, empty values and made-up event statuses", () => {
    expect(
      validate({ "@type": "Widget", name: "", eventStatus: "Happening" }),
    ).toEqual([
      "$: unexpected @type Widget",
      "$.name: empty value",
      "$.eventStatus: unknown event status Happening",
    ]);
  });

  it("checks breadcrumb positions", () => {
    expect(
      validate({
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 2, name: "Home", item: ORIGIN },
        ],
      }),
    ).toEqual(["$: breadcrumb positions must count from 1"]);
  });
});

describe("leagueJsonLd", () => {
  it("describes the league as a SportsOrganization serving Brooklyn and NYC", () => {
    const data = leagueJsonLd(league);
    expectValid(data);
    expect(data).toMatchObject({
      "@type": "SportsOrganization",
      "@id": `${ORIGIN}/#league`,
      sport: "Kickball",
      areaServed: [
        { "@type": "City", name: "Brooklyn" },
        { "@type": "City", name: "New York City" },
      ],
      location: { "@type": "Park", name: "McCarren Park" },
    });
  });

  it("leaves out facts the league has not supplied", () => {
    const data = leagueJsonLd({ ...league, park: undefined, sameAs: [] });
    expectValid(data);
    for (const key of ["logo", "email", "sameAs", "location"])
      expect(data).not.toHaveProperty(key);
  });

  it("includes a logo, an email and social profiles when there are some", () => {
    const data = leagueJsonLd({
      ...league,
      logo: `${ORIGIN}/logo.png`,
      email: "hello@example.test",
      sameAs: ["https://social.example.test/league"],
    });
    expectValid(data);
    expect(data).toMatchObject({
      logo: `${ORIGIN}/logo.png`,
      email: "hello@example.test",
      sameAs: ["https://social.example.test/league"],
    });
  });
});

describe("websiteJsonLd", () => {
  it("names the site", () => {
    const data = websiteJsonLd({ name: league.name, url: ORIGIN });
    expectValid(data);
    expect(data).toEqual({
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "Kickball League",
      url: ORIGIN,
    });
  });
});

describe("teamJsonLd", () => {
  it("is a SportsTeam that belongs to the league", () => {
    const data = teamJsonLd(sluggers, league);
    expectValid(data);
    expect(data).toMatchObject({
      "@type": "SportsTeam",
      name: "Sunday Sluggers",
      sport: "Kickball",
      memberOf: { "@id": leagueId(league), name: "Kickball League" },
    });
    expect(data).not.toHaveProperty("logo");
  });

  it("carries the team's logo when it has one", () => {
    const data = teamJsonLd({ ...sluggers, logo: `${ORIGIN}/t.png` }, league);
    expectValid(data);
    expect(data.logo).toBe(`${ORIGIN}/t.png`);
  });
});

describe("gameJsonLd", () => {
  it("is a scheduled SportsEvent between two teams at a field in the park", () => {
    const data = gameJsonLd(game(), league);
    expectValid(data);
    expect(data).toMatchObject({
      "@type": "SportsEvent",
      name: "Sunday Sluggers vs Red Rubber Kickers",
      startDate: "2027-07-11T18:00:00.000Z",
      endDate: "2027-07-11T19:00:00.000Z",
      eventStatus: "https://schema.org/EventScheduled",
      eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
      location: {
        "@type": "Park",
        name: "McCarren Park, Field 2",
        geo: { "@type": "GeoCoordinates", latitude: 40.7206 },
      },
      competitor: [
        { "@type": "SportsTeam", name: "Sunday Sluggers" },
        { "@type": "SportsTeam", name: "Red Rubber Kickers" },
      ],
      organizer: { "@type": "SportsOrganization", "@id": leagueId(league) },
    });
    expect(data).not.toHaveProperty("homeTeam");
    expect(data).not.toHaveProperty("previousStartDate");
  });

  it.each([
    ["in_progress", "EventScheduled"],
    ["final", "EventScheduled"],
    ["forfeit", "EventScheduled"],
    ["postponed", "EventPostponed"],
    ["cancelled", "EventCancelled"],
  ] as const)("maps a %s game to %s", (status, expected) => {
    const data = gameJsonLd(game({ status }), league);
    expectValid(data);
    expect(data.eventStatus).toBe(`https://schema.org/${expected}`);
  });

  it("marks a moved game as rescheduled, with its old start time", () => {
    const data = gameJsonLd(
      game({
        status: "scheduled",
        previousStartsAt: new Date("2027-07-04T18:00:00Z"),
      }),
      league,
    );
    expectValid(data);
    expect(data).toMatchObject({
      eventStatus: "https://schema.org/EventRescheduled",
      startDate: "2027-07-11T18:00:00.000Z",
      previousStartDate: "2027-07-04T18:00:00.000Z",
    });
  });

  it("keeps a rained-out game with no makeup slot postponed, on its original date", () => {
    const data = gameJsonLd(
      game({
        status: "postponed",
        startsAt: undefined,
        endsAt: undefined,
        previousStartsAt: new Date("2027-07-04T18:00:00Z"),
      }),
      league,
    );
    expectValid(data);
    expect(data).toMatchObject({
      eventStatus: "https://schema.org/EventPostponed",
      startDate: "2027-07-04T18:00:00.000Z",
    });
    expect(data).not.toHaveProperty("endDate");
    expect(data).not.toHaveProperty("previousStartDate");
  });

  it("keeps a cancelled game cancelled even if it had moved before", () => {
    const data = gameJsonLd(
      game({
        status: "cancelled",
        previousStartsAt: new Date("2027-07-04T18:00:00Z"),
      }),
      league,
    );
    expectValid(data);
    expect(data.eventStatus).toBe("https://schema.org/EventCancelled");
    expect(data).not.toHaveProperty("previousStartDate");
  });

  it("names the park alone when no field is known, and carries a summary", () => {
    const data = gameJsonLd(
      game({ field: undefined, status: "final", description: "Final: 7–5" }),
      league,
    );
    expectValid(data);
    expect(data).toMatchObject({
      location: { name: "McCarren Park" },
      description: "Final: 7–5",
    });
  });
});

describe("parkJsonLd", () => {
  it("is a Park with an address, coordinates and a map", () => {
    const data = parkJsonLd(park);
    expectValid(data);
    expect(data).toMatchObject({
      "@type": "Park",
      address: { "@type": "PostalAddress", addressLocality: "Brooklyn" },
      hasMap: park.mapUrl,
    });
  });

  it("leaves out coordinates and the map when unknown", () => {
    const data = parkJsonLd({ ...park, geo: undefined, mapUrl: undefined });
    expectValid(data);
    expect(data).not.toHaveProperty("geo");
    expect(data).not.toHaveProperty("hasMap");
  });
});

describe("sponsorJsonLd", () => {
  it("is a bar with its address and its own website", () => {
    const data = sponsorJsonLd({
      name: "The Corner Pocket",
      kind: "bar",
      url: `${ORIGIN}/sponsors/the-corner-pocket`,
      sameAs: "https://corner-pocket.example.test",
      address: "1 Example St, Brooklyn, NY",
    });
    expectValid(data);
    expect(data).toMatchObject({
      "@type": "BarOrPub",
      address: "1 Example St, Brooklyn, NY",
    });
    expect(data).not.toHaveProperty("description");
  });

  it("is an organization for a sponsor without premises", () => {
    const data = sponsorJsonLd({
      name: "Bounce Supply",
      kind: "brand",
      url: `${ORIGIN}/sponsors/bounce-supply`,
    });
    expectValid(data);
    expect(data["@type"]).toBe("Organization");
    expect(data).not.toHaveProperty("address");
  });
});

describe("friendsJsonLd", () => {
  const page = { name: "Friends of the league", url: `${ORIGIN}/friends` };

  it("lists each league in order, pointing at its own site", () => {
    const data = friendsJsonLd(page, [
      {
        name: "Greenpoint Slow-Pitch Social",
        url: "https://slow-pitch-social.example.test/",
        sport: "Softball",
        description: "Saturday mornings.",
        logo: `${ORIGIN}/media/friends/1`,
        area: "McCarren Park",
      },
      {
        name: "Meeple Night Collective",
        url: "https://meeple-night.example.test/",
        sport: null,
      },
    ]);
    expectValid(data);
    expect(data).toMatchObject({
      "@type": "ItemList",
      numberOfItems: 2,
      itemListElement: [
        {
          position: 1,
          name: "Greenpoint Slow-Pitch Social",
          item: {
            "@type": "SportsOrganization",
            sport: "Softball",
            url: "https://slow-pitch-social.example.test/",
            areaServed: "McCarren Park",
          },
        },
        {
          position: 2,
          item: { "@type": "Organization", name: "Meeple Night Collective" },
        },
      ],
    });
    // A league that plays games rather than a sport names no sport.
    expect(serializeJsonLd(data)).not.toContain('"sport":null');
  });

  it("is an empty list before any league is added", () => {
    const data = friendsJsonLd(page, []);
    expect(data).toMatchObject({ numberOfItems: 0, itemListElement: [] });
  });
});

describe("faqJsonLd", () => {
  it("lists each question with its answer", () => {
    const data = faqJsonLd([
      { question: "Is it coed?", answer: "Yes." },
      { question: "Can I come alone?", answer: "Yes, as a free agent." },
    ]);
    expectValid(data);
    expect(data.mainEntity).toEqual([
      {
        "@type": "Question",
        name: "Is it coed?",
        acceptedAnswer: { "@type": "Answer", text: "Yes." },
      },
      {
        "@type": "Question",
        name: "Can I come alone?",
        acceptedAnswer: { "@type": "Answer", text: "Yes, as a free agent." },
      },
    ]);
  });
});

describe("breadcrumbJsonLd", () => {
  it("numbers the trail from 1", () => {
    const data = breadcrumbJsonLd([
      { name: "Home", url: ORIGIN },
      { name: "McCarren Park", url: park.url },
    ]);
    expectValid(data);
    expect(data.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Home", item: ORIGIN },
      {
        "@type": "ListItem",
        position: 2,
        name: "McCarren Park",
        item: park.url,
      },
    ]);
  });
});

describe("articleJsonLd", () => {
  const guide = {
    headline: "How to play kickball",
    description: "The basics, in plain words.",
    url: `${ORIGIN}/news/how-to-play-kickball`,
    datePublished: new Date("2026-11-12T12:00:00Z"),
  };

  it("credits the league as author and publisher, with dated, absolute links", () => {
    const data = articleJsonLd(guide, league);
    expectValid(data);
    expect(data).toMatchObject({
      "@type": "Article",
      headline: guide.headline,
      mainEntityOfPage: guide.url,
      datePublished: "2026-11-12T12:00:00.000Z",
      about: { "@type": "Thing", name: "Kickball" },
      author: { "@id": leagueId(league) },
      publisher: { "@id": leagueId(league) },
    });
  });

  it("leaves out dateModified until the article changes", () => {
    expect(articleJsonLd(guide, league)).not.toHaveProperty("dateModified");
    const edited = articleJsonLd(
      { ...guide, dateModified: new Date("2027-03-01T12:00:00Z") },
      league,
    );
    expectValid(edited);
    expect(edited.dateModified).toBe("2027-03-01T12:00:00.000Z");
  });
});

describe("serializeJsonLd", () => {
  it("cannot close the script tag or start markup, and still parses back", () => {
    const team = {
      name: "</script><b>&\u2028\u2029",
      url: `${ORIGIN}/teams/x`,
    };
    const json = serializeJsonLd(teamJsonLd(team, league));
    expect(json).not.toMatch(/[<>&\u2028\u2029]/);
    expect(JSON.parse(json)).toMatchObject({ name: team.name });
  });

  it("serializes several nodes as an array", () => {
    const json = serializeJsonLd([
      leagueJsonLd(league),
      websiteJsonLd({ name: league.name, url: ORIGIN }),
    ]);
    expect(JSON.parse(json)).toHaveLength(2);
  });
});

describe("socialEventJsonLd", () => {
  const bbq = {
    name: "Spring kickoff BBQ",
    url: `${ORIGIN}/events/spring-kickoff-bbq-2027-04-10`,
    description: "Burgers and lawn games.",
    startsAt: new Date("2027-04-10T16:00:00Z"),
    endsAt: new Date("2027-04-10T20:00:00Z"),
    place: "McCarren Park, north picnic area",
    cancelled: false,
    capacity: 12,
    spotsLeft: 3,
  };

  it("is a scheduled SocialEvent at a place, run by the league", () => {
    const data = socialEventJsonLd(bbq, league);
    expectValid(data);
    expect(data).toMatchObject({
      "@type": "SocialEvent",
      startDate: "2027-04-10T16:00:00.000Z",
      eventStatus: "https://schema.org/EventScheduled",
      location: { "@type": "Place", name: "McCarren Park, north picnic area" },
      maximumAttendeeCapacity: 12,
      remainingAttendeeCapacity: 3,
      organizer: { "@id": leagueId(league) },
    });
  });

  it("says when it is called off and leaves out what it doesn't know", () => {
    const data = socialEventJsonLd(
      {
        ...bbq,
        description: "",
        place: undefined,
        capacity: undefined,
        spotsLeft: undefined,
        cancelled: true,
      },
      league,
    );
    expectValid(data);
    expect(data.eventStatus).toBe("https://schema.org/EventCancelled");
    for (const key of [
      "description",
      "location",
      "maximumAttendeeCapacity",
      "remainingAttendeeCapacity",
    ])
      expect(data).not.toHaveProperty(key);
  });

  it("is free unless it has a ticket price, which becomes an offer", () => {
    expect(socialEventJsonLd(bbq, league)).toMatchObject({
      isAccessibleForFree: true,
    });
    expect(socialEventJsonLd(bbq, league)).not.toHaveProperty("offers");
    const ticketed = socialEventJsonLd({ ...bbq, priceCents: 1250 }, league);
    expectValid(ticketed);
    expect(ticketed).toMatchObject({
      isAccessibleForFree: false,
      offers: {
        "@type": "Offer",
        price: "12.50",
        priceCurrency: "USD",
        url: bbq.url,
        availability: "https://schema.org/InStock",
      },
    });
    const soldOut = socialEventJsonLd(
      { ...bbq, priceCents: 1000, spotsLeft: 0 },
      league,
    );
    expect(soldOut).toMatchObject({
      offers: { availability: "https://schema.org/SoldOut" },
    });
  });
});
