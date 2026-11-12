import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { NEXT_GAME_CACHE, NEXT_GAME_INFO, savedGame } from "./offline-cache";

/**
 * The caching rules of public/sw.js, run as written against an in-memory
 * Cache Storage and a fake network. Nothing here imports the worker's logic
 * a second time: the file is evaluated with its globals passed in.
 */

const ORIGIN = "https://league.example.test";
const GAME = "/games/0f3c2b9e-1d4a-4c8e-9b7a-2e5f6a7b8c9d";
const OTHER_GAME = "/games/1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d";
const CSS = "/_next/static/css/app-1a2b.css";
const JS = "/_next/static/chunks/main-3c4d.js";
const GAME_JS = "/_next/static/chunks/game-5e6f.js";

const page = (title: string, assets: string[]) =>
  `<!DOCTYPE html><html><head>${assets
    .map((a) => `<link rel="preload" href="${a}">`)
    .join("")}</head><body class="flex"><h1>${title}</h1></body></html>`;

type Req = {
  url: string;
  method: string;
  mode: string;
  headers: Headers;
};

const keyOf = (input: string | Req | Request) => {
  const url = typeof input === "string" ? input : input.url;
  return new URL(url, ORIGIN).href;
};

class FakeCache {
  readonly entries = new Map<string, Response>();
  async match(input: string | Req) {
    return this.entries.get(keyOf(input))?.clone();
  }
  async put(input: string | Req, response: Response) {
    this.entries.set(keyOf(input), response.clone());
  }
  async delete(input: string | Req | Request) {
    return this.entries.delete(keyOf(input));
  }
  async keys() {
    return [...this.entries.keys()].map((url) => new Request(url));
  }
  paths() {
    return [...this.entries.keys()].map((url) => new URL(url).pathname).sort();
  }
}

class FakeCacheStorage {
  readonly stores = new Map<string, FakeCache>();
  async open(name: string) {
    let cache = this.stores.get(name);
    if (!cache) {
      cache = new FakeCache();
      this.stores.set(name, cache);
    }
    return cache;
  }
  async keys() {
    return [...this.stores.keys()];
  }
  async has(name: string) {
    return this.stores.has(name);
  }
  async delete(name: string) {
    return this.stores.delete(name);
  }
  async match(input: string | Req, options?: { cacheName?: string }) {
    const names = options?.cacheName
      ? [options.cacheName]
      : [...this.stores.keys()];
    for (const name of names) {
      const found = await this.stores.get(name)?.match(input);
      if (found) return found;
    }
    return undefined;
  }
}

type Call = { path: string; init: RequestInit | undefined };

class FakeNetwork {
  online = true;
  readonly calls: Call[] = [];
  readonly pages = new Map<string, () => Response>();

  serve(path: string, body: string, headers: Record<string, string> = {}) {
    this.pages.set(
      path,
      () =>
        new Response(body, {
          headers: { "Content-Type": "text/html; charset=utf-8", ...headers },
        }),
    );
  }

  fetch = async (input: string | Req, init?: RequestInit) => {
    const path = new URL(keyOf(input)).pathname;
    this.calls.push({ path, init });
    if (!this.online) throw new TypeError("Failed to fetch");
    const respond = this.pages.get(path);
    return respond ? respond() : new Response("Not found", { status: 404 });
  };

  fetched(path: string) {
    return this.calls.filter((c) => c.path === path);
  }
}

type Listener = (event: unknown) => void;

function loadWorker(network: FakeNetwork, storage: FakeCacheStorage) {
  const listeners = new Map<string, Listener>();
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: Listener) =>
      listeners.set(type, listener),
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  const source = readFileSync(join(process.cwd(), "public/sw.js"), "utf8");
  const exposed = new Function(
    "self",
    "caches",
    "fetch",
    `${source}\nreturn { routeFor, VERSION, SHELL_CACHE, NEXT_GAME_CACHE, NEXT_GAME_INFO };`,
  )(self, storage, network.fetch) as {
    routeFor: (request: Req) => string;
    VERSION: string;
    SHELL_CACHE: string;
    NEXT_GAME_CACHE: string;
    NEXT_GAME_INFO: string;
  };

  /** Dispatches an event and waits for everything it asked to wait for. */
  async function dispatch(type: string, fields: object = {}) {
    const pending: Promise<unknown>[] = [];
    let response: Promise<Response> | undefined;
    const event = {
      ...fields,
      waitUntil: (p: Promise<unknown>) => pending.push(p),
      respondWith: (p: Promise<Response>) => {
        response = p;
      },
    };
    listeners.get(type)?.(event);
    const result = response ? await response : undefined;
    // waitUntil may be called while the response is being produced.
    for (let i = 0; i < pending.length; i++) await pending[i];
    return result;
  }

  return {
    ...exposed,
    install: () => dispatch("install"),
    activate: () => dispatch("activate"),
    message: (data: unknown) => dispatch("message", { data }),
    fetch: (request: Req) => dispatch("fetch", { request }),
  };
}

type RequestOptions = {
  method?: string;
  mode?: string;
  headers?: Record<string, string>;
};

