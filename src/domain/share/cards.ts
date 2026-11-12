import { shortDay } from "../schedule/format";
import {
  hasResult,
  isCalledOff,
  outcomeFor,
  type PublicGame,
  resultLine,
  statusLabel,
} from "../schedule/public-game";

/**
 * What a share image shows, as plain data (docs/design-system.md, section 8).
 * The renderer turns it into a picture; the version hash of the same data goes
 * in the image's address, so an image changes only when its data does.
 */

/** Open Graph's 1.91:1 link-preview size. */
export const SHARE_IMAGE_SIZE = { width: 1200, height: 630 } as const;

export type StickerTone = "highlight" | "live" | "danger" | "brand";

export type CardTeam = {
  name: string;
  color: string | null;
  /** Shown only on a final. */
  score: number | null;
  won: boolean;
};

export type GameCard = {
  kind: "game";
  sticker: string;
  tone: StickerTone;
  teams: [CardTeam, CardTeam];
  showScores: boolean;
  /** "Sun, Nov 15 · Field 2, McCarren Park" */
  footer: string;
  season: string;
  alt: string;
};

export type Outcome = "W" | "L" | "T";

export type TeamCard = {
  kind: "team";
  name: string;
  color: string | null;
  season: string | null;
  /** "4-1-1 · 2nd place", or null before the first result. */
  record: string | null;
  vibe: string | null;
  /** Last five results, oldest first. */
  form: Outcome[];
  alt: string;
};

export type ShareCard = GameCard | TeamCard;

function toneFor(g: PublicGame): StickerTone {
  if (isCalledOff(g)) return "danger";
  if (g.status === "in_progress") return "live";
  if (hasResult(g)) return "highlight";
  return "brand";
}

/** The share card for a game page: a result, a rain-out or a matchup. */
export function gameCard(g: PublicGame, timeZone: string): GameCard {
  const final = g.status === "final" && hasResult(g);
  const side = (t: PublicGame["teamA"], score: number | null): CardTeam => ({
    name: t.name,
    color: t.colorHex,
    score: final ? score : null,
    won: outcomeFor(g, t.id) === "W",
  });
  const sticker = statusLabel(g) ?? "Game day";
  const footer = [
    g.startsAt ? shortDay(g.startsAt, timeZone) : "Time to be announced",
    // Field and park only: a street address does not fit on one line.
    [g.field, g.venue?.name].filter(Boolean).join(", "),
  ]
    .filter(Boolean)
    .join(" · ");
  const headline = resultLine(g) ?? `${g.teamA.name} vs ${g.teamB.name}`;
  return {
    kind: "game",
    sticker,
    tone: toneFor(g),
    teams: [side(g.teamA, g.scoreA), side(g.teamB, g.scoreB)],
    showScores: final,
    footer,
    season: g.seasonName,
    alt: `${sticker}: ${headline}. ${footer}.`,
  };
}

/** "1st", "2nd", "3rd", "11th", "22nd". */
export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

const isOutcome = (c: string): c is Outcome =>
  c === "W" || c === "L" || c === "T";

/** The share card for a team page: its season so far. */
export function teamCard(t: {
  name: string;
  color: string | null;
  season: string | null;
  vibe: string | null;
  standing: {
    rank: number;
    played: number;
    wins: number;
    losses: number;
    ties: number;
    lastFive: string;
  } | null;
}): TeamCard {
  const s = t.standing;
  const record =
    s && s.played > 0
      ? `${s.wins}-${s.losses}-${s.ties} · ${ordinal(s.rank)} place`
      : null;
  return {
    kind: "team",
    name: t.name,
    color: t.color,
    season: t.season,
    record,
    vibe: t.vibe,
    form: s ? [...s.lastFive].filter(isOutcome) : [],
    alt: [t.name, t.season, record].filter(Boolean).join(", ") + ".",
  };
}

/** A short, stable fingerprint of a card's data for its image address. */
export function cardVersion(card: ShareCard): string {
  // FNV-1a over the exact JSON, so even a change of letter case counts.
  const text = JSON.stringify(card);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}
