import { describe, expect, it } from "vitest";
import type { PublicGame } from "../schedule/public-game";
import { cardVersion, gameCard, ordinal, teamCard } from "./cards";

const tz = "America/New_York";
const base: PublicGame = {
  id: "g1",
  seasonId: "s1",
  seasonName: "Fall 2026",
  seasonSlug: "fall-2026",
  versionNo: 1,
  roundNo: 1,
  kind: "regular",
  status: "scheduled",
  startsAt: new Date("2026-11-15T18:00:00Z"),
  endsAt: new Date("2026-11-15T19:00:00Z"),
  slotCancelled: false,
  field: "Field 2",
  venue: {
    name: "Riverside Park",
    slug: "riverside",
    address: null,
    lat: null,
    lng: null,
  },
  teamA: { id: "a", name: "Sluggers", slug: "sluggers", colorHex: "#2A9D8F" },
  teamB: { id: "b", name: "Kickers", slug: "kickers", colorHex: null },
  scoreA: null,
  scoreB: null,
  forfeitBy: null,
};

describe("gameCard", () => {
  it("shows scores and the winner on a final", () => {
    const card = gameCard(
      { ...base, status: "final", scoreA: 3, scoreB: 5 },
      tz,
    );
    expect(card).toMatchObject({
      sticker: "Final",
      tone: "highlight",
      showScores: true,
      footer: "Sun, Nov 15 · Field 2, Riverside Park",
      teams: [
        { name: "Sluggers", color: "#2A9D8F", score: 3, won: false },
        { name: "Kickers", color: null, score: 5, won: true },
      ],
    });
    expect(card.alt).toBe(
      "Final: Kickers 5, Sluggers 3. Sun, Nov 15 · Field 2, Riverside Park.",
    );
  });

  it("names a forfeit winner without scores", () => {
    const card = gameCard({ ...base, status: "forfeit", forfeitBy: "a" }, tz);
    expect(card.showScores).toBe(false);
    expect(card.teams.map((t) => t.won)).toEqual([false, true]);
    expect(card.alt).toContain("Kickers win by forfeit");
  });

  it("marks a rain-out in the danger tone", () => {
    expect(gameCard({ ...base, slotCancelled: true }, tz)).toMatchObject({
      sticker: "Rained out",
      tone: "danger",
      showScores: false,
    });
  });

  it("marks a live game and a game still to play", () => {
    expect(gameCard({ ...base, status: "in_progress" }, tz).tone).toBe("live");
    expect(gameCard(base, tz)).toMatchObject({
      sticker: "Game day",
      tone: "brand",
    });
  });

  it("says when a makeup has no time or place yet", () => {
    const card = gameCard(
      { ...base, startsAt: null, endsAt: null, field: null, venue: null },
      tz,
    );
    expect(card.footer).toBe("Time to be announced");
  });
});

describe("teamCard", () => {
  it("shows the record, place and recent form", () => {
    const card = teamCard({
      name: "Sluggers",
      color: null,
      season: "Fall 2026",
      vibe: "Here for the snacks",
      standing: {
        rank: 2,
        played: 6,
        wins: 4,
        losses: 1,
        ties: 1,
        lastFive: "WLTWW",
      },
    });
    expect(card).toMatchObject({
      record: "4-1-1 · 2nd place",
      form: ["W", "L", "T", "W", "W"],
      alt: "Sluggers, Fall 2026, 4-1-1 · 2nd place.",
    });
  });

  it("leaves out the record before the first game", () => {
    const card = teamCard({
      name: "Sluggers",
      color: null,
      season: null,
      vibe: null,
      standing: {
        rank: 1,
        played: 0,
        wins: 0,
        losses: 0,
        ties: 0,
        lastFive: "",
      },
    });
    expect(card).toMatchObject({ record: null, form: [], alt: "Sluggers." });
    expect(
      teamCard({ ...card, standing: null, vibe: null, season: null }).form,
    ).toEqual([]);
  });
});

describe("ordinal", () => {
  it.each([
    [1, "1st"],
    [2, "2nd"],
    [3, "3rd"],
    [4, "4th"],
    [11, "11th"],
    [12, "12th"],
    [13, "13th"],
    [21, "21st"],
    [22, "22nd"],
    [101, "101st"],
  ])("%i is %s", (n, text) => expect(ordinal(n)).toBe(text));
});

describe("cardVersion", () => {
  it("changes when the data does, and only then", () => {
    const a = gameCard(base, tz);
    expect(cardVersion(a)).toBe(cardVersion(gameCard(base, tz)));
    expect(cardVersion(a)).not.toBe(
      cardVersion(
        gameCard({ ...base, status: "final", scoreA: 1, scoreB: 0 }, tz),
      ),
    );
    expect(cardVersion(a)).not.toBe(
      cardVersion(
        gameCard({ ...base, teamA: { ...base.teamA, name: "SLUGGERS" } }, tz),
      ),
    );
  });
});
