type Source = Readonly<Record<string, string | undefined>>;

/** The league's logo: an image under `public/`, and its size in pixels. */
export type SiteLogo = { src: string; width: number; height: number };

export type SiteBrand = {
  /** The league's name, or null for the default (translated) one. */
  name: string | null;
  /** A short form for tight spots: the phone header, the home-screen label. */
  shortName: string | null;
  logo: SiteLogo | null;
};

const DEFAULT_NAME = "Kickball League";
const DEFAULT_SHORT_NAME = "Kickball";

const text = (value: string | undefined, max: number): string | null => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length <= max ? trimmed : null;
};

/**
 * The league's name and logo are configuration (docs/design-system.md,
 * section 1). A deployment may set SITE_NAME, SITE_SHORT_NAME and SITE_LOGO
 * with SITE_LOGO_SIZE ("<width>x<height>"); the laptop demo sets them from
 * a private file (docs/demo.md). Anything unset or malformed keeps the
 * default, so a bad value never breaks a page.
 */
export function siteBrand(source: Source): SiteBrand {
  const name = text(source.SITE_NAME, 80);
  const size = /^(\d{1,4})x(\d{1,4})$/.exec(source.SITE_LOGO_SIZE ?? "");
  const src = source.SITE_LOGO?.trim() ?? "";
  const logo =
    size &&
    /^\/[\w./-]+\.(png|webp|jpe?g|svg)$/.test(src) &&
    !src.includes("..")
      ? { src, width: Number(size[1]), height: Number(size[2]) }
      : null;
  return {
    name,
    shortName: text(source.SITE_SHORT_NAME, 24),
    logo: logo && logo.width > 0 && logo.height > 0 ? logo : null,
  };
}

export const BRAND = siteBrand(process.env);

/** The header's name: the configured one, else the page language's. */
export const brandName = (translated: string): string =>
  BRAND.name ?? translated;

/**
 * Facts about the league that the public pages, the sitemap and the
 * structured data share.
 */
export const SITE = {
  name: BRAND.name ?? DEFAULT_NAME,
  shortName: BRAND.shortName ?? DEFAULT_SHORT_NAME,
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
