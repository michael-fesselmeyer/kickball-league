import { describe, expect, it } from "vitest";
import {
  absoluteUrl,
  HOME_PARK,
  homeParkMapUrl,
  isIndexable,
  siteOrigin,
} from "./site";

describe("siteOrigin", () => {
  it.each([
    ["https://league.example.test", "https://league.example.test"],
    ["https://league.example.test/", "https://league.example.test"],
    ["http://localhost:3000/api/auth", "http://localhost:3000"],
  ])("%s → %s", (url, origin) => expect(siteOrigin(url)).toBe(origin));
});

describe("absoluteUrl", () => {
  const origin = "https://league.example.test";
  it.each([
    ["/", origin],
    ["/faq", `${origin}/faq`],
    ["/parks/mccarren-park", `${origin}/parks/mccarren-park`],
    ["/sitemap.xml", `${origin}/sitemap.xml`],
  ])("%s", (path, url) => expect(absoluteUrl(origin, path)).toBe(url));
});

describe("isIndexable", () => {
  it("indexes production only", () => {
    expect(isIndexable({ VERCEL_ENV: "production" })).toBe(true);
    expect(isIndexable({ VERCEL_ENV: "preview" })).toBe(false);
    expect(isIndexable({ VERCEL_ENV: "development" })).toBe(false);
    expect(isIndexable({})).toBe(false);
  });
});

describe("homeParkMapUrl", () => {
  it("points a map at the park's coordinates", () => {
    const { latitude, longitude } = HOME_PARK.geo;
    expect(homeParkMapUrl()).toBe(
      `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=17/${latitude}/${longitude}`,
    );
  });
});
