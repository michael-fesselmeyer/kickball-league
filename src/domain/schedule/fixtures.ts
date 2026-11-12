import type { PublicGame } from "./public-game";

/** A public game for tests, with invented teams and a park; override any field. */
export function publicGame(overrides: Partial<PublicGame> = {}): PublicGame {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    seasonId: "season-1",
    seasonName: "Fall 2026",
    seasonSlug: "fall-2026",
    versionNo: 1,
    roundNo: 3,
    kind: "regular",
    status: "scheduled",
    startsAt: new Date("2026-09-15T00:00:00Z"),
    endsAt: new Date("2026-09-15T00:55:00Z"),
    slotCancelled: false,
    field: "Field 2",
    venue: {
      name: "Riverside Park",
      slug: "riverside-park",
      address: "1 Park Ave",
      lat: 40.72,
      lng: -73.95,
    },
    teamA: { id: "a", name: "Kickers", slug: "kickers", colorHex: "#1F3A8A" },
    teamB: { id: "b", name: "Sluggers", slug: "sluggers", colorHex: null },
    scoreA: null,
    scoreB: null,
    forfeitBy: null,
    ...overrides,
  };
}
