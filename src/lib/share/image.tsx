import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { badgeFill, inkFor, initials } from "@/domain/badge/badge";
import type { Hex } from "@/domain/color/contrast";
import {
  type CardTeam,
  type GameCard,
  type Outcome,
  SHARE_IMAGE_SIZE,
  type SeasonShareCard,
  type ShareCard,
  type StickerTone,
  type TeamCard,
} from "@/domain/share/cards";
import { logoDataUrl } from "@/lib/brand-logo";
import { BRAND, SITE } from "@/lib/site";

/**
 * Share images (docs/design-system.md, section 8): 1200 × 630 PNGs in the
 * light theme's tokens, the display face for names and scores, and a sticker
 * for the game's state. The image engine has no CSS variables, so the token
 * values are repeated here; src/design/tokens.test.ts holds the tested pairs.
 */

export { SHARE_IMAGE_SIZE };

const T = {
  bg: "#F6EBD3",
  surface2: "#EFDFC0",
  text: "#1B2547",
  muted: "#4D4B5E",
  brand: "#233C7D",
  onBrand: "#FFF8EA",
  accent: "#781B22",
  highlight: "#F2A33A",
  danger: "#AE231C",
} as const;

const STICKER: Record<StickerTone, { bg: string; fg: string }> = {
  highlight: { bg: T.highlight, fg: T.text },
  live: { bg: T.accent, fg: T.onBrand },
  danger: { bg: T.danger, fg: T.onBrand },
  brand: { bg: T.brand, fg: T.onBrand },
};

const fontFile = (name: string) =>
  readFile(join(process.cwd(), "assets/fonts", name));

let fonts: Promise<[Buffer, Buffer]> | undefined;
/** Read once per server instance, on the first image. */
function loadFonts() {
  fonts ??= Promise.all([
    fontFile("bricolage-grotesque-latin-800-normal.woff"),
    fontFile("inter-latin-600-normal.woff"),
  ]);
  return fonts;
}

/** Cache a versioned image for a year; anything else for five minutes. */
export const LONG_CACHE = "public, max-age=86400, s-maxage=31536000, immutable";
export const SHORT_CACHE =
  "public, max-age=300, s-maxage=300, stale-while-revalidate=3600";

export async function renderShareImage(
  card: ShareCard,
  { cacheControl = SHORT_CACHE }: { cacheControl?: string | undefined } = {},
): Promise<ImageResponse> {
  const [[display, text], logo] = await Promise.all([
    loadFonts(),
    logoDataUrl(),
  ]);
  return new ImageResponse(<Frame card={card} logo={logo} />, {
    ...SHARE_IMAGE_SIZE,
    fonts: [
      { name: "Display", data: display, weight: 800, style: "normal" },
      { name: "Text", data: text, weight: 600, style: "normal" },
    ],
    headers: { "Cache-Control": cacheControl },
  });
}

function Frame({ card, logo }: { card: ShareCard; logo: string | null }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: T.bg,
        color: T.text,
        fontFamily: "Text",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "40px 56px 0",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {logo && BRAND.logo ? <Logo src={logo} /> : <Pennant />}
          <span style={{ fontFamily: "Display", fontSize: 38, color: T.brand }}>
            {SITE.name}
          </span>
        </div>
        <span style={{ fontSize: 28, color: T.muted }}>
          {card.season ?? ""}
        </span>
      </div>
      {card.kind === "game" ? (
        <GameBody card={card} />
      ) : card.kind === "season" ? (
        <SeasonBody card={card} />
      ) : (
        <TeamBody card={card} />
      )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: 104,
          padding: "0 56px",
          background: T.brand,
          borderTop: `10px solid ${T.accent}`,
          color: T.onBrand,
          fontSize: 32,
        }}
      >
        {card.kind === "team"
          ? "Schedule, results and a calendar feed"
          : card.footer}
      </div>
    </div>
  );
}

/** The configured league logo, 52 pixels tall and at most twice as wide. */
function Logo({ src }: { src: string }) {
  const { width, height } = BRAND.logo ?? { width: 1, height: 1 };
  const w = Math.min(104, Math.round((52 * width) / height));
  const h = Math.round((w * height) / width);
  // eslint-disable-next-line @next/next/no-img-element -- drawn by the image engine, not the browser
  return <img src={src} width={w} height={h} alt="" />;
}

/** The league mark placeholder: a pennant in the brand color. */
function Pennant() {
  return (
    <svg width="52" height="52" viewBox="0 0 100 100">
      <path d="M8 12 L92 50 L8 88 Z" fill={T.brand} />
      <rect x="4" y="8" width="7" height="88" rx="3" fill={T.accent} />
    </svg>
  );
}

function Badge({
  name,
  color,
  size,
}: {
  name: string;
  color: string | null;
  size: number;
}) {
  const fill = badgeFill(name, color as Hex | null);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: size,
        background: fill,
        border: `4px solid ${T.text}`,
        boxShadow: `6px 6px 0 ${T.text}`,
        color: inkFor(fill),
        fontFamily: "Display",
        fontSize: size * 0.4,
      }}
    >
      {initials(name, 2)}
    </div>
  );
}

