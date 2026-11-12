# ADR 0002: A playful brand personality on a professional system

- Status: accepted
- Date: 2026-11-12

## Context

Design-system.md chose direction A, "Sunday League": navy, brick red and cream with a varsity feel. Built as the first token pass, it read as too corporate. The league is social: people come to have fun, meet people and maybe have a drink after (not everyone drinks). It is the opposite of a hardcore, buttoned-up rec league, and the site should feel that way, while still working and behaving like a professional product, especially around money, waivers and personal data.

## Decision

Keep the system, change the personality.

**Stays fixed:** semantic color tokens and their tested WCAG AA pairs, light and dark themes, the league's navy and brick red, Inter for body text and forms, 44px targets, focus rings, the motion rules, and plain, precise wording for errors, payments, waivers and anything legal.

**Changes:**
- **Display type** moves from Archivo to **Bricolage Grotesque**: friendly and a little quirky, still legible, and its width axis (75–100) still gives a condensed face for scores.
- **Shapes:** pill buttons with a 2px outline, and "stickers" (small labels on the golden highlight, slightly tilted, with a hard offset shadow, like a sticker on a cooler). Highlighted words in headlines use a marker-style swipe of the highlight color.
- **Voice:** casual and warm. A joke is welcome on happy paths, confirmations and empty states. Never in errors, payments, waivers or legal text, and nothing implies that drinking is expected; "a drink (or a seltzer)" is the tone.
- **The dark theme** leans into Option B's "night game" feel; the tokens already support it.

## Alternatives considered

- **Switch wholesale to Option B (Field Day Neon) or C (Park Social).** Both drop the league's own navy and red, which the owners will want to recognize in the demo.
- **A heavy novelty display face** (Lilita One, Shrikhand, Chango). Louder, but single-weight with no width axis, and tiring in long headings and scoreboards.

## Consequences

- One more variable font replaces one, so the font budget is unchanged.
- Stickers and highlight swipes use the existing tokens (`highlight` / `on-highlight`), so contrast stays tested.
- Every new screen is reviewed for both: does it feel like the league, and does it behave like a product people trust with their money?
