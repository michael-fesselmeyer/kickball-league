import { describe, expect, it, vi } from "vitest";
import { challengeFor, verifierMatches } from "@/lib/auth/app-handoff";
import {
  codeFromCallback,
  newVerifier,
  type ShellPlugins,
  shellPlugins,
  signInWithGoogleInApp,
} from "./app-sign-in-client";

const ORIGIN = "https://league.example.test";
const SCHEME = "com.example.kickball";
const crypto = globalThis.crypto;

/** A server that hands out one code for the challenge it was started with. */
function fakeSite() {
  let challenge = "";
  const redeemed: { code: string; verifier: string }[] = [];
  const start = (url: string) => {
    const u = new URL(url);
    expect(`${u.origin}${u.pathname}`).toBe(`${ORIGIN}/api/app-sign-in/google`);
    challenge = u.searchParams.get("challenge") ?? "";
    return `${SCHEME}:/sign-in?code=the-code`;
  };
  const fetch: typeof globalThis.fetch = async (url, init) => {
    expect(String(url)).toBe(`${ORIGIN}/api/auth/app-sign-in/redeem`);
    expect(init?.credentials).toBe("same-origin");
    const body = JSON.parse(String(init?.body)) as {
      code: string;
      verifier: string;
    };
    redeemed.push(body);
    const ok =
      body.code === "the-code" && verifierMatches(body.verifier, challenge);
    return new Response(null, { status: ok ? 200 : 400 });
  };
  return { start, fetch, redeemed };
}

describe("the app's side of Google sign-in", () => {
  it("knows when it is inside the app", () => {
    expect(shellPlugins(undefined)).toBeNull();
    expect(shellPlugins({})).toBeNull();
    expect(
      shellPlugins({ Capacitor: { isNativePlatform: () => false } }),
    ).toBeNull();
    const Plugins = { App: {} };
    expect(
      shellPlugins({ Capacitor: { isNativePlatform: () => true, Plugins } }),
    ).toBe(Plugins);
  });

  it("makes a verifier whose challenge the server can check", async () => {
    const { verifier, challenge } = await newVerifier(crypto);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challengeFor(verifier)).toBe(challenge);
  });

  it("reads the code only from the app's own scheme", () => {
    expect(codeFromCallback(`${SCHEME}:/sign-in?code=abc`, SCHEME)).toBe("abc");
    expect(
      codeFromCallback(`COM.EXAMPLE.KICKBALL:/sign-in?code=abc`, SCHEME),
    ).toBe("abc");
    expect(
      codeFromCallback("https://evil.example.test/?code=abc", SCHEME),
    ).toBeNull();
    expect(codeFromCallback(`${SCHEME}x:/sign-in?code=abc`, SCHEME)).toBeNull();
  });

  it("on iOS, uses the system sheet and trades its code with the verifier", async () => {
    const site = fakeSite();
    const plugins: ShellPlugins = {
      WebAuthSession: {
        start: vi.fn(async ({ url, callbackScheme }) => {
          expect(callbackScheme).toBe(SCHEME);
          return { url: site.start(url) };
        }),
      },
    };
    expect(
      await signInWithGoogleInApp({
        plugins,
        origin: ORIGIN,
        scheme: SCHEME,
        fetch: site.fetch,
        crypto,
      }),
    ).toBe("signed-in");
    expect(site.redeemed).toHaveLength(1);
  });

  it("on iOS, counts closing the sheet as cancelling", async () => {
    const site = fakeSite();
    const plugins: ShellPlugins = {
      WebAuthSession: { start: async () => Promise.reject(new Error("x")) },
    };
    expect(
      await signInWithGoogleInApp({
        plugins,
        origin: ORIGIN,
        scheme: SCHEME,
        fetch: site.fetch,
        crypto,
      }),
    ).toBe("cancelled");
    expect(site.redeemed).toEqual([]);
  });

  it("on Android, opens a browser tab and finishes when the app is opened with the code", async () => {
    const site = fakeSite();
    let onUrl: (data: { url?: string }) => void = () => {};
    const removed = vi.fn(async () => {});
    const close = vi.fn(async () => {});
    const plugins: ShellPlugins = {
      Browser: {
        open: async ({ url }) => {
          const back = site.start(url);
          // Something else opens the app first; it is ignored.
          onUrl({ url: "https://league.example.test/games/1" });
          onUrl({ url: back });
        },
        close,
      },
      App: {
        addListener: async (_event, fn) => {
          onUrl = fn;
          return { remove: removed };
        },
      },
    };
    expect(
      await signInWithGoogleInApp({
        plugins,
        origin: ORIGIN,
        scheme: SCHEME,
        fetch: site.fetch,
        crypto,
      }),
    ).toBe("signed-in");
    expect(close).toHaveBeenCalledOnce();
    expect(site.redeemed).toHaveLength(1);
    await vi.waitFor(() => expect(removed).toHaveBeenCalled());
  });

  it("on Android, counts closing the tab with no return as cancelling", async () => {
    const site = fakeSite();
    let finished: (() => void) | undefined;
    const plugins: ShellPlugins = {
      Browser: {
        open: async () => {},
        close: async () => {},
        addListener: async (_event, fn) => {
          finished = fn;
          return { remove: async () => {} };
        },
      },
      App: { addListener: async () => ({ remove: async () => {} }) },
    };
    const outcome = signInWithGoogleInApp({
      plugins,
      origin: ORIGIN,
      scheme: SCHEME,
      fetch: site.fetch,
      crypto,
    });
    await vi.waitFor(() => expect(finished).toBeDefined());
    finished!();
    expect(await outcome).toBe("cancelled");
    expect(site.redeemed).toEqual([]);
  });

  it("fails without the plugins it needs, or when the server refuses", async () => {
    expect(
      await signInWithGoogleInApp({
        plugins: {},
        origin: ORIGIN,
        scheme: SCHEME,
        crypto,
      }),
    ).toBe("failed");
    const refusing: typeof fetch = async () =>
      new Response(null, { status: 400 });
    expect(
      await signInWithGoogleInApp({
        plugins: {
          WebAuthSession: {
            start: async () => ({ url: `${SCHEME}:/sign-in?code=x` }),
          },
        },
        origin: ORIGIN,
        scheme: SCHEME,
        fetch: refusing,
        crypto,
      }),
    ).toBe("failed");
  });
});
