import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { NEXT_GAME_CACHE, NEXT_GAME_INFO, savedGame } from "./offline-cache";
import { OUTBOX_DB, SEND_TAG } from "./score-outbox";

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

/**
 * Just enough IndexedDB for the worker's outbox: object stores with a key
 * path, auto-increment, and add, put, delete, clear and getAll. Each request
 * applies at once; the transaction completes on the next turn, as a real
 * one does once its requests are done.
 */
type Row = Record<string, unknown>;

class FakeStore {
  readonly rows = new Map<number | string, Row>();
  private next = 1;
  constructor(
    readonly keyPath: string,
    readonly autoIncrement: boolean,
  ) {}
  keyOf(row: Row) {
    if (this.autoIncrement && row[this.keyPath] === undefined)
      return { ...row, [this.keyPath]: this.next++ };
    return row;
  }
  all() {
    return [...this.rows.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([, row]) => structuredClone(row));
  }
}

class FakeRequest {
  result: unknown = undefined;
  error: unknown = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
}

class FakeTransaction {
  error: unknown = null;
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor(readonly objectStore: (name: string) => unknown) {}
}

class FakeIndexedDB {
  readonly stores = new Map<string, FakeStore>();
  private created = false;
  /** Make every transaction fail, as when the phone's storage is full. */
  broken = false;

  open = () => {
    const request = new FakeRequest();
    setTimeout(() => {
      request.result = this.connection();
      if (!this.created) {
        this.created = true;
        request.onupgradeneeded?.();
      }
      request.onsuccess?.();
    }, 0);
    return request;
  };

  rows(name: string) {
    return this.stores.get(name)?.all() ?? [];
  }

  private connection() {
    return {
      objectStoreNames: { contains: (name: string) => this.stores.has(name) },
      createObjectStore: (
        name: string,
        options: { keyPath: string; autoIncrement?: boolean },
      ) =>
        this.stores.set(
          name,
          new FakeStore(options.keyPath, !!options.autoIncrement),
        ),
      close: () => {},
      transaction: () => {
        const tx = new FakeTransaction((name) => this.storeApi(name));
        setTimeout(() => {
          if (this.broken) {
            tx.error = new Error("QuotaExceededError");
            tx.onabort?.();
          } else tx.oncomplete?.();
        }, 0);
        return tx;
      },
    };
  }

  private storeApi(name: string) {
    const store = this.stores.get(name);
    if (!store) throw new Error(`No store ${name}`);
    const done = (result: unknown) => {
      const request = new FakeRequest();
      request.result = result;
      return request;
    };
    const key = (row: Row) => {
      const value = row[store.keyPath];
      if (typeof value !== "number" && typeof value !== "string")
        throw new Error("No key");
      return value;
    };
    return {
      add: (value: Row) => {
        const row = store.keyOf(structuredClone(value));
        if (store.rows.has(key(row))) throw new Error("ConstraintError");
        store.rows.set(key(row), row);
        return done(key(row));
      },
      put: (value: Row) => {
        const row = store.keyOf(structuredClone(value));
        store.rows.set(key(row), row);
        return done(key(row));
      },
      delete: (id: number | string) => done(store.rows.delete(id)),
      clear: () => done(store.rows.clear()),
      getAll: () => done(store.all()),
    };
  }
}

type Listener = (event: unknown) => void;

type Shown = { title: string; options: NotificationOptions };

/** The windows the worker can see, and what it did with them. */
class FakeWindows {
  readonly shown: Shown[] = [];
  /** Messages the worker sent the open pages. */
  readonly told: unknown[] = [];
  /** Background Sync tags the worker registered. */
  readonly syncs: string[] = [];
  readonly opened: string[] = [];
  readonly focused: string[] = [];
  open: { url: string }[] = [];

  windows = () =>
    this.open.map((w) => ({
      get url() {
        return w.url;
      },
      navigate: async (url: string) => {
        w.url = url;
      },
      focus: async () => {
        this.focused.push(w.url);
      },
      postMessage: (message: unknown) => {
        this.told.push(message);
      },
    }));
}

