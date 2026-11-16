import { describe, expect, it } from "vitest";
import {
  buildRobots,
  buildSitemap,
  CONTENT_PAGES,
  eventPages,
} from "./sitemap";

const ORIGIN = "https://league.example.test";

describe("buildSitemap", () => {
  it("lists the content pages with absolute URLs and no trailing slash", () => {
    const urls = buildSitemap(ORIGIN).map((entry) => entry.url);
    expect(urls).toEqual([
      ORIGIN,
      `${ORIGIN}/es`,
      `${ORIGIN}/parks/mccarren-park`,
      `${ORIGIN}/es/parks/mccarren-park`,
      `${ORIGIN}/seasons`,
      `${ORIGIN}/faq`,
      `${ORIGIN}/es/faq`,
      `${ORIGIN}/rules`,
      `${ORIGIN}/es/rules`,
      `${ORIGIN}/contact`,
      `${ORIGIN}/nyc-kickball-league`,
      `${ORIGIN}/free-agents`,
      `${ORIGIN}/news/how-to-play-kickball`,
      `${ORIGIN}/about`,
      `${ORIGIN}/es/about`,
      `${ORIGIN}/events`,
      `${ORIGIN}/es/events`,
      `${ORIGIN}/sponsors`,
      `${ORIGIN}/es/sponsors`,
      `${ORIGIN}/private-events`,
      `${ORIGIN}/friends`,
      `${ORIGIN}/records`,
      `${ORIGIN}/history`,
      `${ORIGIN}/help`,
      `${ORIGIN}/es/help`,
      `${ORIGIN}/help/player`,
      `${ORIGIN}/es/help/player`,
      `${ORIGIN}/help/captain`,
      `${ORIGIN}/es/help/captain`,
      `${ORIGIN}/help/ref`,
      `${ORIGIN}/es/help/ref`,
      `${ORIGIN}/help/admin`,
      `${ORIGIN}/help/owner`,
      `${ORIGIN}/widget`,
    ]);
    // These content pages are also in Spanish.
    expect(urls).toHaveLength(CONTENT_PAGES.length + 11);
  });

  it("adds data pages after the content pages, with when they last changed", () => {
    const changed = new Date("2027-07-11T20:00:00Z");
    const sitemap = buildSitemap(ORIGIN, [
      { path: "/seasons/summer-2027/standings", lastModified: changed },
    ]);
    const languages = {
      en: `${ORIGIN}/seasons/summer-2027/standings`,
      es: `${ORIGIN}/es/seasons/summer-2027/standings`,
    };
    // Standings are in Spanish too: one entry per language, each listing both.
    expect(sitemap.slice(-2)).toEqual(
      [languages.en, languages.es].map((url) => ({
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
    const [home, inSpanish, ...rest] = buildSitemap(ORIGIN);
    expect(home?.priority).toBe(1);
    expect(inSpanish?.url).toBe(`${ORIGIN}/es`);
    expect(inSpanish?.priority).toBe(1);
    for (const entry of rest) expect(entry.priority).toBeLessThan(1);
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
