import type { OfflineEntry, OfflineResult } from "@/domain/scores/offline";

/**
 * The score screens' side of the outbox the service worker keeps for score
 * entries made with no signal (public/sw.js; ADR 0025). The worker owns the
 * saved entries and sends them; a page hands it new ones, asks what is
 * waiting, and asks it to send when the signal is back. Names shared with
 * the worker are checked by src/lib/pwa/service-worker.test.ts.
 */
export const OUTBOX_DB = "kb-outbox";
export const SEND_TAG = "kb-send-scores";

/** An entry with the line the score screen shows for it while it waits. */
export type QueuedEntry = OfflineEntry & { summary: string };

/** An entry waiting on this phone, and why the last try failed, if it did. */
export type WaitingEntry = QueuedEntry & { problem: string | null };

/** What the server did with an entry, kept until the person dismisses it. */
export type Outcome = OfflineResult & {
  key: string;
  gameId: string;
  kind: OfflineEntry["kind"];
  summary: string;
};

export type Outbox = { entries: WaitingEntry[]; outcomes: Outcome[] };

/** The part of navigator.serviceWorker the score screens use. */
export type OutboxWorker = {
  controller: {
    postMessage: (message: unknown, transfer: Transferable[]) => void;
  } | null;
  ready: Promise<{
    active: unknown;
    /** Background Sync, where the browser has it. */
    sync?: { register: (tag: string) => Promise<void> };
  }>;
};

const worker = (): OutboxWorker | undefined =>
  globalThis.navigator?.serviceWorker ?? undefined;

/**
 * Whether entries can be saved on this phone: only once the service worker
 * runs the page, which it does from the second visit after installing.
 */
export const canSaveOffline = (container = worker()): boolean =>
  !!container?.controller;

/** Sends a message to the worker running this page and waits for its answer. */
function ask(
  message: unknown,
  container: OutboxWorker | undefined,
  timeoutMs = 5000,
): Promise<unknown> {
  const controller = container?.controller;
  if (!controller) return Promise.resolve(null);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const done = (value: unknown) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(value);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    channel.port1.onmessage = (event) => done(event.data);
    controller.postMessage(message, [channel.port2]);
  });
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const STATUSES: readonly string[] = ["saved", "unchanged", "kept", "refused"];
const KINDS: readonly string[] = ["score", "half", "end"];

const isWaiting = (value: unknown): value is WaitingEntry =>
  isObject(value) &&
  typeof value.key === "string" &&
  typeof value.gameId === "string" &&
  typeof value.kind === "string" &&
  KINDS.includes(value.kind) &&
  typeof value.summary === "string";

const isOutcome = (value: unknown): value is Outcome =>
  isObject(value) &&
  typeof value.key === "string" &&
  typeof value.gameId === "string" &&
  typeof value.summary === "string" &&
  typeof value.status === "string" &&
  STATUSES.includes(value.status) &&
  typeof value.message === "string";

/**
 * Hands an entry to the worker, which saves it and tries to send it at
 * once. True once it is saved on the phone.
 */
export async function saveOffline(
  entry: QueuedEntry,
  container = worker(),
): Promise<boolean> {
  const answer = await ask({ type: "queue-score", entry }, container);
  if (!isObject(answer) || answer.ok !== true) return false;
  // Where the browser has Background Sync, it sends when signal returns
  // even if the app is closed by then.
  await container?.ready
    .then((registration) => registration.sync?.register(SEND_TAG))
    .catch(() => undefined);
  return true;
}

/** The entries waiting on this phone and the answers not yet dismissed. */
export async function readOutbox(container = worker()): Promise<Outbox> {
  const answer = await ask({ type: "outbox" }, container);
  if (!isObject(answer)) return { entries: [], outcomes: [] };
  const entries = Array.isArray(answer.entries) ? answer.entries : [];
  const outcomes = Array.isArray(answer.outcomes) ? answer.outcomes : [];
  return {
    entries: entries.filter(isWaiting).map((e) => ({
      ...e,
      problem: typeof e.problem === "string" ? e.problem : null,
    })),
    outcomes: outcomes.filter(isOutcome),
  };
}

/** Asks the worker to send what is waiting, as when the signal comes back. */
export function sendWaiting(container = worker()): void {
  container?.controller?.postMessage({ type: "send-scores" }, []);
}

/** Forgets an answer once the person has read it. */
export function dismissOutcome(key: string, container = worker()): void {
  container?.controller?.postMessage({ type: "dismiss-outcome", key }, []);
}

/** A key for a new entry: random, so two phones never make the same one. */
export const newKey = (): string => crypto.randomUUID();
