/**
 * Names shared with the service worker (public/sw.js), which cannot import
 * them; src/lib/pwa/service-worker.test.ts checks that the two agree.
 */
export const NEXT_GAME_CACHE = "kb-next-game-v1";
export const NEXT_GAME_INFO = "/offline/next-game.json";

export type SavedGame = { path: string; label: string };

const isSavedGame = (value: unknown): value is SavedGame =>
  typeof value === "object" &&
  value !== null &&
  "path" in value &&
  "label" in value &&
  typeof value.path === "string" &&
  value.path.startsWith("/games/") &&
  typeof value.label === "string";

/** The part of Cache Storage the offline page reads. */
type CacheReader = {
  open: (name: string) => Promise<{
    match: (url: string) => Promise<Response | undefined>;
  }>;
};

/**
 * The game saved on this device for offline use, read straight from the
 * cache the service worker writes. Null when nothing is saved or the
 * browser has no Cache Storage.
 */
export async function savedGame(
  storage: CacheReader | undefined = globalThis.caches,
): Promise<SavedGame | null> {
  if (!storage) return null;
  try {
    const cache = await storage.open(NEXT_GAME_CACHE);
    const info = await cache.match(NEXT_GAME_INFO);
    if (!info) return null;
    const value: unknown = await info.json();
    return isSavedGame(value) ? value : null;
  } catch {
    return null;
  }
}

/** Messages the pages send the service worker. */
export type WorkerMessage =
  | { type: "next-game"; path: string | null; label: string }
  | { type: "forget" };

/** The part of navigator.serviceWorker the pages use. */
type WorkerContainer = {
  ready: Promise<{
    active: { postMessage: (message: WorkerMessage) => void } | null;
  }>;
};

/** Sends a message to the active service worker, if there is one. */
export function tellWorker(
  message: WorkerMessage,
  container: WorkerContainer | undefined = globalThis.navigator?.serviceWorker,
): Promise<void> {
  if (!container) return Promise.resolve();
  return container.ready.then((registration) => {
    registration.active?.postMessage(message);
  });
}
