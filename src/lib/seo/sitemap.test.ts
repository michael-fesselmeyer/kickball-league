import { describe, expect, it } from "vitest";
import {
  buildRobots,
  buildSitemap,
  eventPages,
} from "./sitemap";

const ORIGIN = "https://league.example.test";

/** Each language's address prefix, in LOCALES order. */
const PREFIXES = ["", "/es", "/zh", "/ru", "/pl", "/bn", "/ko", "/ht"];

/** A page translated into every language: its address in each. */
const everyLanguage = (path: string) =>
  PREFIXES.map((prefix) => `${ORIGIN}${prefix}${path}`);

/** A page in English and Spanish only, such as the help center. */
const englishAndSpanish = (path: string) =>
  ["", "/es"].map((prefix) => `${ORIGIN}${prefix}${path}`);

describe("buildSitemap", () => {
  it("lists the content pages with absolute URLs and no trailing slash", () => {
    const urls = buildSitemap(ORIGIN).map((entry) => entry.url);
    expect(urls).toEqual([
      ...everyLanguage(""),
      ...everyLanguage("/parks/mccarren-park"),
      `${ORIGIN}/seasons`,
      ...everyLanguage("/faq"),
      `${ORIGIN}/rules`,
      `${ORIGIN}/contact`,
      `${ORIGIN}/nyc-kickball-league`,
      `${ORIGIN}/free-agents`,
      `${ORIGIN}/news/how-to-play-kickball`,
      ...everyLanguage("/about"),
      ...everyLanguage("/events"),
      ...everyLanguage("/sponsors"),
      `${ORIGIN}/private-events`,
      `${ORIGIN}/friends`,
      `${ORIGIN}/records`,
      `${ORIGIN}/history`,
      ...englishAndSpanish("/help"),
      ...englishAndSpanish("/help/player"),
      ...englishAndSpanish("/help/captain"),
      ...englishAndSpanish("/help/ref"),
      `${ORIGIN}/help/admin`,
      `${ORIGIN}/help/owner`,
      `${ORIGIN}/widget`,
    ]);
  });

  it("adds data pages after the content pages, with when they last changed", () => {
    const changed = new Date("2027-07-11T20:00:00Z");
    const sitemap = buildSitemap(ORIGIN, [
      { path: "/seasons/summer-2027/standings", lastModified: changed },
    ]);
    const urls = everyLanguage("/seasons/summer-2027/standings");
    const languages = Object.fromEntries(
      ["en", "es", "zh-Hans", "ru", "pl", "bn", "ko", "ht"].map((tag, i) => [
        tag,
        urls[i],
      ]),
    );
    // Standings are in every language: one entry each, each listing all.
    expect(sitemap.slice(-urls.length)).toEqual(
      urls.map((url) => ({
        url,
        lastModified: changed,
        changeFrequency: "daily",
        priority: 0.5,
        alternates: { languages },
      })),
    );
  });

  it("lists each event page with when it last changed", () => {
    const changed = new Date("2027-05-01T12:00:00Z");
    expect(
      eventPages([{ slug: "spring-bbq-2027-05-16", updatedAt: changed }]),
    ).toEqual([
      { path: "/events/spring-bbq-2027-05-16", lastModified: changed },
    ]);
  });

  it("ranks the home page first, in each language", () => {
    const sitemap = buildSitemap(ORIGIN);
    const homes = sitemap.slice(0, PREFIXES.length);
    expect(homes.map((e) => e.url)).toEqual(everyLanguage(""));
    for (const entry of homes) expect(entry.priority).toBe(1);
    for (const entry of sitemap.slice(PREFIXES.length))
      expect(entry.priority).toBeLessThan(1);
  });
});

describe("buildRobots", () => {
  it("in production, allows public pages, keeps private ones out and points at the sitemap", () => {
    expect(buildRobots(ORIGIN, true)).toEqual({
      rules: {
        userAgent: "*",
        allow: "/",
        disallow: ["/app", "/api", "/style", "/sign-in"],
      },
      sitemap: `${ORIGIN}/sitemap.xml`,
    });
  });

  it("anywhere else, asks crawlers to stay out entirely", () => {
    expect(buildRobots(ORIGIN, false)).toEqual({
      rules: { userAgent: "*", disallow: "/" },
    });
  });
});

describe("buildSitemap in several languages", () => {
  it("lists a translated page once per language, each with the others as alternates", () => {
    const sitemap = buildSitemap(ORIGIN, [], (path) =>
      path === "/faq" ? ["en", "es"] : ["en"],
    );
    const faq = sitemap.filter((e) => e.url.endsWith("/faq"));
    expect(faq.map((e) => e.url)).toEqual([
      `${ORIGIN}/faq`,
      `${ORIGIN}/es/faq`,
    ]);
    for (const entry of faq)
      expect(entry.alternates?.languages).toEqual({
        en: `${ORIGIN}/faq`,
        es: `${ORIGIN}/es/faq`,
      });
    // A page in English only has no alternates.
    expect(sitemap.find((e) => e.url === `${ORIGIN}/about`)?.alternates).toBe(
      undefined,
    );
  });
});