const request = (
  path: string,
  { method = "GET", mode = "cors", headers = {} }: RequestOptions = {},
): Req => ({
  url: new URL(path, ORIGIN).href,
  method,
  mode,
  headers: new Headers(headers),
});
const navigate = (path: string) => request(path, { mode: "navigate" });

let network: FakeNetwork;
let storage: FakeCacheStorage;
let worker: ReturnType<typeof loadWorker>;

beforeEach(() => {
  network = new FakeNetwork();
  storage = new FakeCacheStorage();
  network.serve("/offline", page("No signal", [CSS, JS]));
  network.serve(GAME, page("Kickers vs Sluggers", [CSS, JS, GAME_JS]), {
    "Set-Cookie": "session=abc",
    "Content-Encoding": "br",
  });
  network.serve(OTHER_GAME, page("Aces vs Bees", [CSS, JS, GAME_JS]));
  for (const path of [
    CSS,
    JS,
    GAME_JS,
    "/manifest.webmanifest",
    "/icons/icon-192.png",
    "/icons/icon-512.png",
    "/icons/maskable-512.png",
    "/icons/apple-touch-icon.png",
    "/app",
    "/app/admin",
  ])
    network.serve(path, `contents of ${path}`);
  worker = loadWorker(network, storage);
});

const shell = () => storage.stores.get(worker.SHELL_CACHE);
const games = () => storage.stores.get(worker.NEXT_GAME_CACHE);

describe("service worker: shared names", () => {
  it("matches the names the offline page reads", () => {
    expect(worker.NEXT_GAME_CACHE).toBe(NEXT_GAME_CACHE);
    expect(worker.NEXT_GAME_INFO).toBe(NEXT_GAME_INFO);
    expect(worker.SHELL_CACHE).toBe(`kb-shell-${worker.VERSION}`);
  });
});

describe("service worker: which requests it handles", () => {
  it("leaves writes, other sites, API routes and router data alone", () => {
    expect(worker.routeFor(request("/app", { method: "POST" }))).toBe(
      "network",
    );
    expect(
      worker.routeFor({
        ...navigate("/"),
        url: "https://maps.example.test/",
      }),
    ).toBe("network");
    expect(worker.routeFor(request("/api/auth/get-session"))).toBe("network");
    expect(worker.routeFor(navigate("/api/teams/calendar.ics"))).toBe(
      "network",
    );
    expect(worker.routeFor(request(GAME, { headers: { RSC: "1" } }))).toBe(
      "network",
    );
    expect(worker.routeFor(request(`${GAME}?_rsc=abc`))).toBe("network");
    expect(worker.routeFor(request("/games/x/share.png"))).toBe("network");
  });

  it("serves versioned files and shell files from the cache first", () => {
    expect(worker.routeFor(request(CSS))).toBe("asset");
    expect(worker.routeFor(request("/icons/icon-192.png"))).toBe("shell");
    expect(worker.routeFor(request("/manifest.webmanifest"))).toBe("shell");
    expect(worker.routeFor(navigate("/app/admin"))).toBe("page");
  });

  it("does not intercept what it leaves alone", async () => {
    expect(await worker.fetch(request("/api/rsvp", { method: "POST" }))).toBe(
      undefined,
    );
    expect(await worker.fetch(request("/api/me"))).toBe(undefined);
    expect(network.calls).toEqual([]);
  });
});

describe("service worker: the app shell", () => {
  it("saves the offline page, its files and the icons when it installs", async () => {
    await worker.install();
    expect(shell()?.paths()).toEqual(
      [
        "/offline",
        CSS,
        JS,
        "/manifest.webmanifest",
        "/icons/icon-192.png",
        "/icons/icon-512.png",
        "/icons/maskable-512.png",
        "/icons/apple-touch-icon.png",
      ].sort(),
    );
    // The offline page is fetched without cookies.
    expect(network.fetched("/offline")[0]?.init?.credentials).toBe("omit");
  });

  it("installs offline without failing, and saves nothing", async () => {
    network.online = false;
    await worker.install();
    expect(shell()?.paths() ?? []).toEqual([]);
  });

  it("serves a saved versioned file without the network", async () => {
    await worker.install();
    network.online = false;
    const response = await worker.fetch(request(CSS));
    expect(await response?.text()).toBe(`contents of ${CSS}`);
  });

  it("fetches a versioned file it has not saved, and does not keep it", async () => {
    await worker.install();
    const response = await worker.fetch(request("/_next/static/other.js"));
    expect(response?.status).toBe(404);
    expect(shell()?.paths()).not.toContain("/_next/static/other.js");
  });

  it("drops files from an older deploy when the shell is refreshed", async () => {
    await worker.install();
    network.serve("/offline", page("No signal", [CSS, "/_next/static/new.js"]));
    network.serve("/_next/static/new.js", "new");
    await worker.message({ type: "next-game", path: null, label: "" });
    expect(shell()?.paths()).toContain("/_next/static/new.js");
    expect(shell()?.paths()).not.toContain(JS);
  });

  it("deletes caches from older versions when it activates", async () => {
    await storage.open("kb-shell-v0");
    await storage.open("kb-next-game-v0");
    await storage.open("someone-elses-cache");
    await worker.install();
    await worker.activate();
    expect(await storage.keys()).toEqual(
      expect.arrayContaining([worker.SHELL_CACHE, "someone-elses-cache"]),
    );
    expect(await storage.has("kb-shell-v0")).toBe(false);
    expect(await storage.has("kb-next-game-v0")).toBe(false);
  });
});

