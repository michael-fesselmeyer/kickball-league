import { describe, expect, it } from "vitest";
import {
  canSaveOffline,
  dismissOutcome,
  newKey,
  type OutboxWorker,
  type QueuedEntry,
  readOutbox,
  RETRY_FIRST_MS,
  RETRY_MAX_MS,
  retryDelay,
  saveOffline,
  SEND_TAG,
  sendWaiting,
} from "./score-outbox";

const entry: QueuedEntry = {
  kind: "half",
  key: "00000000-0000-4000-8000-000000000001",
  gameId: "00000000-0000-4000-8000-000000000002",
  userId: "00000000-0000-4000-8000-000000000003",
  enteredAt: "2026-09-14T01:30:00.000Z",
  inning: 1,
  half: "top",
  runs: 2,
  was: null,
  summary: "Top of the 1st: 2 runs",
};

/** A worker that answers each question with `reply`, over the port it was given. */
function fakeWorker(reply: (message: unknown) => unknown) {
  const sent: unknown[] = [];
  const syncs: string[] = [];
  const container: OutboxWorker = {
    controller: {
      postMessage: (message, transfer) => {
        sent.push(message);
        const port = transfer[0];
        if (port instanceof MessagePort) {
          const answer = reply(message);
          if (answer !== undefined) port.postMessage(answer);
          port.close();
        }
      },
    },
    ready: Promise.resolve({
      active: null,
      sync: {
        register: async (tag: string) => {
          syncs.push(tag);
        },
      },
    }),
  };
  return { container, sent, syncs };
}

describe("the score screens' outbox", () => {
  it("can save offline only once the service worker runs the page", () => {
    expect(canSaveOffline(undefined)).toBe(false);
    expect(
      canSaveOffline({
        controller: null,
        ready: Promise.resolve({ active: null }),
      }),
    ).toBe(false);
    expect(canSaveOffline(fakeWorker(() => null).container)).toBe(true);
  });

  it("hands an entry to the worker and registers Background Sync", async () => {
    const worker = fakeWorker(() => ({ ok: true }));
    expect(await saveOffline(entry, worker.container)).toBe(true);
    expect(worker.sent).toEqual([{ type: "queue-score", entry }]);
    expect(worker.syncs).toEqual([SEND_TAG]);
  });

  it("works where the browser has no Background Sync", async () => {
    const worker = fakeWorker(() => ({ ok: true }));
    expect(
      await saveOffline(entry, {
        ...worker.container,
        ready: Promise.resolve({ active: null }),
      }),
    ).toBe(true);
  });

  it("says when the worker couldn't save it", async () => {
    expect(
      await saveOffline(entry, fakeWorker(() => ({ ok: false })).container),
    ).toBe(false);
    expect(await saveOffline(entry, undefined)).toBe(false);
  });

  it("gives up on a worker that never answers", async () => {
    const silent = fakeWorker(() => undefined);
    const answer = readOutbox(silent.container);
    expect(await answer).toEqual({ entries: [], outcomes: [] });
  }, 10_000);

  it("reads the outbox, keeping only what it understands", async () => {
    const outcome = {
      key: entry.key,
      gameId: entry.gameId,
      kind: "half",
      summary: entry.summary,
      status: "kept",
      message: "Someone else saved 3 runs there first.",
    };
    const worker = fakeWorker(() => ({
      entries: [{ ...entry, seq: 1, problem: null }, { key: 1 }],
      outcomes: [outcome, { ...outcome, status: "lost" }],
    }));
    expect(await readOutbox(worker.container)).toEqual({
      entries: [{ ...entry, seq: 1, problem: null }],
      outcomes: [outcome],
    });
    expect(await readOutbox(fakeWorker(() => "nonsense").container)).toEqual({
      entries: [],
      outcomes: [],
    });
  });

  it("asks the worker to send, and to forget an answer once read", () => {
    const worker = fakeWorker(() => undefined);
    sendWaiting(worker.container);
    dismissOutcome(entry.key, worker.container);
    expect(worker.sent).toEqual([
      { type: "send-scores" },
      { type: "dismiss-outcome", key: entry.key },
    ]);
  });

  it("waits longer between tries to send, up to a cap", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(retryDelay)).toEqual([
      2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000,
    ]);
    expect(retryDelay(-1)).toBe(RETRY_FIRST_MS);
    expect(retryDelay(1_000)).toBe(RETRY_MAX_MS);
  });

  it("makes a new random key each time", () => {
    const a = newKey();
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(newKey()).not.toBe(a);
  });
});
