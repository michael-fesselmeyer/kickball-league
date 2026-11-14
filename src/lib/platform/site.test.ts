import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const read = vi.hoisted(() => ({
  calls: 0,
  next: [] as ({ status: "active" | "paused" | "read_only" } | Error | null)[],
}));

vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/db/queries/platform", () => ({
  siteSettings: async () => {
    read.calls++;
    const next = read.next.shift();
    if (next instanceof Error) throw next;
    return next === null || next === undefined
      ? null
      : {
          leagueId: "league",
          name: "Test League",
          status: next.status,
          disabledFeatures: [],
        };
  },
}));

const load = async () => {
  vi.resetModules();
  return import("./site");
};

beforeEach(() => {
  read.calls = 0;
  read.next = [];
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2027-04-05T20:00:00Z"));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const down = () => new Error("connect ECONNREFUSED");

describe("siteForProxy while the database is down", () => {
  it("lets pages through on a server that never read the settings", async () => {
    const { siteForProxy } = await load();
    read.next = [down()];
    expect(await siteForProxy()).toBeNull();
  });

  it("keeps a paused site paused with the last settings it read", async () => {
    const { siteForProxy } = await load();
    read.next = [{ status: "paused" }, down()];
    expect((await siteForProxy())?.status).toBe("paused");
    vi.advanceTimersByTime(6_000);
    expect((await siteForProxy())?.status).toBe("paused");
    expect(read.calls).toBe(2);
  });

  it("waits a few seconds before asking the database again", async () => {
    const { siteForProxy } = await load();
    read.next = [down(), { status: "active" }];
    await siteForProxy();
    for (let i = 0; i < 20; i++) await siteForProxy();
    expect(read.calls).toBe(1);
    vi.advanceTimersByTime(6_000);
    expect((await siteForProxy())?.status).toBe("active");
    expect(read.calls).toBe(2);
  });

  it("still throws for everything but the proxy", async () => {
    const { currentSite } = await load();
    read.next = [down()];
    await expect(currentSite()).rejects.toThrow("ECONNREFUSED");
  });
});
