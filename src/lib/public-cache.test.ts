import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));

const { revalidatePath, updateTag } = await import("next/cache");
const {
  EVENTS_TAG,
  SPONSORS_TAG,
  THEME_WEEKS_TAG,
  eventTag,
  refreshEventPages,
  refreshSeasonPages,
  refreshSponsorPages,
  seasonTag,
} = await import("./public-cache");

beforeEach(() => {
  vi.mocked(revalidatePath).mockClear();
  vi.mocked(updateTag).mockClear();
});

// A page whose tag expired is answered from its route's shell, so the shells,
// which carry only path tags, are expired by path too.
describe("refreshSeasonPages", () => {
  it("expires the season's tag and the season and team routes", () => {
    refreshSeasonPages("season-1");

    expect(vi.mocked(updateTag).mock.calls).toEqual([[seasonTag("season-1")]]);
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([
      ["/seasons/[season]", "layout"],
      ["/teams/[team]", "layout"],
    ]);
  });
});

describe("refreshEventPages", () => {
  it("expires the event's tags and the event route", () => {
    refreshEventPages("trivia-night");

    expect(vi.mocked(updateTag).mock.calls).toEqual([
      [EVENTS_TAG],
      [eventTag("trivia-night")],
    ]);
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([
      ["/events/[event]", "page"],
    ]);
  });

  it("also expires the season routes when a theme week changes", () => {
    refreshEventPages("trivia-night", { themeWeek: true });

    expect(updateTag).toHaveBeenCalledWith(THEME_WEEKS_TAG);
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([
      ["/events/[event]", "page"],
      ["/seasons/[season]", "layout"],
    ]);
  });
});

describe("refreshSponsorPages", () => {
  it("expires the sponsors tag and the sponsors list with every sponsor page", () => {
    refreshSponsorPages();

    expect(vi.mocked(updateTag).mock.calls).toEqual([[SPONSORS_TAG]]);
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([
      ["/sponsors", "layout"],
    ]);
  });
});
