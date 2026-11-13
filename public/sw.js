/**
 * The league's service worker (docs/architecture.md, section 14). Hand-written
 * and small on purpose. It keeps exactly two things on the device:
 *
 * 1. The app shell: the offline page, the manifest and icons, and the
 *    versioned scripts, styles and fonts those pages load.
 * 2. One public game page: the signed-in person's next game, which their
 *    home screen names. It is fetched without cookies, so the saved copy is
 *    the page anyone would see.
 *
 * Everything else goes to the network untouched: signed-in screens
 * (payments, waivers, admin), API routes, Server Actions and the client
 * router's data requests are never cached, so nothing stale or personal is
 * ever served from here. With no signal, a page that is not saved gets the
 * offline page instead. The rules are tested in
 * src/lib/pwa/service-worker.test.ts.
 *
 * It also shows the league's push notifications (rain-outs, sub requests,
 * scores) and opens the right page when one is tapped.
 */

// Bump to drop every cache from an older worker when it activates.
const VERSION = "v1";
const SHELL_CACHE = `kb-shell-${VERSION}`;
// The offline page reads this cache by name (src/lib/pwa/offline-cache.ts).
const NEXT_GAME_CACHE = `kb-next-game-${VERSION}`;
const NEXT_GAME_INFO = "/offline/next-game.json";
const OFFLINE_PAGE = "/offline";
const SHELL_FILES = [
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
  "/icons/apple-touch-icon.png",
];
const GAME_PAGE = /^\/games\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const STATIC_ASSET = /\/_next\/static\/[^"'\s)<>\\]+/g;

/**
 * How a request is handled:
 * - "network": not intercepted at all.
 * - "asset": a versioned file; served from the shell cache when saved.
 * - "shell": a shell file; served from the shell cache when saved.
 * - "page": a page; from the network, and when that fails, the saved copy
 *   of the next game or the offline page.
 */
function routeFor(request) {
  if (request.method !== "GET") return "network";
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return "network";
  if (url.pathname.startsWith("/api/")) return "network";
  // The client router's data requests: Next.js retries them itself.
  if (request.headers.has("RSC") || url.searchParams.has("_rsc"))
    return "network";
  if (url.pathname.startsWith("/_next/static/")) return "asset";
  if (SHELL_FILES.includes(url.pathname)) return "shell";
  if (request.mode === "navigate") return "page";
  return "network";
}

self.addEventListener("install", (event) => {
  event.waitUntil(refreshShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = [SHELL_CACHE, NEXT_GAME_CACHE];
      for (const name of await caches.keys())
        if (name.startsWith("kb-") && !keep.includes(name))
          await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const route = routeFor(event.request);
  if (route === "asset" || route === "shell")
    event.respondWith(fromCacheFirst(event.request));
  else if (route === "page") event.respondWith(page(event));
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;
  if (data.type === "next-game") {
    const path = typeof data.path === "string" ? data.path : null;
    const label = typeof data.label === "string" ? data.label : "";
    // Only a public game page may be saved, whatever a page asks for.
    if (path !== null && !GAME_PAGE.test(path)) return;
    event.waitUntil(saveForOffline(path, label));
  } else if (data.type === "forget") {
    event.waitUntil(caches.delete(NEXT_GAME_CACHE));
  }
});

/**
 * A league push (src/services/push.ts): shows it as a notification. The tag
 * is the message id, so a repeat of the same message replaces the first.
 * A push that cannot be read still shows something, because a push the
 * person was promised must always be visible.
 */
self.addEventListener("push", (event) => {
  const message = readPush(event.data);
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      tag: message.tag,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { path: message.path },
    }),
  );
});

/** The notification's text and where a tap goes, from a push's JSON. */
function readPush(data) {
  let raw = null;
  try {
    raw = data ? data.json() : null;
  } catch {
    raw = null;
  }
  const text = (value, max) =>
    typeof value === "string" && value.trim() !== ""
      ? value.slice(0, max)
      : null;
  return {
    title: text(raw?.title, 120) ?? "Kickball league",
    body: text(raw?.body, 300) ?? "",
    tag: text(raw?.tag, 64) ?? undefined,
    path: safePath(raw?.path),
  };
}

/** Only a path on this site; anything else opens the home screen. */
function safePath(path) {
  return typeof path === "string" &&
    path.startsWith("/") &&
    !path.startsWith("//") &&
    !path.includes("\\")
    ? path
    : "/app";
}

