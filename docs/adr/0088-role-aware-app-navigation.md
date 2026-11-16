# ADR 0088: Role-aware app navigation with a tab bar and a native popover menu

- Status: accepted
- Date: 2026-11-16

## Context

The signed-in home had grown into a stack of full-width link buttons: 17 for a player and more for captains, refs and admins, with sign-out at the bottom. On a phone the next game and anything waiting on the player were lost among them, and the League admin home had 37 tool buttons above its dashboard. Every `/app` screen had no way to move around except the browser's back button.

The navigation has to fit the rules every page already follows: server components by default, client JavaScript inside each route's budget (score entry has the smallest, 45 kB of our own), 44px targets, and Lighthouse accessibility at 100.

## Decision

**Every `/app` screen gets a tab bar and a grouped menu from `src/app/app/layout.tsx`, built from what the person may open.**

- **Tabs.** Home, Schedule, Team and Menu: fixed to the bottom of a phone with safe-area padding, a bar under the header from 768px. The body gets bottom padding the bar's height whenever the bar is on the page (`body:has(.app-nav)`), so it never covers the end of a page. The bar streams in behind a placeholder of the same size, so nothing shifts.
- **Menu.** A native `popover="auto"` element opened by `popovertarget` buttons: a bottom sheet on a phone, a panel from the right on a wider screen. The browser closes it on Escape and on a tap outside, keeps it out of the accessibility tree while closed, and puts it in the top layer. It is a non-modal dialog, so there is no focus trap. The only script is a few lines that close it when a link inside is followed (a client-side navigation keeps the layout, so the popover would otherwise stay open) and mark the current tab.
- **Groups follow roles.** `appNav` (`src/domain/nav/app-nav.ts`, pure and unit-tested) turns the person's seasons and permission checks into tabs and groups: My season, Game day, League life, Help and Account for anyone who plays; Captain for each team they captain; Referee for refs; League admin for admins; Owner for owners and the operator. Roles add groups and never switch views, so an admin who refs sees both. Staff with no team get no player groups, and Team becomes Admin or Reffing. Each link's condition is the same permission check its page makes.
- **Home is a dashboard.** The next game (with game-day links when they apply), a "Needs you" list built from the data the page already loads, the person's seasons and season card, gear, games to referee and, for admins, a "Running the league" card.
- **League admin** keeps six everyday tools in sight and folds the rest into a native `<details>` grouped by job.

## Alternatives considered

- **A JavaScript drawer with a focus trap.** More code in every `/app` route, including score entry, to rebuild what the popover gives for free. A modal trap is also wrong for a short list of links that people dismiss by tapping away.
- **`<details>` for the menu.** No Escape or tap-outside close without script, and it pushes content instead of overlaying it.
- **Switching views by role** (a "captain mode"). People with two roles would have to switch back and forth, and it hides the player's own items from a captain who is also a player.
- **A nav slot in the root header.** The root layout serves static public pages, which never read who is signed in, so the signed-in bar lives in the `/app` layout instead.

## Consequences

- A new `/app` page is in the tab bar's reach with no work; a new destination worth a menu link is one line in `appNav` with its permission condition and a unit test.
- The popover needs a current browser (Safari 17, Chrome 114, Firefox 125). In an older one the Menu button does nothing; the tabs and each page's own links still work.
- Flows that used a home link now open the menu with the `e2e/support/app-nav.ts` helpers.
