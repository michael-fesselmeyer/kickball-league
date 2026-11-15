import type * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LeagueInfo } from "@/db/queries/leagues";
import type { LeagueId } from "@/domain/ids";
import { cachedLeague } from "./public";
import { activeLeague } from "./active";

// The cookie the person's league switcher sets, per test.
const jar = vi.hoisted(() => ({ league: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "league" && jar.league ? { value: jar.league } : undefined,
  }),
}));
// React's per-render cache: each call here is its own render.
vi.mock("react", async (actual) => ({
  ...(await actual<typeof React>()),
  cache: <T>(fn: T) => fn,
}));
// The cached read the public pages use; never the database directly.
vi.mock("./public", () => ({ cachedLeague: vi.fn() }));

const league = (slug: string, isDefault = false): LeagueInfo => ({
  id: (isDefault
    ? "1ea90000-0000-4000-8000-000000000001"
    : "1ea90000-0000-4000-8000-000000000002") as LeagueId,
  name: `League ${slug}`,
  slug,
  sport: "kickball",
  timeZone: "America/New_York",
  isDefault,
  minimumAge: 21,
  branding: {},
});

beforeEach(() => {
  jar.league = undefined;
  vi.mocked(cachedLeague).mockReset();
  vi.mocked(cachedLeague).mockImplementation(async (segment) =>
    segment === "_default"
      ? league("home", true)
      : segment === "brooklyn"
        ? league("brooklyn")
        : null,
  );
});

describe("activeLeague", () => {
  it("reads the default league from the data cache without a switch", async () => {
    expect((await activeLeague())?.slug).toBe("home");
    expect(cachedLeague).toHaveBeenCalledWith("_default");
  });

  it("reads the league the person switched to from the data cache", async () => {
    jar.league = "brooklyn";
    expect((await activeLeague())?.slug).toBe("brooklyn");
    expect(cachedLeague).toHaveBeenCalledTimes(1);
  });

  it("falls back to the default league when the chosen one is gone", async () => {
    jar.league = "closed-league";
    expect((await activeLeague())?.slug).toBe("home");
  });

  it("ignores a cookie that is not a league slug", async () => {
    jar.league = "_default";
    expect((await activeLeague())?.slug).toBe("home");
    expect(cachedLeague).toHaveBeenCalledTimes(1);
  });
});
