import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/queries/schedule";
import type { LeagueId } from "@/domain/ids";

const ids = vi.hoisted(() => ({
  instagram: [] as string[],
  member: [] as string[],
  merch: [] as string[],
}));
const purges = vi.hoisted(() => ({
  due: [] as { src: string; leagueId: string }[],
  failed: [] as { src: string; leagueId: string }[][],
  retried: [] as { src: string; leagueId: string }[][],
  maxAge: 0,
}));
// Every photo in these tests belongs to the league "L".
const inL = (id: string) => ({ id, leagueId: "L" });
vi.mock("@/db/queries/social", () => ({
  shownImageIds: async () => ids.instagram.map(inL),
}));
vi.mock("@/db/queries/member-photos", () => ({
  approvedPhotoIds: async () => ids.member.map(inL),
}));
vi.mock("@/db/queries/merch", () => ({
  shopImageIds: async () => ids.merch.map(inL),
}));
vi.mock("@/db/queries/photo-purges", () => ({
  duePurges: async (_db: unknown, _now: Date, maxAge: number) => {
    purges.maxAge = maxAge;
    return purges.due;
  },
  recordFailedPurges: async (_db: unknown, list: never[]) => {
    purges.failed.push(list);
  },
  recordRetriedPurges: async (_db: unknown, list: never[]) => {
    purges.retried.push(list);
  },
}));
const {
  changedSrcs,
  publicPhotoSrcs,
  purgePhotoCopies,
  purgingPhotoChanges,
  retryFailedPurges,
} = await import("./optimizer-purge");
const { LONG_PHOTO_LIFETIME } = await import("./optimizer-cache");

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

/** A purger the host refuses for these addresses, as when over its limit. */
function refusingPurger(refused: string[]) {
  const { calls, purger } = fakePurger();
  const check = (srcs: string[]) => {
    if (srcs.some((s) => refused.includes(s)))
      throw new Error("429 Too Many Requests");
  };
  return {
    calls,
    purger: {
      byTag: async (tags: string[]) => {
        check(tags);
        await purger.byTag(tags);
      },
      bySrcImage: purger.bySrcImage,
    },
  };
}

beforeEach(() => {
  ids.instagram = [];
  ids.member = [];
  ids.merch = [];
  purges.due = [];
  purges.failed = [];
  purges.retried = [];
  vi.clearAllMocks();
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

  it("logs and returns a purge refused twice instead of failing the takedown", async () => {
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
    ).resolves.toEqual(["/media/photos/a"]);
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
      new Map([
        ["/media/instagram/i1", "L"],
        ["/media/photos/m1", "L"],
        ["/media/photos/m2", "L"],
        ["/media/merch/s1", "L"],
      ]),
    );
  });
});

describe("changedSrcs", () => {
  it("names photos taken down and photos shown again, with their league", () => {
    const of = (...srcs: string[]) =>
      new Map(srcs.map((s) => [s, `league ${s}` as LeagueId] as const));
    expect(changedSrcs(of("a", "b", "c"), of("b", "c", "d"))).toEqual([
      { src: "a", leagueId: "league a" },
      { src: "d", leagueId: "league d" },
    ]);
    expect(changedSrcs(of("a"), of("a"))).toEqual([]);
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

  it("records a purge refused twice for the daily retry, with its league", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    ids.member = ["m1"];
    ids.merch = ["s1"];
    const { calls, purger } = refusingPurger(["/media/photos/m1"]);
    const result = await purgingPhotoChanges(
      db,
      async () => {
        ids.member = [];
        return "taken down";
      },
      purger,
      0,
    );
    // The takedown goes through even though its purge didn't.
    expect(result).toBe("taken down");
    expect(purges.failed).toEqual([
      [{ src: "/media/photos/m1", leagueId: "L" }],
    ]);
    expect(calls).toEqual([]);
    error.mockRestore();
  });

  it("records nothing when every purge gets through", async () => {
    ids.member = ["m1"];
    const { purger } = fakePurger();
    await purgingPhotoChanges(
      db,
      async () => {
        ids.member = [];
      },
      purger,
    );
    expect(purges.failed).toEqual([]);
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

describe("retryFailedPurges", () => {
  const now = new Date("2026-11-15T05:45:00Z");

  it("tries every due failure again and records the ones that get through", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    purges.due = [
      { src: "/media/merch/s1", leagueId: "L" },
      { src: "/media/photos/m1", leagueId: "L" },
    ];
    const { calls, purger } = refusingPurger(["/media/merch/s1"]);
    // One batch: both are refused together, so neither is cleared.
    expect(await retryFailedPurges(db, now, purger, 0)).toEqual({
      purged: 0,
      stillFailing: 2,
    });
    expect(calls).toEqual([]);

    const ok = fakePurger();
    expect(await retryFailedPurges(db, now, ok.purger, 0)).toEqual({
      purged: 2,
      stillFailing: 0,
    });
    expect(ok.calls).toEqual([
      "tag /media/merch/s1 /media/photos/m1",
      "src /media/merch/s1 /media/photos/m1",
    ]);
    expect(purges.retried).toEqual([[], purges.due]);
    error.mockRestore();
  });

  it("looks back only as long as optimized copies are kept", async () => {
    await retryFailedPurges(db, now, fakePurger().purger, 0);
    expect(purges.maxAge).toBe(LONG_PHOTO_LIFETIME);
  });

  it("does nothing off Vercel", async () => {
    purges.due = [{ src: "/media/photos/m1", leagueId: "L" }];
    expect(await retryFailedPurges(db, now, null)).toEqual({
      purged: 0,
      stillFailing: 0,
    });
    expect(purges.retried).toEqual([]);
  });
});