function loadWorker(
  network: FakeNetwork,
  storage: FakeCacheStorage,
  screen: FakeWindows = new FakeWindows(),
  idb: FakeIndexedDB = new FakeIndexedDB(),
) {
  const listeners = new Map<string, Listener>();
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: Listener) =>
      listeners.set(type, listener),
    skipWaiting: async () => {},
    registration: {
      showNotification: async (title: string, options: NotificationOptions) => {
        screen.shown.push({ title, options });
      },
      sync: {
        register: async (tag: string) => {
          screen.syncs.push(tag);
        },
      },
    },
    clients: {
      claim: async () => {},
      matchAll: async () => screen.windows(),
      openWindow: async (url: string) => {
        screen.opened.push(url);
      },
    },
  };
  const source = readFileSync(join(process.cwd(), "public/sw.js"), "utf8");
  const exposed = new Function(
    "self",
    "caches",
    "fetch",
    "indexedDB",
    `${source}\nreturn { routeFor, VERSION, SHELL_CACHE, NEXT_GAME_CACHE, NEXT_GAME_INFO, OUTBOX_DB, SEND_TAG, ENTRIES, OUTCOMES };`,
  )(self, storage, network.fetch, idb) as {
    routeFor: (request: Req) => string;
    VERSION: string;
    SHELL_CACHE: string;
    NEXT_GAME_CACHE: string;
    NEXT_GAME_INFO: string;
    OUTBOX_DB: string;
    SEND_TAG: string;
    ENTRIES: string;
    OUTCOMES: string;
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
    /** A message that expects an answer, as the score screens send. */
    ask: async (data: unknown) => {
      const answers: unknown[] = [];
      await dispatch("message", {
        data,
        ports: [{ postMessage: (answer: unknown) => answers.push(answer) }],
      });
      return answers[0];
    },
    sync: (tag: string) => dispatch("sync", { tag }),
    push: (data: unknown) =>
      dispatch("push", {
        data:
          data === null
            ? null
            : {
                json: () =>
                  typeof data === "string" ? JSON.parse(data) : data,
              },
      }),
    click: (path: unknown, action = "", settingsPath?: unknown) => {
      const closed: boolean[] = [];
      return dispatch("notificationclick", {
        action,
        notification: {
          data: { path, settingsPath },
          close: () => closed.push(true),
        },
      }).then(() => closed.length);
    },
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

describe("service worker: page loads", () => {
  it("checks every page with the server, never the browser's stored copy", async () => {
    network.serve("/seasons/spring-2027/schedule", page("Schedule", []), {
      "Cache-Control": "s-maxage=60, stale-while-revalidate=86340",
    });
    for (const path of ["/seasons/spring-2027/schedule", GAME, "/app"]) {
      await worker.fetch(navigate(path));
      expect(network.fetched(path).at(-1)?.init).toEqual({
        cache: "no-cache",
      });
    }
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

describe("service worker: push notifications", () => {
  let screen: FakeWindows;
  beforeEach(() => {
    screen = new FakeWindows();
    worker = loadWorker(network, storage, screen);
  });

  const pushSettings = "/app/profile#push";

  it("shows a league push with its text, why it came, tag and page", async () => {
    await worker.push({
      title: "Your game is postponed",
      body: "Aces vs Bees (Sun 7 PM) is rained out.",
      reason: "Because you play in this game in Fall 2026.",
      path: "/app/seasons/fall-2026",
      settingsPath: pushSettings,
      tag: "abc123",
    });
    expect(screen.shown).toEqual([
      {
        title: "Your game is postponed",
        options: {
          body: "Aces vs Bees (Sun 7 PM) is rained out.\nBecause you play in this game in Fall 2026.",
          tag: "abc123",
          icon: "/icons/icon-192.png",
          badge: "/icons/icon-192.png",
          silent: false,
          actions: [{ action: "settings", title: "Change alerts" }],
          data: { path: "/app/seasons/fall-2026", settingsPath: pushSettings },
        },
      },
    ]);
  });

  it("shows a push sent in quiet hours without sound", async () => {
    await worker.push({ title: "Rained out", silent: true });
    expect(screen.shown[0]?.options.silent).toBe(true);
  });

  it("still shows something for an empty or unreadable push", async () => {
    await worker.push(null);
    await worker.push("not json");
    expect(screen.shown.map((s) => [s.title, s.options.data])).toEqual([
      ["Kickball league", { path: "/app", settingsPath: pushSettings }],
      ["Kickball league", { path: "/app", settingsPath: pushSettings }],
    ]);
  });

  it("never sends a tap to another site", async () => {
    for (const path of [
      "https://evil.example.test/",
      "//evil.example.test/x",
      "/\\evil.example.test",
      "javascript:alert(1)",
      42,
    ]) {
      await worker.push({ title: "Hi", path });
    }
    expect(screen.shown.map((s) => s.options.data)).toEqual(
      Array.from({ length: 5 }, () => ({
        path: "/app",
        settingsPath: pushSettings,
      })),
    );
  });

  it("opens the page on a tap, or moves an open window there", async () => {
    expect(await worker.click("/app/subs")).toBe(1);
    expect(screen.opened).toEqual([`${ORIGIN}/app/subs`]);

    screen.open = [{ url: `${ORIGIN}/app` }];
    await worker.click("/app/subs");
    expect(screen.open).toEqual([{ url: `${ORIGIN}/app/subs` }]);
    expect(screen.focused).toEqual([`${ORIGIN}/app/subs`]);
    expect(screen.opened).toHaveLength(1);

    await worker.click("https://evil.example.test/");
    expect(screen.open).toEqual([{ url: `${ORIGIN}/app` }]);
  });

  it("opens the push settings from the Change alerts button", async () => {
    await worker.click("/app/subs", "settings", pushSettings);
    expect(screen.opened).toEqual([`${ORIGIN}${pushSettings}`]);
    await worker.click("/app/subs", "settings", "https://evil.example.test/");
    expect(screen.opened.at(-1)).toBe(`${ORIGIN}/app`);
  });
});

describe("service worker: scores saved with no signal", () => {
  const GAME_ID = "0f3c2b9e-1d4a-4c8e-9b7a-2e5f6a7b8c9d";
  const API = `/api/games/${GAME_ID}/offline`;
  let screen: FakeWindows;
  let idb: FakeIndexedDB;

  const entry = (n: number, fields: object = {}) => ({
    kind: "half",
    key: `00000000-0000-4000-8000-00000000000${n}`,
    gameId: GAME_ID,
    userId: "11111111-1111-4111-8111-111111111111",
    enteredAt: "2026-09-14T00:30:00.000Z",
    inning: 1,
    half: n % 2 === 1 ? "top" : "bottom",
    runs: n,
    was: null,
    summary: `Half ${n}`,
    ...fields,
  });

  /** The server's answers, in order; a function answers every request. */
  function answer(...responses: (() => Response)[]) {
    network.pages.set(API, () => {
      const next = responses.length > 1 ? responses.shift() : responses[0];
      if (!next) throw new Error("No answer");
      return next();
    });
  }
  const saved =
    (message = "Saved.") =>
    () =>
      Response.json({ status: "saved", message });

  const sentKeys = () =>
    network.fetched(API).map((c) => {
      const body: unknown = JSON.parse(String(c.init?.body));
      return typeof body === "object" && body !== null && "key" in body
        ? body.key
        : null;
    });
  const waiting = () => idb.rows(worker.ENTRIES);
  const outcomes = () => idb.rows(worker.OUTCOMES);

  beforeEach(() => {
    screen = new FakeWindows();
    screen.open = [{ url: `${ORIGIN}/app/games/${GAME_ID}/score` }];
    idb = new FakeIndexedDB();
    worker = loadWorker(network, storage, screen, idb);
  });

  it("uses the names the score screens use", () => {
    expect(worker.OUTBOX_DB).toBe(OUTBOX_DB);
    expect(worker.SEND_TAG).toBe(SEND_TAG);
  });

  it("saves an entry with no signal and asks Background Sync to send it", async () => {
    network.online = false;
    expect(await worker.ask({ type: "queue-score", entry: entry(1) })).toEqual({
      ok: true,
    });
    expect(waiting()).toEqual([{ ...entry(1), problem: null, seq: 1 }]);
    expect(screen.syncs).toEqual([SEND_TAG]);
    expect(screen.told).toContainEqual({ type: "outbox-changed" });
    expect(await worker.ask({ type: "outbox" })).toEqual({
      entries: [{ ...entry(1), problem: null, seq: 1 }],
      outcomes: [],
    });
  });

  it("sends at once when it can, and keeps the server's answer", async () => {
    answer(saved("Saved 1 run in the top of the 1st."));
    await worker.ask({ type: "queue-score", entry: entry(1) });
    expect(sentKeys()).toEqual([entry(1).key]);
    const sent = network.fetched(API)[0]?.init;
    expect(sent?.method).toBe("POST");
    // The server gets the entry, not the phone's own bookkeeping.
    expect(JSON.parse(String(sent?.body))).not.toHaveProperty("summary");
    expect(waiting()).toEqual([]);
    expect(outcomes()).toEqual([
      {
        key: entry(1).key,
        gameId: GAME_ID,
        kind: "half",
        summary: "Half 1",
        status: "saved",
        message: "Saved 1 run in the top of the 1st.",
      },
    ]);
  });

  it("keeps one copy of an entry handed over twice", async () => {
    network.online = false;
    await worker.ask({ type: "queue-score", entry: entry(1) });
    await worker.ask({ type: "queue-score", entry: entry(1) });
    expect(waiting()).toHaveLength(1);
  });

  it("refuses something that is not an entry", async () => {
    for (const bad of [null, "score", { ...entry(1), key: "abc" }, {}])
      expect(await worker.ask({ type: "queue-score", entry: bad })).toEqual({
        ok: false,
      });
    expect(waiting()).toEqual([]);
  });

  it("says so when the phone can't save it", async () => {
    idb.broken = true;
    network.online = false;
    expect(await worker.ask({ type: "queue-score", entry: entry(1) })).toEqual({
      ok: false,
    });
  });

  it("sends waiting entries in the order they were made when signal returns", async () => {
    network.online = false;
    for (const n of [1, 2, 3])
      await worker.ask({ type: "queue-score", entry: entry(n) });
    network.calls.splice(0);
    network.online = true;
    answer(saved());
    await worker.sync(SEND_TAG);
    expect(sentKeys()).toEqual([1, 2, 3].map((n) => entry(n).key));
    expect(waiting()).toEqual([]);
    expect(outcomes().map((o) => o.key)).toEqual(
      [1, 2, 3].map((n) => entry(n).key),
    );
  });

  it("sends when a page asks, as on iPhones, which have no Background Sync", async () => {
    network.online = false;
    await worker.ask({ type: "queue-score", entry: entry(1) });
    network.online = true;
    answer(saved());
    await worker.message({ type: "send-scores" });
    expect(waiting()).toEqual([]);
  });

  it("stops at the first entry that can't go yet, so order holds", async () => {
    network.online = false;
    for (const n of [1, 2])
      await worker.ask({ type: "queue-score", entry: entry(n) });
    network.calls.splice(0);
    network.online = true;
    answer(() =>
      Response.json(
        { status: "refused", message: "Sign in to send it." },
        { status: 401 },
      ),
    );
    // Rejecting tells the browser to run the sync again later.
    await expect(worker.sync(SEND_TAG)).rejects.toThrow();
    expect(sentKeys()).toEqual([entry(1).key]);
    expect(waiting().map((e) => e.problem)).toEqual([
      "Sign in to send it.",
      null,
    ]);

    answer(() => new Response("Server error", { status: 500 }));
    await expect(worker.sync(SEND_TAG)).rejects.toThrow();
    expect(waiting()).toHaveLength(2);

    answer(saved());
    await worker.sync(SEND_TAG);
    expect(waiting()).toEqual([]);
  });

  it("drops an entry the server can never read, with the reason", async () => {
    network.online = false;
    await worker.ask({ type: "queue-score", entry: entry(1) });
    network.online = true;
    answer(() =>
      Response.json(
        { status: "refused", message: "This entry couldn't be read." },
        { status: 400 },
      ),
    );
    await worker.sync(SEND_TAG);
    expect(waiting()).toEqual([]);
    expect(outcomes()[0]).toMatchObject({
      status: "refused",
      message: "This entry couldn't be read.",
    });
  });

  it("ignores other sync tags", async () => {
    network.online = false;
    await worker.ask({ type: "queue-score", entry: entry(1) });
    network.online = true;
    await worker.sync("something-else");
    expect(waiting()).toHaveLength(1);
  });

  it("forgets an answer once it has been read", async () => {
    answer(saved());
    await worker.ask({ type: "queue-score", entry: entry(1) });
    await worker.message({ type: "dismiss-outcome", key: entry(1).key });
    expect(outcomes()).toEqual([]);
  });

  it("drops everything on sign-out: the entries are that person's", async () => {
    network.online = false;
    await worker.ask({ type: "queue-score", entry: entry(1) });
    await worker.message({ type: "forget" });
    expect(waiting()).toEqual([]);
    expect(outcomes()).toEqual([]);
  });
});
