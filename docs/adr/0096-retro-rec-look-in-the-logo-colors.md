# 0096. The retro rec look in the league's logo colors

Date: 2026-11-17

## Status

Accepted. Updates the palette and type of [ADR 0002](0002-playful-brand-personality.md); the structure of the design system stays.

## Context

The site's look was "Sunday League" ([design system](../design-system.md), section 1) with a playful layer on top (ADR 0002): Bricolage Grotesque headlines over Inter, navy and brick red on cream, a golden highlight. Four look options were drawn up: Corner Bar, Field Day Zine, Retro Rec Center and Sport Pop. Retro Rec Center was chosen: a 1970s rec league, with ringer-tee stripes, a swooping script headline and warm colors on cream, in the league's own colors, the navy and maroon of its logo.

The logo stays out of the repository until the owners agree to publish it (design system, section 1). Its colors are sampled, not its artwork: navy about `#233C7D` and maroon about `#781B22`, on white.

## Decision

- **Palette.** `--brand` is the logo's navy (`#233C7D`) and `--accent` its maroon (`#781B22`). The option's burnt orange and teal give way to those two, and its gold stays as `--highlight` (`#F2A33A`). The ground is a warmer cream (`#F6EBD3`), cards a lighter cream (`#FFF8EA`), and text a navy ink (`#1B2547`) in place of near-black. The dark theme is a night game under the logo's navy (`#0F1730`) with cream text. Every value is in `src/design/tokens.ts`, and every pairing the UI uses still meets WCAG 2.2 AA, checked by `tokens.test.ts`.
- **Type.** Headlines use Shrikhand, a 1970s swash script, and text uses DM Sans, a friendly geometric sans with tabular numerals. Both are self-hosted through `next/font`, Latin only. Shrikhand comes in one weight, so headings ask for weight 400 and the root sets `font-synthesis-weight: none`, so no page ever shows a smeared fake bold.
- **Ringer-tee stripes.** The site header's bottom edge is three stripes, maroon, gold and navy, drawn as a background (`ringer-stripes` in `globals.css`) in place of the 2px rule. It is decoration only and doesn't print.
- **Rounder cards.** `--radius-card` goes from 12px to 20px, like the option's cards. Pill buttons, stickers and the highlighter swipe stay.
- **The wordmark** in the header is set in the headline script in the logo's maroon.

## Consequences

- Fonts: DM Sans's variable Latin file and Shrikhand's one Latin file replace Inter's and Bricolage's, within the 120 kB budget.
- Neither font has Cyrillic. Russian pages now take the phone's own sans for their letters, through the fallbacks already in the stacks, the same way Chinese, Korean and Bengali do ([ADR 0095](0095-the-phones-own-fonts-for-other-scripts.md)). English pages no longer download Inter's Cyrillic subset for the language list's "Русский". Polish pages keep the phone's own font.
- Share images (`src/lib/share/image.tsx`) and app icons use the new colors, but share images still draw text with the Bricolage and Inter files in `assets/fonts`. Moving them to Shrikhand and DM Sans needs those font files added there.
- The native apps' icon and splash sources (`mobile/assets/`, drawn from the tokens by `npm run mobile:assets`) are redrawn in the new colors, and `capacitor.config.ts` takes the new cream as the apps' background.
- Scores and event dates are set in DM Sans, which has real weights and tabular figures, so a winning score is still bold.
- A league that brands itself differently still changes `--brand` and `--accent`; the stripes follow them.
