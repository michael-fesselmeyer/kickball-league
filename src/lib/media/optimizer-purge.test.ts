import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/queries/schedule";

const ids = vi.hoisted(() => ({
  instagram: [] as string[],
  member: [] as string[],
  merch: [] as string[],
}));
vi.mock("@/db/queries/social", () => ({
  shownImageIds: async () => [...ids.instagram],
}));
vi.mock("@/db/queries/member-photos", () => ({
  approvedPhotoIds: async () => [...ids.member],
}));
vi.mock("@/db/queries/merch", () => ({
  shopImageIds: async () => [...ids.merch],
}));
const host = vi.hoisted(() => ({
  dangerouslyDeleteByTag: vi.fn(async () => {}),
  dangerouslyDeleteBySrcImage: vi.fn(async () => {}),
}));
vi.mock("@vercel/functions", () => host);

const {
  changedSrcs,
  hostPurger,
  publicPhotoSrcs,
  purgePhotoCopies,
  purgingPhotoChanges,
} = await import("./optimizer-purge");

const db = {} as Db;

function fakePurger() {
  const calls: string[] = [];
  return {
    calls,
    purger: {
      byTag: async (tags: string[]) => {
        calls.push(`tag ${tags.join(" ")}`);
      },
      bySrcImage: async (srcs: string[]) => {
        calls.push(`src ${srcs.join(" ")}`);
      },
    },
  };
}

beforeEach(() => {
  ids.instagram = [];
  ids.member = [];
  ids.merch = [];
  vi.clearAllMocks();
});

describe("hostPurger", () => {
  it("purges through the host only on Vercel", async () => {
    expect(hostPurger({})).toBeNull();
    const purger = hostPurger({ VERCEL: "1" });
    await purger?.byTag(["/media/photos/a"]);
    await purger?.bySrcImage(["/media/photos/a"]);
    // Deleted at once, never served stale once more.
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

describe("purgePhotoCopies", () => {
  it("clears the address's CDN copy before the optimizer's copies", async () => {
    const { calls, purger } = fakePurger();
    await purgePhotoCopies(["/media/merch/b", "/media/merch/a"], purger);
    expect(calls).toEqual([
      "tag /media/merch/a /media/merch/b",
      "src /media/merch/a /media/merch/b",
    ]);
  });

  it("sends each address once, in batches the host accepts", async () => {
    const { calls, purger } = fakePurger();
    const srcs = Array.from(
      { length: 20 },
      (_, i) => `/media/photos/${String(i).padStart(2, "0")}`,
    );
    await purgePhotoCopies([...srcs, srcs[0]!], purger);
    expect(calls.map((c) => c.split(" ").length - 1)).toEqual([16, 16, 4, 4]);
  });

  it("does nothing without addresses or off Vercel", async () => {
    const { calls, purger } = fakePurger();
    await purgePhotoCopies([], purger);
    await purgePhotoCopies(["/media/photos/a"], null);
    expect(calls).toEqual([]);
  });

  it("tries a refused purge once more", async () => {
    const { calls, purger } = fakePurger();
    let refusals = 1;
    await purgePhotoCopies(
      ["/media/photos/a"],
      {
        ...purger,
        byTag: async (tags) => {
          if (refusals-- > 0) throw new Error("429 Too Many Requests");
          await purger.byTag(tags);
        },
      },
      0,
    );
    expect(calls).toEqual(["tag /media/photos/a", "src /media/photos/a"]);
  });

  it("logs a purge refused twice instead of failing the takedown", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      purgePhotoCopies(
        ["/media/photos/a"],
        {
          byTag: async () => {
            throw new Error("429 Too Many Requests");
          },
          bySrcImage: async () => {},
        },
        0,
      ),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      "photo cache purge failed",
      "/media/photos/a",
      { code: null, message: "429 Too Many Requests" },
    );
    error.mockRestore();
  });
});

describe("publicPhotoSrcs", () => {
  it("gives the addresses of every public photo of each kind", async () => {
    ids.instagram = ["i1"];
    ids.member = ["m1", "m2"];
    ids.merch = ["s1"];
    expect(await publicPhotoSrcs(db)).toEqual(
      new Set([
        "/media/instagram/i1",
        "/media/photos/m1",
        "/media/photos/m2",
        "/media/merch/s1",
      ]),
    );
  });
});

describe("changedSrcs", () => {
  it("names photos taken down and photos shown again", () => {
    expect(
      changedSrcs(new Set(["a", "b", "c"]), new Set(["b", "c", "d"])),
    ).toEqual(["a", "d"]);
    expect(changedSrcs(new Set(["a"]), new Set(["a"]))).toEqual([]);
  });
});

describe("purgingPhotoChanges", () => {
  it("purges the photos the change took down and returns its result", async () => {
    ids.member = ["m1", "m2"];
    const { calls, purger } = fakePurger();
    const result = await purgingPhotoChanges(
      db,
      async () => {
        ids.member = ["m2"];
        return "taken down";
      },
      purger,
    );
    expect(result).toBe("taken down");
    expect(calls).toEqual(["tag /media/photos/m1", "src /media/photos/m1"]);
  });

  it("purges nothing when no photo changed", async () => {
    ids.merch = ["s1"];
    const { calls, purger } = fakePurger();
    await purgingPhotoChanges(db, async () => 1, purger);
    expect(calls).toEqual([]);
  });

  it("only runs the change off Vercel, reading nothing", async () => {
    const change = vi.fn(async () => "done");
    expect(await purgingPhotoChanges(db, change, null)).toBe("done");
    expect(change).toHaveBeenCalledOnce();
  });

  it("purges nothing when the change fails", async () => {
    const { calls, purger } = fakePurger();
    await expect(
      purgingPhotoChanges(
        db,
        async () => {
          throw new Error("rolled back");
        },
        purger,
      ),
    ).rejects.toThrow("rolled back");
    expect(calls).toEqual([]);
  });
});
