import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const league: { current: { timeZone: string } | null } = {
    current: { timeZone: "America/New_York" },
  };
  return {
    drainOutbox: vi.fn(),
    release: vi.fn(),
    buildDigests: vi.fn(),
    logError: vi.fn(),
    transaction: vi.fn(),
    league,
  };
});

const zero = {
  sent: 0,
  retrying: 0,
  failed: 0,
  suppressed: 0,
  waiting: 0,
  held: 0,
  nextDay: 0,
};

vi.mock("next/server", () => ({ after: (fn: () => unknown) => fn() }));
vi.mock("@/env", () => ({
  env: {
    BETTER_AUTH_URL: "https://league.example.test",
    BETTER_AUTH_SECRET: "test-secret-value-for-unit-tests",
  },
}));
vi.mock("@/db/client", () => ({
  txDb: {
    transaction: (fn: (tx: unknown) => unknown) => mocks.transaction(fn),
  },
}));
vi.mock("@/db/queries/announcements", () => ({
  RELEASE_BATCH: 20,
  releaseDueAnnouncements: mocks.release,
}));
vi.mock("@/db/queries/digests", () => ({ buildDigests: mocks.buildDigests }));
vi.mock("@/db/queries/leagues", () => ({
  defaultLeague: async () => mocks.league.current,
}));
vi.mock("@/db/queries/outbox", () => ({
  DEFAULT_TIME_ZONE: "America/Chicago",
  drainOutbox: mocks.drainOutbox,
  emptyDrain: () => ({ ...zero }),
}));
vi.mock("@/emails/templates", () => ({ rendererFor: () => () => null }));
vi.mock("@/lib/log-error", () => ({ logError: mocks.logError }));

async function load(nodeEnv = "test") {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", nodeEnv);
  return import("./outbox");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.league.current = { timeZone: "America/New_York" };
  mocks.transaction.mockImplementation((fn) => fn({}));
  mocks.release.mockResolvedValue({ announcements: 0, messages: 0 });
});
afterEach(() => vi.unstubAllEnvs());

describe("drainOutboxNow", () => {
  it("adds up every batch and stops at the first empty one", async () => {
    mocks.drainOutbox
      .mockResolvedValueOnce({ ...zero, sent: 5, held: 1 })
      .mockResolvedValueOnce({ ...zero, sent: 2, nextDay: 3 })
      .mockResolvedValueOnce({ ...zero });
    const { drainOutboxNow } = await load();
    const total = await drainOutboxNow(new Date("2027-03-01T12:00:00Z"));
    expect(total).toEqual({ ...zero, sent: 7, held: 1, nextDay: 3 });
    expect(mocks.drainOutbox).toHaveBeenCalledTimes(3);
  });

  it("never runs more batches than asked for", async () => {
    mocks.drainOutbox.mockResolvedValue({ ...zero, sent: 1 });
    const { drainOutboxNow } = await load();
    const total = await drainOutboxNow(new Date(), 4);
    expect(mocks.drainOutbox).toHaveBeenCalledTimes(4);
    expect(total?.sent).toBe(4);
  });

  it("uses the default league's clock for quiet hours, or a fallback with no league", async () => {
    mocks.drainOutbox.mockResolvedValue({ ...zero });
    let { drainOutboxNow } = await load();
    await drainOutboxNow();
    expect(mocks.drainOutbox.mock.calls[0]?.[1].timeZone).toBe(
      "America/New_York",
    );
    mocks.league.current = null;
    ({ drainOutboxNow } = await load());
    await drainOutboxNow();
    expect(mocks.drainOutbox.mock.calls[1]?.[1].timeZone).toBe(
      "America/Chicago",
    );
  });

  it("returns null and sends nothing when no channel is configured, but still releases announcements", async () => {
    const { drainOutboxNow } = await load("production");
    expect(await drainOutboxNow()).toBeNull();
    expect(mocks.drainOutbox).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it("keeps releasing while a batch comes back full, up to ten rounds", async () => {
    mocks.release.mockResolvedValue({ announcements: 20, messages: 40 });
    mocks.drainOutbox.mockResolvedValue({ ...zero });
    const { drainOutboxNow } = await load();
    await drainOutboxNow();
    expect(mocks.release).toHaveBeenCalledTimes(10);
  });

  it("stops releasing at the first short batch", async () => {
    mocks.release
      .mockResolvedValueOnce({ announcements: 20, messages: 1 })
      .mockResolvedValueOnce({ announcements: 3, messages: 1 });
    mocks.drainOutbox.mockResolvedValue({ ...zero });
    const { drainOutboxNow } = await load();
    await drainOutboxNow();
    expect(mocks.release).toHaveBeenCalledTimes(2);
  });

  it("logs a release failure and still sends the rest of the outbox", async () => {
    mocks.release.mockRejectedValue(new Error("db down"));
    mocks.drainOutbox
      .mockResolvedValueOnce({ ...zero, sent: 2 })
      .mockResolvedValueOnce({ ...zero });
    const { drainOutboxNow } = await load();
    const total = await drainOutboxNow();
    expect(mocks.logError).toHaveBeenCalledTimes(1);
    expect(mocks.release).toHaveBeenCalledTimes(1);
    expect(total?.sent).toBe(2);
  });
});

describe("buildDigestsNow", () => {
  it("totals the batches and stops when one builds nothing", async () => {
    mocks.buildDigests
      .mockResolvedValueOnce({
        digests: 2,
        messages: 10,
        suppressed: 1,
        failed: 0,
      })
      .mockResolvedValueOnce({
        digests: 1,
        messages: 0,
        suppressed: 0,
        failed: 1,
      })
      .mockResolvedValueOnce({
        digests: 0,
        messages: 0,
        suppressed: 0,
        failed: 0,
      });
    const { buildDigestsNow } = await load();
    expect(await buildDigestsNow()).toEqual({
      digests: 3,
      messages: 10,
      suppressed: 1,
      failed: 1,
    });
    expect(mocks.buildDigests).toHaveBeenCalledTimes(3);
  });

  it("stops at maxBatches", async () => {
    mocks.buildDigests.mockResolvedValue({
      digests: 1,
      messages: 5,
      suppressed: 0,
      failed: 0,
    });
    const { buildDigestsNow } = await load();
    const total = await buildDigestsNow(new Date(), 2);
    expect(total.messages).toBe(10);
    expect(mocks.buildDigests).toHaveBeenCalledTimes(2);
  });
});

describe("sendQueuedSoon", () => {
  it("drains after the response and logs, rather than throws, when it fails", async () => {
    mocks.release.mockResolvedValue({ announcements: 0, messages: 0 });
    mocks.drainOutbox.mockRejectedValue(new Error("provider down"));
    const { sendQueuedSoon } = await load();
    sendQueuedSoon();
    await vi.waitFor(() => expect(mocks.logError).toHaveBeenCalledTimes(1));
    expect(mocks.logError.mock.calls[0]?.[0]).toContain("sweep will retry");
  });
});
