import type { SeasonShareCard } from "../share/cards";
import { bold } from "../share/share-text";
import {
  finishText,
  highlights,
  recordText,
  type SeasonCardStats,
} from "./card";

/** The public page's path; the card's id is the part nobody can guess. */
export const publicCardPath = (seasonSlug: string, cardId: string) =>
  `/seasons/${seasonSlug}/card/${cardId}`;

/** "Robin Q.'s season" */
export const headline = (stats: SeasonCardStats) =>
  `${stats.playerName}'s season`;

/**
 * The big numbers on the share image: games, runs, the win streak and the
 * record, four at most so they fit in one row at 1200 pixels.
 */
export function tiles(stats: SeasonCardStats): SeasonShareCard["tiles"] {
  return [
    stats.attended === null
      ? { value: String(stats.gamesPlayed), label: "games" }
      : { value: `${stats.attended}/${stats.gamesPlayed}`, label: "games" },
    { value: String(stats.runs), label: "team runs" },
    { value: String(stats.longestWinStreak), label: "win streak" },
    { value: recordText(stats.record), label: "record" },
  ];
}

/** The sticker: a title beats an award, which beats nothing. */
function sticker(stats: SeasonCardStats): string | null {
  if (stats.finish?.champion) return "Champions";
  const award = stats.awardsWon.find((a) => !a.team) ?? stats.awardsWon[0];
  return award ? award.title : null;
}

/** The 1200 × 630 share image's data. */
export function seasonShareCard(stats: SeasonCardStats): SeasonShareCard {
  const finish = finishText(stats.finish);
  return {
    kind: "season",
    headline: headline(stats),
    team: { name: stats.team.name, color: stats.team.colorHex },
    season: stats.seasonName,
    sticker: sticker(stats),
    tiles: tiles(stats),
    footer: "Your season in kickball",
    alt: [
      `${headline(stats)} with ${stats.team.name}, ${stats.seasonName}`,
      ...highlights(stats).slice(1),
      finish && !stats.finish?.champion ? `Finished ${finish}` : null,
    ]
      .filter(Boolean)
      .join(". ")
      .concat("."),
  };
}

/**
 * The "Copy for WhatsApp" message. Without a link (a private card) it is
 * the season in a few lines; a public card adds its link.
 */
export function seasonCardShareText(
  stats: SeasonCardStats,
  url: string | null,
): string {
  return [
    `${bold(`${headline(stats)} in kickball`)} · ${stats.seasonName}`,
    ...highlights(stats).map((line) => `• ${line}`),
    url,
  ]
    .filter(Boolean)
    .join("\n");
}
