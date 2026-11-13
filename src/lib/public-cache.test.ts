import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));

const { revalidatePath, updateTag } = await import("next/cache");
const { refreshSeasonPages, seasonTag } = await import("./public-cache");

describe("refreshSeasonPages", () => {
  it("expires the season's tag and the season and team routes' shells", () => {
    refreshSeasonPages("season-1");

    expect(updateTag).toHaveBeenCalledWith(seasonTag("season-1"));
    // A page whose tag expired is answered from its route's shell, so the
    // shells, which carry only path tags, are expired by path too.
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([
      ["/seasons/[season]", "layout"],
      ["/teams/[team]", "layout"],
    ]);
  });
});
