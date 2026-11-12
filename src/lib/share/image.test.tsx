import { describe, expect, it } from "vitest";
import type { GameCard, TeamCard } from "@/domain/share/cards";
import {
  LONG_CACHE,
  renderShareImage,
  SHARE_IMAGE_SIZE,
  SHORT_CACHE,
} from "./image";

/**
 * Budgets for share images (docs/design-system.md, section 8). WhatsApp skips
 * link previews whose image is over about 300 kB, and a preview is fetched
 * while someone waits, so a warm render must stay quick.
 */
const MAX_BYTES = 300 * 1024;
const MAX_WARM_RENDER_MS = 1500;

const final: GameCard = {
  kind: "game",
  sticker: "Final",
  tone: "highlight",
  teams: [
    { name: "Sluggers", color: "#2A9D8F", score: 3, won: false },
    {
      name: "The Extremely Long Team Name Kickers",
      color: null,
      score: 12,
      won: true,
    },
  ],
  showScores: true,
  footer: "Sun, Nov 15 · Field 2, McCarren Park",
  season: "Fall 2026",
  alt: "Final",
};

const rainedOut: GameCard = {
  ...final,
  sticker: "Rained out",
  tone: "danger",
  showScores: false,
  teams: [
    { ...final.teams[0], score: null },
    { ...final.teams[1], score: null },
  ],
};

const team: TeamCard = {
  kind: "team",
  name: "Sluggers",
  color: null,
  season: "Fall 2026",
  record: "4-1-1 · 2nd place",
  vibe: "Here for the snacks",
  form: ["W", "L", "T", "W", "W"],
  alt: "Sluggers",
};

/** Width and height from a PNG's IHDR chunk. */
function pngSize(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

async function render(card: GameCard | TeamCard, cacheControl?: string) {
  const started = performance.now();
  const response = await renderShareImage(card, { cacheControl });
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { response, bytes, ms: performance.now() - started };
}

describe("renderShareImage", () => {
  it("draws every kind of card as a 1200 × 630 PNG within budget", async () => {
    await render(final); // Warm up: fonts and the image engine load once.
    for (const card of [
      final,
      rainedOut,
      team,
      { ...team, record: null, form: [], vibe: null, season: null },
    ]) {
      const { response, bytes, ms } = await render(card);
      expect(response.headers.get("content-type")).toBe("image/png");
      expect([...bytes.slice(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
      expect(pngSize(bytes)).toEqual(SHARE_IMAGE_SIZE);
      expect(bytes.byteLength).toBeLessThan(MAX_BYTES);
      expect(ms).toBeLessThan(MAX_WARM_RENDER_MS);
    }
  }, 30_000);

  it("caches a versioned image long and anything else briefly", async () => {
    expect(
      (await render(team, LONG_CACHE)).response.headers.get("cache-control"),
    ).toBe(LONG_CACHE);
    expect((await render(team)).response.headers.get("cache-control")).toBe(
      SHORT_CACHE,
    );
  }, 30_000);
});
