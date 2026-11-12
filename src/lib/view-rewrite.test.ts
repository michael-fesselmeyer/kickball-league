import { describe, expect, it } from "vitest";
import { viewRewrite } from "./view-rewrite";

const rewrite = (url: string) => {
  const u = new URL(url, "http://localhost");
  return viewRewrite(u.pathname, u.searchParams);
};

describe("viewRewrite", () => {
  it("turns a schedule's team filter into a path segment", () => {
    expect(rewrite("/seasons/fall-2026/schedule?team=the-big-kicks")).toBe(
      "/seasons/fall-2026/schedule/the-big-kicks",
    );
  });

  it("turns a team page's season choice into a path segment", () => {
    expect(rewrite("/teams/the-big-kicks?season=spring-2026")).toBe(
      "/teams/the-big-kicks/spring-2026",
    );
  });

  it.each([
    "/seasons/fall-2026/schedule",
    "/seasons/fall-2026/schedule?team=",
    "/teams/the-big-kicks",
    "/teams/the-big-kicks?season=",
  ])("leaves the default view alone: %s", (url) => {
    expect(rewrite(url)).toBeNull();
  });

  it.each([
    "/seasons/fall-2026/schedule?team=../../app",
    "/seasons/fall-2026/schedule?team=Big%20Kicks",
    "/teams/the-big-kicks?season=%2Fapp",
  ])("ignores a value that is not a slug: %s", (url) => {
    expect(rewrite(url)).toBeNull();
  });

  it.each([
    "/seasons/fall-2026/standings?team=the-big-kicks",
    "/teams/the-big-kicks/calendar.ics?season=fall-2026",
    "/app/teams?season=spring",
  ])("leaves other pages alone: %s", (url) => {
    expect(rewrite(url)).toBeNull();
  });
});
