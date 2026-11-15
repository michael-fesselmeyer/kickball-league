import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));

const { revalidatePath, updateTag } = await import("next/cache");
const {
  EVENTS_TAG,
  FRIENDS_TAG,
  PARKS_TAG,
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
  refreshSeasonPages,
  refreshSeasonCards,
  refreshSiteNotice,
  refreshSponsorPages,
  seasonCardsTag,
  seasonCardTag,
  seasonTag,
} = await import("./public-cache");

beforeEach(() => {
  vi.mocked(revalidatePath).mockClear();
  vi.mocked(updateTag).mockClear();
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
      ["/l/[league]/fields/[park]", "page"],
      ["/l/[league]/seasons", "page"],
      ["/l/[league]/seasons/[season]", "layout"],
      ["/l/[league]/teams/[team]", "layout"],
      ["/l/[league]/games/[game]", "layout"],
      ["/embed/schedule", "layout"],
      ["/l/[league]/rules", "layout"],
    ]);
  });
});

describe("refreshParkPages", () => {
  it("expires the parks tag and the park route", () => {
    refreshParkPages();

    expect(vi.mocked(updateTag).mock.calls).toEqual([[PARKS_TAG]]);
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([
      ["/l/[league]/fields/[park]", "page"],
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
      ["/l/_default/games/game-1"],
      ["/l/flag-football/games/game-2"],
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
      ["/l/[league]/events/[event]", "page"],
    ]);
  });

  it("also expires the season routes when a theme week changes", () => {
    refreshEventPages("trivia-night", { themeWeek: true });

    expect(updateTag).toHaveBeenCalledWith(THEME_WEEKS_TAG);
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([
      ["/l/[league]/events/[event]", "page"],
      ["/l/[league]/seasons/[season]", "layout"],
    ]);
  });
});

describe("refreshSponsorPages", () => {
  it("expires the sponsors tag and the sponsors list with every sponsor page", () => {
    refreshSponsorPages();

    expect(vi.mocked(updateTag).mock.calls).toEqual([[SPONSORS_TAG]]);
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([
      ["/l/[league]/sponsors", "layout"],
    ]);
  });
});

describe("refreshSiteNotice", () => {
  it("expires the site's tag and the paused notice", () => {
    refreshSiteNotice();

    expect(vi.mocked(updateTag).mock.calls).toEqual([[SITE_TAG]]);
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([["/paused"]]);
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
      ["/l/[league]/seasons/[season]/card/[card]", "page"],
      ["/l/[league]/seasons/[season]/card/[card]", "page"],
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
      ["/l/flag-football/friends"],
      ["/l/[league]/friends", "page"],
      ["/l/flag-football/events"],
      ["/l/[league]/events", "page"],
      ["/l/_default/friends"],
      ["/l/[league]/friends", "page"],
      ["/l/_default/events"],
      ["/l/[league]/events", "page"],
    ]);
  });
});
