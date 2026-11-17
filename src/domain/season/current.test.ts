import { describe, expect, it } from "vitest";
import { currentSeason, isCurrentSeasonView } from "./current";

const s = (slug: string, status: string) => ({ slug, status });

describe("currentSeason", () => {
  it("picks the season being played over a newer one opening for sign-ups", () => {
    expect(
      currentSeason([
        s("spring-2027", "registration_open"),
        s("fall-2026", "in_progress"),
        s("summer-2026", "completed"),
      ])?.slug,
    ).toBe("fall-2026");
  });

  it("counts the playoffs as being played", () => {
    expect(
      currentSeason([s("fall-2026", "playoffs"), s("summer-2026", "completed")])
        ?.slug,
    ).toBe("fall-2026");
  });

  it("falls back to the latest finished season between seasons", () => {
    expect(
      currentSeason([
        s("spring-2027", "registration_closed"),
        s("fall-2026", "completed"),
        s("summer-2026", "completed"),
      ])?.slug,
    ).toBe("fall-2026");
  });

  it("uses the newest season before any has been played", () => {
    expect(currentSeason([s("spring-2027", "registration_open")])?.slug).toBe(
      "spring-2027",
    );
  });

  it("is null with no public seasons", () => {
    expect(currentSeason([])).toBeNull();
  });
});

describe("isCurrentSeasonView", () => {
  it("accepts only the header's views", () => {
    expect(isCurrentSeasonView("standings")).toBe(true);
    expect(isCurrentSeasonView("money")).toBe(false);
  });
});