/** A tap opens the notification's page, reusing an open window when there is one. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = safePath(event.notification.data?.path);
  event.waitUntil(
    (async () => {
      const url = new URL(path, self.location.origin).href;
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const open = windows.find((w) => w.url === url) ?? windows[0];
      if (open) {
        if (open.url !== url && "navigate" in open) await open.navigate(url);
        return open.focus();
      }
      return self.clients.openWindow(url);
    })(),
  );
});

async function fromCacheFirst(request) {
  const saved = await caches.match(request, { cacheName: SHELL_CACHE });
  return saved ?? fetch(request);
}

async function page(event) {
  const path = new URL(event.request.url).pathname;
  try {
    const response = await fetch(event.request);
    if (GAME_PAGE.test(path) && response.ok && !response.redirected)
      // Keep the saved next game fresh whenever it is opened online.
      event.waitUntil(refreshSavedGame(path, response.clone()));
    return response;
  } catch {
    const saved = await caches.match(path, { cacheName: NEXT_GAME_CACHE });
    if (saved) return withOfflineNote(saved);
    const offline = await caches.match(OFFLINE_PAGE, {
      cacheName: SHELL_CACHE,
    });
    return (
      offline ??
      new Response("You're offline.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      })
    );
  }
}

/** Replaces the saved copy only when this game is the one being kept. */
async function refreshSavedGame(path, response) {
  if (!(await caches.match(path, { cacheName: NEXT_GAME_CACHE }))) return;
  const games = await caches.open(NEXT_GAME_CACHE);
  const html = await response.text();
  await games.put(path, stamped(html, response));
  await saveAssets(await caches.open(SHELL_CACHE), assetsIn(html));
}

/**
 * A saved copy of a page, stamped with the time it was saved. Only the
 * content type is kept from the original headers: the body is already
 * decoded, and no cookie is ever stored.
 */
function stamped(html, response) {
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type":
        response.headers.get("Content-Type") ?? "text/html; charset=utf-8",
      "X-Saved-At": new Date().toISOString(),
    },
  });
}

/**
 * Serves a saved game page with a note at the top of the body saying it is
 * a saved copy. React leaves unexpected nodes at the start of <body> alone
 * when it hydrates.
 */
async function withOfflineNote(saved) {
  const html = await saved.text();
  const at = saved.headers.get("X-Saved-At");
  const when = at
    ? new Date(at).toLocaleString("en-US", {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;
  const note =
    '<p role="status" style="margin:0;padding:.5rem 1rem;text-align:center;font-weight:700;background:var(--highlight);color:var(--on-highlight)">' +
    `You're offline. This is the copy saved ${when ? `on ${when}` : "earlier"}; scores and times may have changed.</p>`;
  const body = html.replace(/<body[^>]*>/, (tag) => tag + note);
  return new Response(body, { status: 200, headers: saved.headers });
}

/** Static files a page loads, from its HTML. */
function assetsIn(html) {
  return [...new Set(html.match(STATIC_ASSET) ?? [])];
}

/** A successful, unredirected response for a same-origin path, or null. */
async function get(path, init) {
  try {
    const response = await fetch(path, { cache: "no-store", ...init });
    if (!response.ok || response.redirected) return null;
    return response;
  } catch {
    return null;
  }
}

/**
 * Saves the offline page, the shell files and every versioned file they and
 * the saved game page need, then drops versioned files that no saved page
 * uses any more. Runs when the worker installs and on each visit to the home
 * screen, so the shell follows each deploy. Offline, it changes nothing.
 */
async function refreshShell() {
  const shell = await caches.open(SHELL_CACHE);
  const offline = await get(OFFLINE_PAGE, { credentials: "omit" });
  if (!offline) return;
  const wanted = new Set(assetsIn(await offline.clone().text()));
  await shell.put(OFFLINE_PAGE, offline);
  for (const file of SHELL_FILES) {
    const response = await get(file);
    if (response) await shell.put(file, response);
  }
  if (await caches.has(NEXT_GAME_CACHE)) {
    const games = await caches.open(NEXT_GAME_CACHE);
    for (const request of await games.keys()) {
      const saved = await games.match(request);
      if (saved && GAME_PAGE.test(new URL(request.url).pathname))
        for (const asset of assetsIn(await saved.text())) wanted.add(asset);
    }
  }
  await saveAssets(shell, wanted);
  for (const request of await shell.keys()) {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/_next/static/") && !wanted.has(path))
      await shell.delete(request);
  }
}

async function saveAssets(shell, paths) {
  for (const path of paths) {
    if (await shell.match(path)) continue;
    const response = await get(path);
    if (response) await shell.put(path, response);
  }
}

/**
 * Keeps one game for offline use, replacing any other, then refreshes the
 * shell around it. A null path forgets the saved game (no upcoming game).
 * Offline, the saved game stays as it is.
 */
async function saveForOffline(path, label) {
  if (path === null) {
    await caches.delete(NEXT_GAME_CACHE);
  } else {
    // Without cookies: the saved copy is the public page, nothing personal.
    const response = await get(path, { credentials: "omit" });
    if (response) {
      const games = await caches.open(NEXT_GAME_CACHE);
      const html = await response.text();
      for (const request of await games.keys()) await games.delete(request);
      await games.put(path, stamped(html, response));
      await games.put(
        NEXT_GAME_INFO,
        new Response(JSON.stringify({ path, label }), {
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
  }
  await refreshShell();
}
