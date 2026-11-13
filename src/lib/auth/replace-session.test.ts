import { describe, expect, it } from "vitest";
import { endReplacedSession, type SessionStore } from "./replace-session";

function store(sessions: Record<string, string>) {
  const removed: string[] = [];
  const s: SessionStore = {
    find: async (token) =>
      token in sessions ? { userId: sessions[token]! } : null,
    remove: async (token) => {
      removed.push(token);
    },
  };
  return { s, removed };
}

const created = { token: "new", userId: "me" };

describe("endReplacedSession", () => {
  it("ends this browser's earlier session on the same account", async () => {
    const { s, removed } = store({ old: "me", new: "me" });
    expect(await endReplacedSession(created, "old", s)).toBe(true);
    expect(removed).toEqual(["old"]);
  });

  it("keeps another account's session (switching accounts)", async () => {
    const { s, removed } = store({ old: "someone-else" });
    expect(await endReplacedSession(created, "old", s)).toBe(false);
    expect(removed).toEqual([]);
  });

  it("does nothing on a first sign-in, an unknown token or the new token", async () => {
    const { s, removed } = store({ new: "me" });
    expect(await endReplacedSession(created, null, s)).toBe(false);
    expect(await endReplacedSession(created, "gone", s)).toBe(false);
    expect(await endReplacedSession(created, "new", s)).toBe(false);
    expect(removed).toEqual([]);
  });
});
