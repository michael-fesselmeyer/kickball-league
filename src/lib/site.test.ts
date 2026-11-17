import { describe, expect, it } from "vitest";
import {
  absoluteUrl,
  HOME_PARK,
  homeParkMapUrl,
  isIndexable,
  SITE,
  siteBrand,
  siteOrigin,
} from "./site";

describe("siteBrand", () => {
  it("keeps the default name, short name and mark when nothing is set", () => {
    expect(siteBrand({})).toEqual({ name: null, shortName: null, logo: null });
    expect(SITE.name).toBe("Kickball League");
    expect(SITE.shortName).toBe("Kickball");
  });

  it("takes the league's name, short name and logo from configuration", () => {
    expect(
      siteBrand({
        SITE_NAME: " Harbor Lights Kickball ",
        SITE_SHORT_NAME: "HLK",
        SITE_LOGO: "/brand/logo-1a2b.png",
        SITE_LOGO_SIZE: "96x120",
      }),
    ).toEqual({
      name: "Harbor Lights Kickball",
      shortName: "HLK",
      logo: { src: "/brand/logo-1a2b.png", width: 96, height: 120 },
    });
  });

  it.each([
    [{ SITE_LOGO: "/brand/logo.png" }],
    [{ SITE_LOGO: "/brand/logo.png", SITE_LOGO_SIZE: "0x120" }],
    [{ SITE_LOGO: "/brand/logo.png", SITE_LOGO_SIZE: "wide" }],
    [{ SITE_LOGO: "https://elsewhere.test/logo.png", SITE_LOGO_SIZE: "9x9" }],
    [{ SITE_LOGO: "/brand/../other.png", SITE_LOGO_SIZE: "9x9" }],
    [{ SITE_LOGO: "/brand/logo.gif", SITE_LOGO_SIZE: "9x9" }],
  ])("ignores a malformed logo %j", (source) => {
    expect(siteBrand(source).logo).toBeNull();
  });

  it("ignores a blank or overlong name", () => {
    expect(siteBrand({ SITE_NAME: "  " }).name).toBeNull();
    expect(siteBrand({ SITE_NAME: "x".repeat(81) }).name).toBeNull();
  });
});

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