function Sticker({ label, tone }: { label: string; tone: StickerTone }) {
  const { bg, fg } = STICKER[tone];
  return (
    <div
      style={{
        display: "flex",
        padding: "8px 28px",
        borderRadius: 999,
        border: `3px solid ${T.text}`,
        background: bg,
        color: fg,
        boxShadow: `5px 5px 0 ${T.text}`,
        transform: "rotate(-4deg)",
        fontFamily: "Display",
        fontSize: 40,
        textTransform: "uppercase",
      }}
    >
      {label}
    </div>
  );
}

/** Long names step down so two always fit beside the scores. */
const nameSize = (name: string) =>
  name.length > 22 ? 34 : name.length > 14 ? 42 : 52;

function Side({ team, showScore }: { team: CardTeam; showScore: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        width: 400,
        gap: 14,
      }}
    >
      <Badge name={team.name} color={team.color} size={showScore ? 120 : 170} />
      <span
        style={{
          fontFamily: "Display",
          fontSize: nameSize(team.name),
          textAlign: "center",
          lineHeight: 1.05,
          maxHeight: 120,
          overflow: "hidden",
        }}
      >
        {team.name}
      </span>
      {showScore && team.score !== null && (
        <span
          style={{
            fontFamily: "Display",
            fontSize: 132,
            lineHeight: 1,
            color: team.won ? T.text : T.muted,
          }}
        >
          {team.score}
        </span>
      )}
    </div>
  );
}

function GameBody({ card }: { card: GameCard }) {
  const [a, b] = card.teams;
  return (
    <div
      style={{
        display: "flex",
        flex: 1,
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 56px",
      }}
    >
      <Side team={a} showScore={card.showScores} />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 28,
        }}
      >
        <Sticker label={card.sticker} tone={card.tone} />
        <span style={{ fontFamily: "Display", fontSize: 44, color: T.muted }}>
          {card.showScores ? "–" : "vs"}
        </span>
      </div>
      <Side team={b} showScore={card.showScores} />
    </div>
  );
}

const FORM: Record<Outcome, { bg: string; fg: string }> = {
  W: { bg: T.brand, fg: T.onBrand },
  L: { bg: T.surface2, fg: T.text },
  T: { bg: T.highlight, fg: T.text },
};

function TeamBody({ card }: { card: TeamCard }) {
  return (
    <div
      style={{
        display: "flex",
        flex: 1,
        alignItems: "center",
        gap: 56,
        padding: "0 72px",
      }}
    >
      <Badge name={card.name} color={card.color} size={250} />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 20,
          flex: 1,
          minWidth: 0,
        }}
      >
        <span
          style={{
            fontFamily: "Display",
            fontSize: card.name.length > 18 ? 64 : 88,
            lineHeight: 1,
            maxHeight: 180,
            overflow: "hidden",
          }}
        >
          {card.name}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {card.record && <Sticker label={card.record} tone="highlight" />}
          {card.form.length > 0 && (
            <div style={{ display: "flex", gap: 8 }}>
              {card.form.map((o, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 52,
                    height: 52,
                    borderRadius: 52,
                    border: `3px solid ${T.text}`,
                    background: FORM[o].bg,
                    color: FORM[o].fg,
                    fontFamily: "Display",
                    fontSize: 26,
                  }}
                >
                  {o}
                </div>
              ))}
            </div>
          )}
        </div>
        {card.vibe && (
          <span style={{ fontSize: 32, color: T.muted }}>{card.vibe}</span>
        )}
      </div>
    </div>
  );
}

/** A player's season: their team's badge, the headline and big numbers. */
function SeasonBody({ card }: { card: SeasonShareCard }) {
  return (
    <div
      style={{
        display: "flex",
        flex: 1,
        alignItems: "center",
        gap: 48,
        padding: "0 64px",
      }}
    >
      <Badge name={card.team.name} color={card.team.color} size={200} />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 18,
          flex: 1,
          minWidth: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <span
            style={{
              fontFamily: "Display",
              fontSize: card.headline.length > 22 ? 52 : 68,
              lineHeight: 1,
              maxHeight: 140,
              overflow: "hidden",
            }}
          >
            {card.headline}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <span style={{ fontSize: 32, color: T.muted }}>{card.team.name}</span>
          {card.sticker && <Sticker label={card.sticker} tone="highlight" />}
        </div>
        <div style={{ display: "flex", gap: 16 }}>
          {card.tiles.map((t) => (
            <div
              key={t.label}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                width: 190,
                height: 132,
                borderRadius: 20,
                border: `3px solid ${T.text}`,
                background: T.surface2,
              }}
            >
              <span style={{ fontFamily: "Display", fontSize: 56 }}>
                {t.value}
              </span>
              <span style={{ fontSize: 22, color: T.muted }}>{t.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
