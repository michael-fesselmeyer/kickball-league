# 0076. The phone's own fonts for scripts the web fonts don't cover

Date: 2026-11-15

## Status

Accepted

## Context

The site speaks Chinese, Russian, Polish, Bengali, Korean and Haitian Creole as well as English and Spanish ([ADR 0094](0094-languages-from-the-path-and-the-profile.md)). Its two web fonts, Inter and Bricolage Grotesque, are self-hosted through `next/font` and budgeted at 120 kB in total, enforced by Lighthouse CI with no third-party requests ([design system](../design-system.md), Performance budgets).

Inter covers Latin, Polish letters and Cyrillic; Bricolage covers Latin and Polish letters. Neither has Chinese, Korean or Bengali. Web fonts for those scripts are large: a Korean or Chinese font is several megabytes, sliced into many files of which a page of text pulls in a dozen or more, and a Bengali font is close to the whole budget on its own. Loading them from the Google Fonts servers would also be a third-party request on public pages, which the budget forbids.

Every phone the players use ships a good font for each of these scripts: Apple's PingFang, Apple SD Gothic Neo and Kohinoor Bangla on iPhones, and Google's Noto fonts on Android. Windows and macOS have their own.

## Decision

- Chinese, Korean and Bengali text uses the device's own font for the script. `globals.css` names a short list per language (`:root:lang(...)`, `--font-script`), placed after Inter in the body and heading stacks, so Latin letters and numbers keep the site's fonts and the script's letters come from the phone's.
- Russian and Polish need nothing new: Inter's Cyrillic and Latin Extended subsets are already in its `@font-face` rules, and the browser downloads one only on a page that uses it. Only the Latin subset is preloaded, so English pages pay nothing. Russian headings use Inter, since Bricolage has no Cyrillic.
- Korean wraps between words (`word-break: keep-all`), as Korean readers expect.
- One page per script is in Lighthouse CI, so the font budget is checked in each.

## Consequences

- No new bytes or requests on any page, and no new provider.
- The Chinese, Korean and Bengali pages look slightly different from one phone to the next, and headings in those scripts lose the display face's character. If a self-hosted subset of a display font for one of them ever fits within the budget, it can be added for that language's routes alone.
- Haitian Creole has no formatting data in the JavaScript runtime, so its dates are formatted through French, which shares its word order, with the Creole day and month names swapped in (`src/domain/time/format-cache.ts`). Its lists join with "ak".
