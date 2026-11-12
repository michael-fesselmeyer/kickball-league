import { describe, expect, it } from "vitest";
import {
  NEXT_GAME_CACHE,
  NEXT_GAME_INFO,
  savedGame,
  tellWorker,
  type WorkerMessage,
} from "./offline-cache";

/** Cache Storage holding one response at NEXT_GAME_INFO, or nothing. */
const storageWith = (info?: Response) => ({
  open: async (name: string) => ({
    match: async (url: string) =>
      name === NEXT_GAME_CACHE && url === NEXT_GAME_INFO ? info : undefined,
  }),
});

describe("savedGame", () => {
  it("reads the game the service worker saved", async () => {
    const info = Response.json({ path: "/games/g1", label: "A vs B" });
    expect(await savedGame(storageWith(info))).toEqual({
      path: "/games/g1",
      label: "A vs B",
    });
  });

  it("is null when nothing usable is saved", async () => {
    expect(await savedGame(undefined)).toBeNull();
    expect(await savedGame(storageWith())).toBeNull();
    expect(
      await savedGame(storageWith(Response.json({ path: "/app", label: "" }))),
    ).toBeNull();
    expect(await savedGame(storageWith(new Response("{")))).toBeNull();
    expect(
      await savedGame({
        open: () => Promise.reject(new Error("SecurityError")),
      }),
    ).toBeNull();
  });
});

describe("tellWorker", () => {
  it("posts to the active worker once it is ready", async () => {
    const posted: WorkerMessage[] = [];
    const container = {
      ready: Promise.resolve({
        active: { postMessage: (m: WorkerMessage) => posted.push(m) },
      }),
    };
    await tellWorker({ type: "forget" }, container);
    expect(posted).toEqual([{ type: "forget" }]);
    await tellWorker(
      { type: "forget" },
      { ready: Promise.resolve({ active: null }) },
    );
    expect(posted).toHaveLength(1);
  });

  it("does nothing where browsers have no service workers", async () => {
    await expect(
      tellWorker({ type: "forget" }, undefined),
    ).resolves.toBeUndefined();
  });
});
