import { describe, expect, it } from "vitest";
import { cardVersion } from "../share/cards";
import { CARD_VERSION, type SeasonCardStats } from "./card";
import {
  headline,
  publicCardPath,
  seasonCardShareText,
  seasonShareCard,
  tiles,
} from "./share";

const stats: SeasonCardStats = {
  version: CARD_VERSION,
  playerName: "Robin Q.",
  seasonName: "Summer 2026",
  team: { name: "Pitch *Please*", slug: "pitch-please", colorHex: "#2A9D8F" },
  gamesPlayed: 7,
  attended: 6,
  runs: 41,
  liveGames: 1,
  biggestInning: { runs: 6, opponent: "Foul Play", day: "2026-07-12" },
  record: { wins: 5, losses: 2, ties: 0 },
  finish: { rank: 2, of: 8, champion: false },
  awardsWon: [{ title: "Summer 2026 MVP", team: false }],
  votesCast: 2,
  longestWinStreak: 4,
  sportsmanship: null,
  subGames: 0,
  superlatives: [],
  bestGame: {
    day: "2026-07-12",
    opponent: "Foul Play",
    runsFor: 12,
    runsAgainst: 3,
    outcome: "W",
  },
};

describe("seasonShareCard", () => {
  it("draws the headline, team, four numbers and the award sticker", () => {
    const card = seasonShareCard(stats);
    expect(card).toMatchObject({
      kind: "season",
      headline: "Robin Q.'s season",
      team: { name: "Pitch *Please*", color: "#2A9D8F" },
      season: "Summer 2026",
      sticker: "Summer 2026 MVP",
      footer: "Your season in kickball",
    });
    expect(card.tiles).toEqual([
      { value: "6/7", label: "games" },
      { value: "41", label: "team runs" },
      { value: "4", label: "win streak" },
      { value: "5-2", label: "record" },
    ]);
    expect(card.alt).toContain("Robin Q.'s season with Pitch *Please*");
    expect(card.alt).toContain("Finished 2nd of 8");
  });

  it("puts a title above an award, and shows games without attendance", () => {
    const champs = seasonShareCard({
      ...stats,
      attended: null,
      finish: { rank: 1, of: 8, champion: true },
    });
    expect(champs.sticker).toBe("Champions");
    expect(champs.tiles[0]).toEqual({ value: "7", label: "games" });
    expect(seasonShareCard({ ...stats, awardsWon: [] }).sticker).toBeNull();
  });

  it("changes its image version only when the card does", () => {
    expect(cardVersion(seasonShareCard(stats))).toBe(
      cardVersion(seasonShareCard({ ...stats })),
    );
    expect(cardVersion(seasonShareCard(stats))).not.toBe(
      cardVersion(seasonShareCard({ ...stats, runs: 42 })),
    );
  });
});

describe("seasonCardShareText", () => {
  it("is the season in a few lines, bold safely, with the link when public", () => {
    const url = `https://league.example.test${publicCardPath("summer-2026", "c1")}`;
    const text = seasonCardShareText(stats, url);
    expect(text.split("\n")).toEqual([
      "*Robin Q.'s season in kickball* · Summer 2026",
      "• Pitch *Please*: 5-2, 2nd of 8",
      "• Showed up for 6 of 7 games",
      "• 41 runs for the team",
      "• 4-game win streak",
      "• Won Summer 2026 MVP",
      "• Best game: W 12–3 vs Foul Play",
      "https://league.example.test/seasons/summer-2026/card/c1",
    ]);
  });

  it("has no link while the card is private", () => {
    expect(seasonCardShareText(stats, null)).not.toContain("http");
  });
});

describe("helpers", () => {
  it("names the card and its tiles", () => {
    expect(headline(stats)).toBe("Robin Q.'s season");
    expect(tiles({ ...stats, longestWinStreak: 0 })[2]?.value).toBe("0");
  });
});
