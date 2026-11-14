import { beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => vi.fn<() => Promise<void>>());
vi.mock("next/cache", () => ({ io }));

const { queriesWaitForRequest, waitForRequest } =
  await import("./wait-for-request");

/** A stand-in for a driver: a pool with `query` and another method. */
class FakePool {
  sent: string[] = [];
  async query(text: string): Promise<{ rows: string[] }> {
    this.sent.push(text);
    return { rows: [text] };
  }
  async connect(): Promise<string> {
    return `connected after ${this.sent.length}`;
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("queriesWaitForRequest", () => {
  beforeEach(() => {
    io.mockReset();
  });

  it("sends a query once the request is real", async () => {
    io.mockResolvedValue();
    const pool = new FakePool();
    const gated = queriesWaitForRequest(pool);

    await expect(gated.query("select 1")).resolves.toEqual({
      rows: ["select 1"],
    });
    expect(pool.sent).toEqual(["select 1"]);
  });

  it("never sends a query while a prerender has stopped at io()", async () => {
    // In a prerender, io() returns a promise that never settles.
    io.mockReturnValue(new Promise<void>(() => {}));
    const pool = new FakePool();
    const gated = queriesWaitForRequest(pool);

    let answered = false;
    void gated.query("select 1").then(() => (answered = true));
    await tick();

    expect(pool.sent).toEqual([]);
    expect(answered).toBe(false);
  });

  it("never sends a query once the prerender ends either", async () => {
    // When a prerender ends, io()'s promise rejects.
    io.mockRejectedValue(new Error("prerender ended"));
    const pool = new FakePool();
    const gated = queriesWaitForRequest(pool);

    await expect(gated.query("select 1")).rejects.toThrow("prerender ended");
    expect(pool.sent).toEqual([]);
  });

  it("leaves every other property alone and keeps the client's type", async () => {
    io.mockReturnValue(new Promise<void>(() => {}));
    const pool = new FakePool();
    const gated = queriesWaitForRequest(pool);

    await expect(gated.connect()).resolves.toBe("connected after 0");
    expect(gated).toBeInstanceOf(FakePool);
    expect(gated.sent).toBe(pool.sent);
  });

  it("keeps a function client callable and holds its query", async () => {
    io.mockResolvedValue();
    const sent: string[] = [];
    const sql = Object.assign(() => "template", {
      query: async (text: string) => {
        sent.push(text);
        return text;
      },
    });
    const gated = queriesWaitForRequest(sql);

    expect(gated()).toBe("template");
    await expect(gated.query("select 2")).resolves.toBe("select 2");
    expect(sent).toEqual(["select 2"]);
  });
});

describe("waitForRequest", () => {
  beforeEach(() => {
    io.mockReset();
  });

  it("goes ahead where io() refuses, as inside a page's after()", async () => {
    io.mockImplementation(() => {
      throw new Error("io() inside after()");
    });
    await expect(waitForRequest()).resolves.toBeUndefined();
  });
});
