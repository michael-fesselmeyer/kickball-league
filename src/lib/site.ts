/**
 * Facts about the league that the public pages, the sitemap and the
 * structured data share. The league's name and logo are configuration
 * (docs/design-system.md, section 1); this is the default deployment's copy.
 */
export const SITE = {
  name: "Kickball League",
  description:
    "Coed adult kickball in McCarren Park, Brooklyn. Bring a team or come solo, play on weeknights or Sunday afternoons, and meet people.",
  sport: "Kickball",
  areaServed: ["Brooklyn", "New York City"],
} as const;

/** The league's home park. One park, one page (docs/seo-plan.md, section 2). */
export const HOME_PARK = {
  name: "McCarren Park",
  path: "/parks/mccarren-park",
  neighborhoods: "Greenpoint and Williamsburg",
  address: {
    streetAddress: "Driggs Ave & Lorimer St",
    addressLocality: "Brooklyn",
    addressRegion: "NY",
    addressCountry: "US",
  },
  geo: { latitude: 40.7206, longitude: -73.9513 },
} as const;

/** A map of the park that needs no script or embed on our page. */
export const homeParkMapUrl = (): string => {
  const { latitude, longitude } = HOME_PARK.geo;
  return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=17/${latitude}/${longitude}`;
};

type Source = Readonly<Record<string, string | undefined>>;

/**
 * The address this deployment is served from, without a trailing slash. It is
 * the same address sign-in links use (BETTER_AUTH_URL, which src/lib/env.ts
 * fills in on Vercel), so canonical links and the sitemap always agree with it.
 */
export function siteOrigin(authUrl: string): string {
  return new URL(authUrl).origin;
}

/**
 * Only production is indexed. Preview and local deployments tell search
 * engines to stay away, so a preview address never competes with the real one.
 */
export function isIndexable(source: Source): boolean {
  return source.VERCEL_ENV === "production";
}

/** An absolute URL for a path on this site. */
export function absoluteUrl(origin: string, path: string): string {
  return new URL(path, `${origin}/`).toString().replace(/\/$/, "");
}
