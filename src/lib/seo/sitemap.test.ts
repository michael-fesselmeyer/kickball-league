import { describe, expect, it } from "vitest";
import { buildRobots, buildSitemap, CONTENT_PAGES } from "./sitemap";

const ORIGIN = "https://league.example.test";

describe("buildSitemap", () => {
  it("lists the content pages with absolute URLs and no trailing slash", () => {
    const urls = buildSitemap(ORIGIN).map((entry) => entry.url);
    expect(urls).toEqual([
      ORIGIN,
      `${ORIGIN}/parks/mccarren-park`,
      `${ORIGIN}/faq`,
      `${ORIGIN}/nyc-kickball-league`,
      `${ORIGIN}/free-agents`,
      `${ORIGIN}/news/how-to-play-kickball`,
      `${ORIGIN}/about`,
      `${ORIGIN}/records`,
      `${ORIGIN}/history`,
    ]);
    expect(urls).toHaveLength(CONTENT_PAGES.length);
  });

  it("adds data pages after the content pages, with when they last changed", () => {
    const changed = new Date("2027-07-11T20:00:00Z");
    const sitemap = buildSitemap(ORIGIN, [
      { path: "/seasons/summer-2027/standings", lastModified: changed },
    ]);
    expect(sitemap.at(-1)).toEqual({
      url: `${ORIGIN}/seasons/summer-2027/standings`,
      lastModified: changed,
      changeFrequency: "daily",
      priority: 0.5,
    });
  });

  it("ranks the home page first", () => {
    const [home, ...rest] = buildSitemap(ORIGIN);
    expect(home?.priority).toBe(1);
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
