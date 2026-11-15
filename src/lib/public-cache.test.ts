import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
}));
// The work a refresh leaves for after the response, run by each test.
const afterResponse: (() => Promise<unknown>)[] = [];
vi.mock("next/server", () => ({
  after: (task: () => Promise<unknown>) => afterResponse.push(task),
}));

const { revalidatePath, revalidateTag, updateTag } = await import("next/cache");
const {
  EVENTS_TAG,
  FRIENDS_TAG,
  PARKS_TAG,
  INTEREST_TAG,
  SEASONS_TAG,
  SITE_TAG,
  SPONSORS_TAG,
  THEME_WEEKS_TAG,
  eventTag,
  gameTag,
  refreshEventPages,
  refreshFriendPages,
  refreshGamePage,
  refreshParkPages,
  refreshInterestPage,
  refreshSeasonPages,
  refreshSeasonCards,
  refreshSiteNotice,
  refreshSponsorPages,
  SECOND_EXPIRY_MS,
  seasonCardsTag,
  seasonCardTag,
  seasonTag,
} = await import("./public-cache");

beforeEach(() => {
  vi.mocked(revalidatePath).mockClear();
  vi.mocked(revalidateTag).mockClear();
  vi.mocked(updateTag).mockClear();
  afterResponse.length = 0;
});

// A page whose tag expired is answered from its route's shell, so the shells,
// which carry only path tags, are expired by path too.
describe("refreshSeasonPages", () => {
  it("expires the season's tag, the season list and the season, team, game and rules routes", () => {
    refreshSeasonPages("season-1");

    expect(vi.mocked(updateTag).mock.calls).toEqual([
      [seasonTag("season-1")],
      [SEASONS_TAG],
      // A season turning public changes which permits the park pages show.
      [PARKS_TAG],
    ]);
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([
      ["/[lang]/l/[league]/fields/[park]", "page"],
      ["/[lang]/l/[league]/seasons", "page"],
      ["/[lang]/l/[league]/seasons/[season]", "layout"],
      ["/[lang]/l/[league]/teams/[team]", "layout"],
      ["/[lang]/l/[league]/games/[game]", "layout"],
      ["/embed/schedule", "layout"],
      ["/[lang]/l/[league]/rules", "layout"],
    ]);
  });

  it("expires the season's tag and pages again a moment after the response", async () => {
    vi.useFakeTimers();
    try {
      refreshSeasonPages("season-1");
      vi.mocked(revalidatePath).mockClear();
      expect(afterResponse).toHaveLength(1);

      const done = afterResponse[0]!();
      await vi.advanceTimersByTimeAsync(SECOND_EXPIRY_MS - 1);
      expect(revalidateTag).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await done;

      expect(vi.mocked(revalidateTag).mock.calls).toEqual([
        [seasonTag("season-1"), { expire: 0 }],
      ]);
      expect(vi.mocked(revalidatePath).mock.calls).toEqual([
        ["/[lang]/l/[league]/seasons/[season]", "layout"],
        ["/[lang]/l/[league]/teams/[team]", "layout"],
        ["/[lang]/l/[league]/games/[game]", "layout"],
        ["/embed/schedule", "layout"],
        ["/[lang]/l/[league]/rules", "layout"],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("refreshParkPages", () => {
  it("expires the parks tag and the park route", () => {
    refreshParkPages();

    expect(vi.mocked(updateTag).mock.calls).toEqual([[PARKS_TAG]]);
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([
      ["/[lang]/l/[league]/fields/[park]", "page"],
    ]);
  });
});

describe("refreshGamePage", () => {
  it("expires the game's tag and its own page, not every game's", () => {
    refreshGamePage("game-1", { slug: "kickball", isDefault: true });
    refreshGamePage("game-2", { slug: "flag-football", isDefault: false });

    expect(vi.mocked(updateTag).mock.calls).toEqual([
      [gameTag("game-1")],
      [gameTag("game-2")],
    ]);
    // Each page at its league's route (ADR 0048).
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([
      ["/en/l/_default/games/game-1"],
      ["/es/l/_default/games/game-1"],
      ["/en/l/flag-football/games/game-2"],
      ["/es/l/flag-football/games/game-2"],
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
      ["/[lang]/l/[league]/events/[event]", "page"],
    ]);
  });

  it("also expires the season routes when a theme week changes", () => {
    refreshEventPages("trivia-night", { themeWeek: true });

    expect(updateTag).toHaveBeenCalledWith(THEME_WEEKS_TAG);
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([
      ["/[lang]/l/[league]/events/[event]", "page"],
      ["/[lang]/l/[league]/seasons/[season]", "layout"],
    ]);
  });
});

describe("refreshSponsorPages", () => {
  it("expires the sponsors tag and the sponsors list with every sponsor page", () => {
    refreshSponsorPages();

    expect(vi.mocked(updateTag).mock.calls).toEqual([[SPONSORS_TAG]]);
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([
      ["/[lang]/l/[league]/sponsors", "layout"],
    ]);
  });
});

describe("refreshSiteNotice", () => {
  it("expires the site's tag and the paused notice", () => {
    refreshSiteNotice();

    expect(vi.mocked(updateTag).mock.calls).toEqual([[SITE_TAG]]);
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([
      ["/[lang]/paused", "page"],
    ]);
  });
});

describe("refreshSeasonCards", () => {
  it("expires one card, or a season's cards, and the card route", () => {
    refreshSeasonCards({ cardId: "card-1" });
    refreshSeasonCards({ seasonId: "season-1" });

    expect(vi.mocked(updateTag).mock.calls).toEqual([
      [seasonCardTag("card-1")],
      [seasonCardsTag("season-1")],
    ]);
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([
      ["/[lang]/l/[league]/seasons/[season]/card/[card]", "page"],
      ["/[lang]/l/[league]/seasons/[season]/card/[card]", "page"],
    ]);
  });
});

describe("refreshFriendPages", () => {
  it("expires the league's own friends and events pages at once, and every league's", () => {
    refreshFriendPages({ slug: "flag-football", isDefault: false });
    refreshFriendPages({ slug: "kickball", isDefault: true });

    expect(vi.mocked(updateTag).mock.calls).toEqual([
      [FRIENDS_TAG],
      [FRIENDS_TAG],
    ]);
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([
      ["/en/l/flag-football/friends"],
      ["/es/l/flag-football/friends"],
      ["/[lang]/l/[league]/friends", "page"],
      ["/en/l/flag-football/events"],
      ["/es/l/flag-football/events"],
      ["/[lang]/l/[league]/events", "page"],
      ["/en/l/_default/friends"],
      ["/es/l/_default/friends"],
      ["/[lang]/l/[league]/friends", "page"],
      ["/en/l/_default/events"],
      ["/es/l/_default/events"],
      ["/[lang]/l/[league]/events", "page"],
    ]);
  });
});

describe("refreshInterestPage", () => {
  it("expires the league's own interest form at once, and every league's", () => {
    refreshInterestPage({ slug: "flag-football", isDefault: false });
    refreshInterestPage({ slug: "kickball", isDefault: true });

    expect(vi.mocked(updateTag).mock.calls).toEqual([
      [INTEREST_TAG],
      [INTEREST_TAG],
    ]);
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([
      ["/l/flag-football/interest"],
      ["/[lang]/l/[league]/interest", "page"],
      ["/l/_default/interest"],
      ["/[lang]/l/[league]/interest", "page"],
    ]);
  });
});
