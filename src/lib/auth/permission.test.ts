import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted((): string[] => []);
const waitForRequest = vi.hoisted(() => vi.fn<() => Promise<void>>());
const getSession = vi.hoisted(() => vi.fn());
const requestHeaders = vi.hoisted(() => new Headers({ cookie: "s=1" }));

vi.mock("next/headers", () => ({ headers: async () => requestHeaders }));
vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn() }));
vi.mock("@/db/wait-for-request", () => ({ waitForRequest }));
vi.mock("./index", () => ({ auth: { api: { getSession } } }));
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/db/queries/subject", () => ({ loadSubject: vi.fn() }));
vi.mock("@/lib/league/active", () => ({ activeLeague: vi.fn() }));
vi.mock("@/lib/league/guard", () => ({
  allInLeague: vi.fn(),
  recordsOf: vi.fn(),
  requireInLeague: vi.fn(),
}));
vi.mock("@/lib/platform/site", () => ({
  currentSite: vi.fn(),
  isCurrentOperator: vi.fn(),
}));

const { currentAuthSession } = await import("./permission");

describe("currentAuthSession", () => {
  beforeEach(() => {
    calls.length = 0;
    waitForRequest.mockReset().mockImplementation(async () => {
      calls.push("waitForRequest");
    });
    getSession.mockReset().mockImplementation(async () => {
      calls.push("getSession");
      return { user: { id: "u1" }, session: { id: "s1" } };
    });
  });

  it("waits for a real request before asking Better Auth", async () => {
    await expect(currentAuthSession()).resolves.toEqual({
      user: { id: "u1" },
      session: { id: "s1" },
    });
    expect(calls).toEqual(["waitForRequest", "getSession"]);
    expect(getSession).toHaveBeenCalledWith({ headers: requestHeaders });
  });

  it("lets a prerender's end reach Next.js as it is, without entering Better Auth", async () => {
    // Next.js recognizes its own abort by the error's digest, so it must
    // arrive unchanged rather than rewrapped by Better Auth.
    const prerenderEnded = Object.assign(new Error("prerender complete"), {
      digest: "HANGING_PROMISE_REJECTION",
    });
    waitForRequest.mockRejectedValueOnce(prerenderEnded);
    await expect(currentAuthSession()).rejects.toBe(prerenderEnded);
    expect(getSession).not.toHaveBeenCalled();
  });

  it("still passes on a real error from the session lookup", async () => {
    const failure = new Error("database unreachable");
    getSession.mockRejectedValueOnce(failure);
    await expect(currentAuthSession()).rejects.toBe(failure);
  });
});
