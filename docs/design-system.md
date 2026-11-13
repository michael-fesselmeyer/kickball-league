# Design system

Status: draft v1, 2026-11-11. Contrast ratios in this document were computed, not estimated.

## 1. Brand direction

The league's name, colors and logos are configuration. The system below is the default look and the one the BKC deployment uses.

**Logo (decided 2026-11-11).** The BKC deployment uses the league's current logo, or one close to it, until the league replaces it: the navy and brick-red arched wordmark with the kicked ball. It is uploaded into the league-mark slot through settings and stored with the other uploads, not in the code repository, so the public repository stays free of the league's artwork until the owners agree. Every other deployment, and every team and sponsor without a logo, gets the placeholders in section 7.

Three directions were considered:

| Option | Mood | Palette | Type | Fits when |
|---|---|---|---|---|
| **A. Sunday League** | A varsity pennant brought up to date. Warm, confident, a little nostalgic: chalk lines, scoreboards, stitched lettering | Deep navy, brick red, cream paper, one golden-yellow highlight | Wide athletic display type over a clean sans | The league wants to feel established and local |
| **B. Field Day Neon** | Night-game energy. Dark by default, loud accents, big numbers | Near-black, electric lime, hot coral | Tight grotesque, heavy weights | The audience skews toward nightlife and the pitch is "not your office league" |
| **C. Park Social** | A sunny Sunday in the park. Friendly, editorial, lots of photography | Grass green, sun yellow, sky blue on off-white | Rounded sans with a soft serif for headlines | The pitch is mostly "meet people", sport second |

**Decision: A, Sunday League.** Navy and red are already the league's colors, so the owners will recognize their league in the demo; cream and navy hold contrast in full sun on a phone at the field; and the scoreboard motif gives the animations a reason to exist. Option B's dark-first look survives as the dark theme. Option C's warmth is borrowed for event and sponsor pages through photography.

