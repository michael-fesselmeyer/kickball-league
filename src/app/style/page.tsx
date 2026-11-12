import type { Metadata } from "next";
import { Kickball } from "@/components/kickball";
import { LogoBadge, type BadgeSize } from "@/components/logo-badge";
import { TEAM_HUES } from "@/domain/badge/badge";

export const metadata: Metadata = {
  title: "Style guide",
  robots: { index: false, follow: false },
};

const teams = [
  "The Big Kicks",
  "Sun Kickers",
  "Base Invaders",
  "Kickin' Chicken",
  "Pitch Please",
  "Red Rubber Ballers",
  "Grand Slammers",
  "Foul Play",
];
const sizes: BadgeSize[] = [24, 40, 64, 96, 160];

/** A living style guide: the real components, so it can never drift from the app. */
export default function StylePage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-12 px-4 py-12 md:px-6">
      <header className="flex flex-col gap-3">
        <span className="sticker self-start">Style guide</span>
        <h1 className="text-h1">How the league looks</h1>
        <p className="max-w-prose text-text-muted">
          Built from the same components and tokens as the app. Switch the theme
          in the header to see both.
        </p>
      </header>

      <section aria-labelledby="buttons" className="flex flex-col gap-4">
        <h2 id="buttons" className="text-h2">
          Buttons and stickers
        </h2>
        <div className="flex flex-wrap items-center gap-4">
          <button type="button" className="btn btn-primary">
            Primary
          </button>
          <button type="button" className="btn btn-secondary">
            Secondary
          </button>
          <span className="sticker">Sticker</span>
          <span className="text-h3">
            A <span className="swipe">highlighted</span> word
          </span>
          <Kickball className="size-10" />
        </div>
      </section>

      <section aria-labelledby="team-badges" className="flex flex-col gap-4">
        <h2 id="team-badges" className="text-h2">
          Team badges
        </h2>
        <p className="text-text-muted">
          Teams without a color get one of {TEAM_HUES.length} hues, picked from
          their name so it never changes.
        </p>
        <ul className="flex flex-wrap gap-4">
          {teams.map((team) => (
            <li
              key={team}
              className="flex w-24 flex-col items-center gap-2 text-center text-small"
            >
              <LogoBadge kind="team" name={team} size={64} />
              {team}
            </li>
          ))}
        </ul>
        <ul className="flex flex-wrap items-end gap-4" aria-label="Badge sizes">
          {sizes.map((size) => (
            <li
              key={size}
              className="flex flex-col items-center gap-1 text-micro text-text-muted"
            >
              <LogoBadge kind="team" name="The Big Kicks" size={size} />
              {size}px
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="other-badges" className="flex flex-col gap-4">
        <h2 id="other-badges" className="text-h2">
          League mark and avatars
        </h2>
        <div className="flex flex-wrap items-center gap-6">
          <LogoBadge kind="league" name="Brooklyn Kickball Club" size={96} />
          <LogoBadge kind="league" name="Kickball League" size={64} />
          <LogoBadge kind="avatar" name="Jordan Rivera" size={64} />
          <LogoBadge kind="avatar" name="Sam" size={40} />
        </div>
      </section>
    </main>
  );
}