describe("service worker: signed-in screens are never cached", () => {
  it("serves payments, waivers and admin screens from the network only", async () => {
    await worker.install();
    for (const path of [
      "/app",
      "/app/admin",
      "/app/seasons/fall/waiver",
      "/app/seasons/fall/register",
    ]) {
      const response = await worker.fetch(navigate(path));
      expect(response?.status).toBeGreaterThan(0);
    }
    const saved = [...storage.stores.values()].flatMap((c) => c.paths());
    expect(saved.filter((p) => p.startsWith("/app"))).toEqual([]);
  });

  it("shows the offline page, never a stale copy, when they cannot load", async () => {
    await worker.install();
    await worker.fetch(navigate("/app/admin"));
    network.online = false;
    const response = await worker.fetch(navigate("/app/admin"));
    expect(await response?.text()).toContain("No signal");
  });

  it("answers plainly when nothing at all is saved", async () => {
    network.online = false;
    const response = await worker.fetch(navigate("/standings"));
    expect(response?.status).toBe(503);
  });
});

describe("service worker: the next game", () => {
  const save = (path: string | null, label = "Kickers vs Sluggers") =>
    worker.message({ type: "next-game", path, label });

  it("saves the public game page without cookies, with its files", async () => {
    await worker.install();
    await save(GAME);
    expect(network.fetched(GAME)[0]?.init?.credentials).toBe("omit");
    expect(games()?.paths()).toEqual([GAME, NEXT_GAME_INFO].sort());
    expect(shell()?.paths()).toContain(GAME_JS);
    const copy = await games()?.match(GAME);
    expect(copy?.headers.get("Set-Cookie")).toBeNull();
    expect(copy?.headers.get("Content-Encoding")).toBeNull();
    expect(copy?.headers.get("X-Saved-At")).toMatch(/^\d{4}-/);
  });

  it("opens the saved game with no signal, marked as a saved copy", async () => {
    await worker.install();
    await save(GAME);
    network.online = false;
    const html = await (await worker.fetch(navigate(GAME)))?.text();
    expect(html).toContain("Kickers vs Sluggers");
    expect(html).toMatch(
      /<body class="flex"><p role="status"[^>]*>You're offline\. This is the copy saved on /,
    );
  });

  it("shows the offline page for a game that is not the saved one", async () => {
    await worker.install();
    await save(GAME);
    network.online = false;
    const html = await (await worker.fetch(navigate(OTHER_GAME)))?.text();
    expect(html).toContain("No signal");
  });

  it("refreshes the saved copy whenever the game is opened online", async () => {
    await worker.install();
    await save(GAME);
    network.serve(GAME, page("Kickers 5, Sluggers 3", [CSS, JS, GAME_JS]));
    const response = await worker.fetch(navigate(GAME));
    expect(await response?.text()).toContain("Kickers 5");
    expect(await (await games()?.match(GAME))?.text()).toContain("Kickers 5");
  });

  it("does not save other games just because they were opened", async () => {
    await worker.install();
    await worker.fetch(navigate(OTHER_GAME));
    expect(games()?.paths() ?? []).toEqual([]);
  });

  it("keeps one game: a new next game replaces the old one", async () => {
    await worker.install();
    await save(GAME);
    await save(OTHER_GAME, "Aces vs Bees");
    expect(games()?.paths()).toEqual([OTHER_GAME, NEXT_GAME_INFO].sort());
    expect(await savedGame(storage)).toEqual({
      path: OTHER_GAME,
      label: "Aces vs Bees",
    });
  });

  it("keeps the saved game when the new one cannot be fetched", async () => {
    await worker.install();
    await save(GAME);
    network.online = false;
    await save(OTHER_GAME);
    expect(games()?.paths()).toEqual([GAME, NEXT_GAME_INFO].sort());
  });

  it("refuses to save anything but a public game page", async () => {
    await worker.install();
    for (const path of [
      "/app",
      "/app/seasons/fall/waiver",
      "/api/me",
      `${GAME}/../../app`,
      "https://elsewhere.example.test/games/x",
    ])
      await save(path);
    await worker.message("next-game");
    await worker.message(null);
    expect(storage.stores.has(worker.NEXT_GAME_CACHE)).toBe(false);
  });

  it("forgets the saved game when there is no next game or on sign-out", async () => {
    await worker.install();
    await save(GAME);
    await save(null);
    expect(storage.stores.has(worker.NEXT_GAME_CACHE)).toBe(false);
    await save(GAME);
    await worker.message({ type: "forget" });
    expect(storage.stores.has(worker.NEXT_GAME_CACHE)).toBe(false);
  });
});