**Personality (updated 2026-11-12, [ADR 0002](adr/0002-playful-brand-personality.md)).** The first build of direction A read as corporate. This is a social league: fun, meeting people, maybe a drink after. The system above stays (tokens, contrast, the league's navy and red); the personality loosens: a friendlier display face, pill buttons, tilted "stickers" on the golden highlight with a hard offset shadow, and highlighter swipes on key words. The dark theme leans into Option B's night-game feel.

**Voice.** Casual, warm, brief. Say what happens next. "Your spot isn't confirmed until you pay your share" is better than "Payment pending". A joke is welcome on happy paths, confirmations and empty states, and never in an error, a payment, a waiver or anything legal. Nothing implies drinking is expected: "a drink (or a seltzer)" is the tone.

## 2. Color

Tokens are semantic. Components never use a raw color. A league re-brands by changing `--brand` and `--accent`; everything else derives from the neutrals.

### Light theme

| Token | Value | Used for | Contrast |
|---|---|---|---|
| `--bg` | `#FBF8F1` | Page background (cream) | — |
| `--surface` | `#FFFFFF` | Cards, sheets, inputs | — |
| `--surface-2` | `#F2EDE1` | Table stripes, wells, hover | — |
| `--text` | `#14182B` | Body text and headings | 16.6:1 on `--bg` |
| `--text-muted` | `#4A5068` | Secondary text, captions | 7.5:1 on `--bg`, 6.8:1 on `--surface-2` |
| `--border` | `#D9D2C0` | Decorative dividers | Not relied on for meaning |
| `--border-strong` | `#8C8672` | Input and control outlines | 3.4:1 on `--bg` |
| `--brand` | `#1F3A8A` | Primary buttons, links, active navigation | 9.8:1 on `--bg` |
| `--on-brand` | `#FFFFFF` | Text on brand | 10.3:1 |
| `--accent` | `#8F1A1C` | The league's brick red, sampled from its logo: emphasis, live indicators, the kickball | 8.5:1 on `--bg` |
| `--on-accent` | `#FFFFFF` | Text on accent | 9.0:1 |
| `--highlight` | `#F5B301` | The "golden" moments: winners, team of the week, badges | Background only |
| `--on-highlight` | `#14182B` | Text on highlight | 9.5:1 |
| `--success` | `#1A7B49` | Paid, confirmed, "in" | 5.0:1 on `--bg`, 4.5:1 on `--surface-2` |
| `--warning` | `#9F5B00` | Due soon, weather watch | 5.0:1 on `--bg`, 4.5:1 on `--surface-2` |
| `--danger` | `#B3261E` | Errors, forfeits, rain-out, destructive actions. Deliberately brighter than `--accent` so an error never looks like branding | 6.2:1 on `--bg` |
| `--info` | `#1F5FBF` | Neutral notices | 5.7:1 on `--bg` |
| `--focus` | `#1F3A8A` | Focus ring, 3px with a 2px offset | 9.8:1 on `--bg` |

### Dark theme

| Token | Value | Contrast |
|---|---|---|
| `--bg` | `#0E1220` | — |
| `--surface` | `#161B2E` | — |
| `--surface-2` | `#1F2640` | — |
| `--text` | `#F3EFE6` | 16.3:1 on `--bg`, 14.9:1 on `--surface` |
| `--text-muted` | `#A9B0C7` | 8.6:1 on `--bg`, 6.9:1 on `--surface-2` |
| `--border` | `#2E3757` | Decorative |
| `--border-strong` | `#656F97` | 3.8:1 on `--bg`, 3.0:1 on `--surface-2` |
| `--brand` | `#8FA8FF` | 8.2:1 on `--bg` |
| `--on-brand` | `#0E1220` | 8.2:1 |
| `--accent` | `#FF7A6E` | 7.3:1 on `--bg` |
| `--on-accent` | `#0E1220` | 7.3:1 |
| `--highlight` | `#FFC93C` | Background only |
| `--on-highlight` | `#0E1220` | 12.1:1 |
| `--success` | `#4CC38A` | 8.4:1 |
| `--warning` | `#F0A840` | 9.2:1 |
| `--danger` | `#FF7A6E` | 7.3:1 |
| `--info` | `#7FB0FF` | 8.5:1 |
| `--focus` | `#FFC93C` | 12.1:1 against `--bg` |

Rules:
- Body text meets 4.5:1 and large text and control outlines meet 3:1, which is WCAG 2.2 AA, on every background (`--bg`, `--surface`, `--surface-2`). A unit test (`src/design/tokens.test.ts`) checks every pair in both themes. It caught three values that passed on `--bg` but not on `--surface-2`; `--success`, `--warning` and dark `--border-strong` were adjusted slightly.
- The theme follows the system setting, with a manual switch stored per device.
- Color never carries meaning alone. A paid status is a green dot **and** the word "Paid"; a win is bold **and** marked "W".
- Team colors are chosen by captains and are never used for text. They appear as a badge fill or a 4px stripe, and the badge picks dark or light initials by computed contrast.

## 3. Typography

Two families, both variable fonts, self-hosted through `next/font` with `display: swap` and a metric-matched fallback so text does not shift when the font loads.

| Role | Family | Why |
|---|---|---|
| Display | **Bricolage Grotesque** (variable optical size, width and weight) | Friendly and a little quirky without hurting legibility; the width axis still gives a condensed scoreboard face. Replaced Archivo, which read too corporate ([ADR 0002](adr/0002-playful-brand-personality.md)) |
| Text and UI | **Inter** | Highly legible at small sizes on phones; tabular numerals for scores and tables |

### Scale

Fluid between a 360px and a 1280px viewport using `clamp()`. Sizes in rem.

| Token | Phone | Desktop | Line height | Use |
|---|---|---|---|---|
| `display` | 2.5 | 4.5 | 1.0 | Home hero, final scores |
| `h1` | 2.0 | 3.0 | 1.1 | Page titles |
| `h2` | 1.5 | 2.0 | 1.2 | Section titles |
| `h3` | 1.25 | 1.5 | 1.25 | Card titles |
| `body-lg` | 1.125 | 1.125 | 1.5 | Lead paragraphs |
| `body` | 1.0 | 1.0 | 1.5 | Default; never smaller than 16px so iPhones do not zoom into inputs |
| `small` | 0.875 | 0.875 | 1.45 | Captions, table cells |
| `micro` | 0.75 | 0.75 | 1.4 | Labels in uppercase with letter spacing; never for sentences |

- Display and headings: Bricolage Grotesque at weight 800, slightly tight letter spacing. Scores: Bricolage at width 75 with tabular numerals. Only the weight axis loads today; the width axis is added with the first scoreboard, so no page pays for it before it is used (fonts are budgeted at 120 kB).
- Line length is capped at about 70 characters for prose.
- Text can be zoomed to 200% without loss of content, and layouts reflow at a 320px width.

## 4. Space, shape, elevation, layout

| Token group | Values |
|---|---|
| Spacing | A 4px base: 4, 8, 12, 16, 24, 32, 48, 64, 96 |
| Radius | 6px for inputs and chips, 12px for cards, 20px for sheets, full for buttons, badges and stickers |
| Border | 1px by default; 2px for selected or active |
| Shadow | A soft card shadow, a sheet shadow, and a hard offset "sticker" shadow (3px, no blur, in `--text`) for stickers and primary buttons. Dark theme replaces soft shadows with a lighter surface; the sticker shadow stays |
| Breakpoints | `sm` 480, `md` 768, `lg` 1024, `xl` 1280. Styles are written for phones first and widened |
| Grid | 4 columns under `md`, 8 at `md`, 12 at `lg`; a 16px gutter on phones and 24px above |
| Touch targets | At least 44 by 44 CSS pixels (WCAG 2.2 asks for 24); 8px minimum between adjacent targets |
| Safe areas | Bottom navigation and pinned buttons respect `env(safe-area-inset-bottom)` |

Container queries size components by the space they are given, so the same game card works in a phone list, a desktop grid and a sidebar.

## 5. Components

Built on shadcn/ui primitives, restyled with the tokens above. Each component documents its states (default, hover, focus, active, disabled, loading, error) and its keyboard behavior.

| Group | Components |
|---|---|
| Foundations | Button (primary, secondary, quiet, destructive), Link, Icon button, Badge, Chip, Avatar, **Logo badge** (monogram fallback), Divider, Skeleton, Spinner |
| Forms | Text field, Select, Combobox, Checkbox, Radio group, Switch, Stepper (plus and minus), Date field, Phone field, File upload, Form message, Consent checkbox |
| Navigation | Top bar, Bottom tab bar, Sidebar, Tabs, Breadcrumbs, Pagination, Skip link |
| Feedback | Toast, Banner (info, warning, rain-out), Dialog, Bottom sheet, Tooltip, Empty state, Error state |
| Data | Table with a stacked phone layout, Stat, Progress bar, Status dot with label, Timeline |
| League | **Game card**, **Scoreboard** and line score, **Standings table**, **Schedule list** and **Schedule grid**, **Bracket**, Team header, Roster list, RSVP control, Payment status row, Weather chip, Fairness metric card, Sponsor strip, Deal card, Event card, Check-in pass |
| Admin | Schedule board (drag with a keyboard and form alternative), Version diff, Violations list, Rain-out wizard, Audit row |

Accessibility requirements that shape components (WCAG 2.2 AA):
- Everything works with a keyboard, with a visible focus ring that is never hidden behind sticky bars.
- Dragging always has a non-drag alternative. On the schedule board, a game can be moved with "Move to…" and a slot picker.
- Dialogs and sheets trap focus, close on Escape and return focus to the control that opened them.
- Form errors are text, tied to their field, and announced. Nothing the user already entered is asked for again in the same flow.
- Live score changes are announced politely to screen readers ("Sluggers 5, Kickers 3, bottom of the 4th").
- Sign-in never requires solving a puzzle or remembering something; a magic link or a password manager is enough.
- Tables have real headers; the bracket is also available as a list.

## 6. Motion

Motion explains what changed and adds some pride to wins. It is never required to use the product.

### Performance rules

1. Animate only `transform` and `opacity`. Never width, height, top, left, margin, box-shadow or filter.
2. Use CSS first: transitions, keyframes, view transitions and scroll-driven animations run off the main thread. No JavaScript animation library is in the default bundle; one may be lazy-loaded for a single showpiece (the bracket) if CSS cannot do it.
3. Everything is wrapped in `@media (prefers-reduced-motion: no-preference)`. With reduced motion on, state changes are instant or a 150ms fade; nothing moves, parallaxes or loops.
4. Scroll-driven effects sit behind `@supports (animation-timeline: view())`. Without support, the content is simply visible.
5. Nothing animates on first paint above the fold, so motion cannot delay the largest element.
6. No animation loops forever, except the small "live" pulse, which pauses when off screen and under reduced motion.
7. `will-change` is added just before an animation and removed after, never left on.
8. At most about 12 elements animate at once. Lists stagger by 30ms per item, capped at 10 items.
9. Every motion pattern is tested on a mid-range iPhone under 4× CPU throttling and must hold 60 frames per second.

### Tokens

| Token | Value | Use |
|---|---|---|
| `--dur-1` | 120ms | Presses, toggles |
| `--dur-2` | 200ms | Hover, small reveals, toasts |
| `--dur-3` | 320ms | Sheets, page transitions |
| `--dur-4` | 600ms | Celebrations, once |
| `--ease-out` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | Things entering |
| `--ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | Things leaving |
| `--ease-spring` | `linear()` approximation of a light spring | Score flips, badges |

### Patterns

| Pattern | Where | How |
|---|---|---|
| Shared-element page transition ✔ | Game card and game page scoreboard; a team's standings dot or game page badge and its team page header | React's `<ViewTransition>` with named elements (`Morph`); where the browser lacks the API, the page changes without motion |
| Page arrival ✔ | The game page, which streams in after its loading state | The content rises 12px and fades in over `--dur-3` (`Arrive`), only after a client navigation |
| Scoreboard flip ✔ | A run total changes on the live game page or the scorer's screen | The old digit rolls up out of its box and the new one rolls in over `--dur-2` (`Flip`); reduced motion swaps it instantly |
| Scroll reveal ✔ | Home sections (the sponsor strip can add the class) | `animation-timeline: view()`, a 16px rise, a little later for each card. Transform only: a fade would leave text at the bottom of the screen below its contrast ratio |
| Hero pennant | Home | One transform-only sweep on load, below the largest element in paint order |
| Standings reorder | After a result | A view transition moves rows to their new rank |
| RSVP and payment confirmation | Buttons | A check mark draws in; the button settles |
| Winner moment ✔ (final score) | The winning total, when the result arrives while the live game page is open | A short burst of the highlight color, once, never on page load. Bracket advance is still to come |
| Bracket line draw | Playoffs | Stroke offset animation as a winner advances |
| Live pulse | In-progress games | A 2-second opacity pulse on a dot beside the word "Live" |
| Press feedback | All buttons | Scale to 0.98 over `--dur-1` |

### How the motion pass is built

The pieces live in `src/components/motion.tsx` (`Morph`, `Flip`, `revealOrder`), `src/components/arrive.tsx` and `src/app/motion.css`. They add no animation library and almost no JavaScript: React's `<ViewTransition>` hands the work to the browser's View Transitions API, and everything else is CSS.

- **Names are unique per page.** A game card and a team badge carry a name only once on a page; the schedule's desktop grid repeats each game, so its cards set `morph={false}`.
- **Transform and opacity.** Our keyframes animate only those. For a morph the browser also eases the size of the moving box; that happens on the snapshots in the transition layer, not in the page's layout.
- **Only named elements move.** The rest of the page swaps at once (`::view-transition-old(root)` is hidden), so a navigation never cross-fades the whole screen.
- **When a morph plays.** A pair forms only when both pages render in the same commit: a link to a prerendered page (schedule, standings, a team) or a page already in the router's cache. The game page renders on request behind its loading state, so a link into it uses the page arrival instead, and a link out of it to the schedule or a team folds the scoreboard back into its card. The browser's back and forward buttons don't animate, because the router doesn't run them as transitions.
- **Nothing on the first load.** React's streaming script can run a view transition when a Suspense boundary is revealed, and waits on fonts and images first. `Arrive` turns its animation on only after hydration, so a first load of the game page is never held back or animated.
- **Reduced motion.** Every view transition finishes at once, the flip and arrival don't run, the burst isn't drawn and the reveal is off.

### Performance budgets

Measured at the 75th percentile of real users on phones, and enforced in CI with Lighthouse on a throttled mid-range phone profile.

| Metric | Budget | Google's "good" threshold |
|---|---|---|
| Largest Contentful Paint | ≤ 2.0s | 2.5s |
| Interaction to Next Paint | ≤ 150ms | 200ms |
| Cumulative Layout Shift | ≤ 0.05 | 0.1 |
| Lighthouse performance, public pages | ≥ 95 | — |
| Lighthouse accessibility, all pages | 100 | — |

CI runs Lighthouse five times per page against a seeded database and takes the median run (`lighthouserc.json`). The pages are split across three runners to save time, and every runner holds its pages to these same budgets ([architecture.md](architecture.md#11-continuous-integration)). Five runs keep one slow moment on a shared CI runner from failing a page that is well inside its budget; the budgets themselves don't change. Every page listed there must meet every budget: home, sign-in, the content pages, the records page, the public schedule, standings and a team page. The schedule, standings and team pages are prerendered at build for every public season and team, so even the first visit after a deploy is static HTML that paints in under a second ([architecture.md](architecture.md#3-rendering-strategy-by-route)). A view the build didn't list, such as another season's team page, streams in on its first visit and is cached after. Their loading states hold a screen's height, so the footer never jumps when content streams in.

JavaScript budgets are compressed sizes for the first load of a route. The framework's shared runtime (React, the App Router and link prefetching) is outside our control. The original estimate of about 100 kB was too low: Lighthouse measured 140 kB on the home page in Next.js 16.4, with almost no code of our own (updated 2026-11-12). Totals are that 140 kB plus the second column, which is the part we own and is unchanged.

| Route group | Total first-load JS | Of which route-specific |
|---|---|---|
| Marketing and content (`/`, `/rules`, `/faq`, parks, news) | ≤ 165 kB | ≤ 25 kB |
| Public data (schedule, standings, team, game) | ≤ 185 kB | ≤ 45 kB |
| Signed-in player and captain screens | ≤ 215 kB | ≤ 75 kB |
| Score entry | ≤ 185 kB | ≤ 45 kB |
| Admin, except the schedule board | ≤ 235 kB | ≤ 95 kB |
| Admin schedule board (lazy-loaded) | ≤ 295 kB | ≤ 155 kB |

Other budgets: fonts ≤ 120 kB in total (two variable files, Latin subset); the home hero image ≤ 120 kB at phone size, served as AVIF or WebP with explicit dimensions; no third-party scripts on public pages except analytics.

## 7. Logos and placeholders

### Upload specifications

| Slot | Aspect ratio | Upload size | Formats | Max file | Shown at |
|---|---|---|---|---|---|
| League mark (square) | 1:1 | 1024 × 1024 | SVG preferred; PNG or WebP with transparency | 1 MB | 32–160px; app icon |
| League wordmark (horizontal) | 4:1 | 1600 × 400 | SVG preferred; PNG or WebP | 1 MB | Header, footer, emails |
| App icon | 1:1 | 512 × 512 and 192 × 192, plus a maskable 512 × 512 with the art inside the central 80% | PNG | 500 kB | Home screen |
| Team logo | 1:1 | 512 × 512 | PNG or WebP with transparency | 1 MB | 24, 40, 64, 96, 160px, in a circle |
| Sponsor logo (horizontal) | 3:1 | 900 × 300 | SVG (admin upload) or PNG | 1 MB | Sponsor strip, footer |
| Sponsor logo (square) | 1:1 | 600 × 600 | PNG or WebP | 1 MB | Cards, deal pages |
| Event or post cover | 16:9 | 1600 × 900 | JPEG or WebP | 2 MB | Cards and page headers |
| Share image | 1.91:1 | 1200 × 630 | Generated | — | Link previews |

Guidance shown to uploaders: keep important art inside the central 80% (team logos are masked to a circle), provide a version that works on both light and dark backgrounds or let the system place it on a neutral tile, and use a transparent background.

### Placeholders

Until a real logo is uploaded, each slot renders a generated badge, as an inline SVG, so there is never an empty box or a broken image.

| Slot | Placeholder |
|---|---|
| League mark | A pennant shape in `--brand` with the league's initials (up to 3 letters) in `--on-brand`, in the display face |
| League wordmark | The league name in the display face, with the pennant mark to its left |
| Team logo | A circle filled with the team color, initials from the team name (first letters of up to two words), and a thin inner ring. If the team has no color, one is picked from a set of 12 curated hues by hashing the team name, so it is stable |
| Sponsor logo | A rounded rectangle in `--surface-2` with the sponsor's name in the display face and a small "Sponsor" label |
| Avatar | A circle with the person's initials on a neutral tint |
| Cover image | A subtle diagonal chalk-stripe pattern in the brand color with the title set over it |

Initials always pass contrast: the badge computes whether dark or light text reads better on its fill. The same badge component draws real logos and placeholders, so swapping one for the other changes nothing else on the page.

## 8. Share images

Generated per game and per team with `next/og`, 1200 × 630, using the light theme's tokens (src/lib/share/image.tsx): both team badges, the final score in the display face, a sticker for the game's state (Final, Rained out, Live, Game day), date, field and park on a navy band, and the league mark. A team's image shows its record and place as a sticker and its last five results. The fonts are the static Latin subsets of Bricolage Grotesque 800 and Inter 600 in `assets/fonts/`, with their open-font licences, because the image engine cannot read the variable `woff2` files the pages use.

Each page links its image with a short hash of the data drawn (`?v=`). While that hash is current the image is cached for a year, so it is drawn once per change of score, status, time, place or record; any other request is cached for five minutes. Budgets, checked in `src/lib/share/image.test.tsx`: under 300 kB per image, the size above which WhatsApp drops a link preview, and a warm render under 1.5 seconds (about 75 ms measured locally). A square 1080 × 1080 variant for Instagram is still to come.
