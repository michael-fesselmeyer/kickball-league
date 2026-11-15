import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LEAGUE_SEGMENT,
  isLeagueSlug,
  leagueBase,
  leagueHref,
  leagueOfPath,
  leagueRoute,
} from "./paths";

const kickball = { slug: "kickball", isDefault: true };
const football = { slug: "flag-football", isDefault: false };

describe("leagueHref", () => {
  it("keeps the default league at the site's own URLs", () => {
    expect(leagueHref(kickball, "/")).toBe("/");
    expect(leagueHref(kickball, "/seasons/fall-2026/schedule")).toBe(
      "/seasons/fall-2026/schedule",
    );
    expect(leagueBase(kickball)).toBe("");
  });

  it("puts another league's pages under /l/<slug>", () => {
    expect(leagueHref(football, "/")).toBe("/l/flag-football");
    expect(leagueHref(football, "/teams/hail-marys?season=fall-2026")).toBe(
      "/l/flag-football/teams/hail-marys?season=fall-2026",
    );
    expect(leagueBase(football)).toBe("/l/flag-football");
  });
});

describe("leagueRoute", () => {
  it("rewrites the default league's pages onto the _default segment", () => {
    expect(leagueRoute("/")).toEqual({
      kind: "rewrite",
      path: `/l/${DEFAULT_LEAGUE_SEGMENT}`,
    });
    expect(leagueRoute("/seasons/fall-2026/standings")).toEqual({
      kind: "rewrite",
      path: `/l/${DEFAULT_LEAGUE_SEGMENT}/seasons/fall-2026/standings`,
    });
    expect(leagueRoute("/events/calendar.ics")?.kind).toBe("rewrite");
    // Each league has its own rules page (ADR 0062).
    expect(leagueRoute("/rules")).toEqual({
      kind: "rewrite",
      path: `/l/${DEFAULT_LEAGUE_SEGMENT}/rules`,
    });
  });

  it("sends a typed /l/_default address back to the real one", () => {
    expect(leagueRoute(`/l/${DEFAULT_LEAGUE_SEGMENT}/records`)).toEqual({
      kind: "redirect",
      path: "/records",
    });
    expect(leagueRoute(`/l/${DEFAULT_LEAGUE_SEGMENT}`)).toEqual({
      kind: "redirect",
      path: "/",
    });
  });

  it("leaves another league's pages and every other path alone", () => {
    for (const path of [
      "/l/flag-football",
      "/l/flag-football/seasons/fall-2026/schedule",
      "/app",
      "/sign-in",
      "/operator",
      "/faq",
      "/about",
      "/api/jobs/outbox",
    ])
      expect(leagueRoute(path), path).toBeNull();
  });
});

describe("leagueOfPath", () => {
  it("names the league a public path belongs to", () => {
    expect(leagueOfPath("/")).toBeNull();
    expect(leagueOfPath("/teams/the-big-kicks")).toBeNull();
    expect(leagueOfPath("/l/flag-football/teams/the-big-kicks")).toBe(
      "flag-football",
    );
    expect(leagueOfPath(`/l/${DEFAULT_LEAGUE_SEGMENT}/records`)).toBeNull();
    expect(leagueOfPath("/app/admin")).toBeUndefined();
  });
});

describe("isLeagueSlug", () => {
  it("never accepts the reserved default segment", () => {
    expect(isLeagueSlug(DEFAULT_LEAGUE_SEGMENT)).toBe(false);
    expect(isLeagueSlug("flag-football")).toBe(true);
    expect(isLeagueSlug("Flag")).toBe(false);
    expect(isLeagueSlug("a--b")).toBe(false);
  });

  it("round-trips: a league's href always routes to that league", () => {
    const slug = fc
      .array(fc.stringMatching(/^[a-z0-9]{1,6}$/), {
        minLength: 1,
        maxLength: 3,
      })
      .map((parts) => parts.join("-"));
    const path = fc.constantFrom(
      "/",
      "/seasons/fall-2026/schedule",
      "/teams/x",
      "/events",
    );
    fc.assert(
      fc.property(slug, path, fc.boolean(), (s, p, isDefault) => {
        const href = leagueHref({ slug: s, isDefault }, p);
        expect(leagueOfPath(href)).toBe(isDefault ? null : s);
      }),
    );
  });
});
