import { beforeEach, describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({
  dangerouslyDeleteByTag: vi.fn(async () => {}),
  dangerouslyDeleteBySrcImage: vi.fn(async () => {}),
}));
vi.mock("@vercel/functions", () => host);

const { hostPurger } = await import("./host-purger");

beforeEach(() => vi.clearAllMocks());

describe("hostPurger", () => {
  it("purges through the host only on Vercel", () => {
    expect(hostPurger({})).toBeNull();
    expect(hostPurger({ VERCEL: "0" })).toBeNull();
    expect(hostPurger({ VERCEL: "1" })).not.toBeNull();
  });

  it("deletes the CDN copy and the optimized copies at once, never serving them stale", async () => {
    const purger = hostPurger({ VERCEL: "1" });
    await purger?.byTag(["/media/photos/a"]);
    await purger?.bySrcImage(["/media/photos/a"]);
    expect(host.dangerouslyDeleteByTag).toHaveBeenCalledWith(
      ["/media/photos/a"],
      { revalidationDeadlineSeconds: 0 },
    );
    expect(host.dangerouslyDeleteBySrcImage).toHaveBeenCalledWith(
      ["/media/photos/a"],
      { revalidationDeadlineSeconds: 0 },
    );
  });
});
