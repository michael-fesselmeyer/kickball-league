# UX structure pass

Status: plan, 2026-11-15. Structure only: navigation, page templates, components and density. Colors, fonts and visual style are decided separately and are out of scope; every change here uses the current tokens in [design-system.md](../design-system.md).

## 1. Why

The app grew feature by feature, and each screen invented its own layout. What players and admins meet today:

| Finding | Evidence in the code |
|---|---|
| No app navigation. The documented bottom tab bar ([information-architecture.md](../information-architecture.md), Navigation) was never built. The header is the league name and the theme switch; everything else is reached from the signed-in home or the footer | `src/app/layout.tsx`; there is no `src/app/app/layout.tsx` |
| The signed-in home is a stack of buttons. Up to about 25 full-width links, up to 7 of them primary, in the order they were added: "League shop" sits beside "Emergency contacts for today's game" | `src/app/app/page.tsx` |
| The admin home opens with 30 equal buttons in a wrapping row, then owner links, then the content | `src/app/app/admin/page.tsx`, "Admin tools" |
| Each page sets its own width and spacing: 41 different `<main>` class lists, widths from `max-w-sm` to `max-w-6xl`, gaps from 4 to 12 | `grep '<main className' src/app` |
| Back links are free text: "Back to your home screen", "← League admin", "Back to the team", in different places on the page | `grep 'Back to' src/app/app` |
| Notices are hand-drawn: about 250 `rounded-lg border border-{success,danger,warning} p-3` boxes, while `FlashMessage`, which announces and takes focus correctly, is used in few places | `src/components/flash-message.tsx` |
| Captain tools hide in a row of underlined links inside the team page's title area | `src/app/app/seasons/[season]/team/page.tsx` |
| Signed-in screens have no route loading or error boundary, so a slow query shows nothing until it arrives | no `loading.tsx` or `error.tsx` under `src/app/app` |

Nothing here is broken; it is busy and inconsistent. The fix is a small number of shared structures used everywhere, not a redesign of each screen.

## 2. Principles

1. **One thing first.** Every screen answers "what do I do now?" with one primary action. At the field that is RSVP, score, check in or pay.
2. **Few destinations, always in the same place.** A player never needs the footer to find their team.
3. **Role adds depth, not clutter.** Captains, refs and admins get more inside the same destinations, not more top-level buttons.
4. **Progressive disclosure.** Rare or risky tools (exports, merges, audit, data download) sit one level down, grouped, never on the first screen.
5. **Same shape, same place.** A list looks like a list, a form like a form, on every screen. Back is always top-left; the primary action is always in the same spot.
6. **Phone first, at the field.** One hand, bright sun, poor signal. Targets stay 44px; primary actions on task screens sit within thumb reach.
7. **Fast stays fast.** Public pages remain static HTML that reads no cookies. Role-aware chrome lives only under `/app`, which is already per-request.

### Patterns borrowed (not brands)

Patterns that well-made consumer and sports apps share, adopted here as generic conventions:

- **Tab bar of 3–5 destinations on phones**, the same set on every screen, with the current one marked (platform guidelines for both major phone systems agree on 3–5).
- **"My team first" home**: the next game as a large card with its one action, then what needs attention, then everything else as a short list.
- **Grouped settings lists** for deep tool sets: section headings, one row per tool, a chevron, a one-line subtitle. This is how the admin tool wall becomes navigable.
- **Segmented tabs inside a detail page** (Roster, RSVPs, Payments, Subs) instead of more pages or more buttons.
- **Sticky bottom action bar** on task screens (score entry, checkout, check in).
- **Status chips with words** (Paid, Waiver signed, Live) instead of colored boxes.

## 3. Navigation model

### 3.1 Public (static, no session)

The public header cannot know who is signed in, so it is the same for everyone.

| Width | Header | Elsewhere |
|---|---|---|
| Phone | League mark (home), a **Join** button, a **Menu** button that opens a sheet: Schedule, Standings, Teams, Events, Rules, FAQ, then "Sign in / Open the app" | Footer keeps the long list (About, Parks, Friends, Sponsors, History, Help, Contact) |
| Desktop (≥ 768px) | Mark, then Schedule, Standings, Events, Rules, FAQ inline; **Join** and **Sign in** on the right | Same footer |

- "Schedule" and "Standings" go to the current season (resolved at build, as the home page does today).
- The menu sheet is a `<details>` or a `popover` element with no client JavaScript, so the public route budgets do not move.
- The theme switch moves into the menu sheet and the footer.

### 3.2 Signed in (`/app`, per request)

A new `src/app/app/layout.tsx` adds the app shell. The public header stays above it, slimmed to the mark and an account button.

| Tab | Who | Goes to | Holds |
|---|---|---|---|
| **Home** | Everyone | `/app` | Next game and its action, what needs attention, then shortcuts |
| **Schedule** | Everyone | My season's schedule, my team highlighted | Schedule, standings and bracket as segmented tabs |
| **Team** | Anyone on a roster; otherwise "Join" | `/app/seasons/<current>/team` | Roster, RSVPs, and for captains Payments, Subs, Messages |
| **Admin** | Admins and owners only | `/app/admin` | The admin hub (3.3) |
| **More** | Everyone | `/app/more` (new) | Grouped list: Me (profile, alerts, away weeks, card), League (events, shop, pick'em, awards, photos, volunteer, sub for a team), Help and safety (raise a concern, help, sign out), Reffing (refs only), Sponsor page (sponsors only) |

- Four tabs for players, captains and refs; five for admins. Refs get their assignments on Home (they are time-bound) and the ref page under More; they do not get a tab.
- Phone: a bottom tab bar, fixed, respecting `env(safe-area-inset-bottom)`, each tab an icon and a word. Desktop: the same items as a top nav row under the header; admin pages add the left sidebar (3.3).
- The current tab is marked with `aria-current="page"`. The only client code is a tiny component that reads the path for that marker; the rest of the shell is server-rendered.
- Screens that are a single task (score entry, live scoring, checkout return, check-in, waiver signing) hide the tab bar and show a top bar with a close or back button and the sticky action bar instead, so nothing competes with the task.

### 3.3 Admin hub

The 30-button row becomes a hub of grouped rows. On desktop the same groups form a left sidebar on every admin page; on phones the Admin tab opens the hub, and each admin page has a back link to it.

| Group | Rows |
|---|---|
| **Today** | Game day, Print game-day pack, Rain-out, Scores |
| **Season** (with a season picker at the top) | Setup and checklist, Schedule, Registrations, Free agents and waitlist, Referees, Divisions, Playoffs, Awards and team of the week, Shirts, Survey, Recap and rollover |
| **People** | Waivers, Incidents, Not-on-my-team lists, Accounts (merge), League credit |
| **League content** | Events, Rules, Announcements, Pick'em, Photos, Instagram, Friends, Private leagues and tournaments, Volunteer shifts, League gear, Merch, Sponsors |
| **Money and permits** (owners) | Owner dashboard, Books, Permits, Rebates, Promo codes |
| **Records** | Audit log, All seasons, Download all league data (owners) |

- The admin home's first screen is the work, not the menu: the next game day card, the checklist, missing scores and waiting requests, each with one action. The hub list sits below on phones and in the sidebar on desktop.
- Problems that need an admin (Instagram disconnected, permits missing) show as one "Needs attention" list at the top, each row linking to its fix, instead of separate boxes.

## 4. Page templates

Four templates cover every screen. Each is a server component wrapper in `src/components/page/`, so pages stop writing their own `<main>`.

### 4.1 Shared header (`PageHeader`)

```
‹ Parent                        (back link, always top-left, names the parent)
EYEBROW (optional: season or team)
Page title                      [Primary action]   ← right of the title from md up
One sentence on what this page is for. (optional)
[Tab] [Tab] [Tab]                (optional segmented tabs)
```

- The back link is a real link to the parent in the hierarchy, not browser history, labelled with the parent's name ("‹ Admin", "‹ Your team").
- On phones the primary action sits under the description, full width; on task screens it moves to the sticky action bar.
- Help links (`HelpLink`) sit at the end of the description line, not as a separate block.

### 4.2 Widths (`PageShell`)

| Size | Max width | Used for |
|---|---|---|
| `narrow` | 28rem (`max-w-md`) | Forms, sign-in, score entry, check-in, permit |
| `standard` | 42rem (`max-w-2xl`) | Detail pages, home, team, most of `/app` |
| `wide` | 56rem (`max-w-4xl`) | Lists and tables, admin pages, reports |
| `full` | 64rem (`max-w-5xl`) | Schedule grid and board, bracket |

One padding (`px-4 md:px-6`, `py-6 md:py-10`) and one section gap (`gap-8`). This replaces the 41 variants.

### 4.3 Templates

| Template | Shape | Primary action | Examples |
|---|---|---|---|
| **List** | Header, optional filter row (chips or a select, sticky on phones), then rows (`ListRow`) or a table that stacks on phones | "New …" or "Invite" in the header | Schedule, registrations, events, incidents, audit |
| **Detail** | Header with eyebrow, a summary card (status, key numbers), then sections; secondary tools in an overflow "More actions" disclosure | The one thing to do now (RSVP, Pay, Confirm) | Team, game, event, incident review |
| **Form** | Narrow; fields in groups with a heading each; a multi-step flow shows "Step 2 of 4" in the header; errors summarised at the top and tied to fields | Submit at the end; sticky on phones when the form is longer than a screen | Register, waiver, profile, new event, rain-out |
| **Dashboard** | Wide; "Needs attention" first, then summary cards in a grid (one column on phones), then lists with "See all" | None in the header; each card has its own | Signed-in home, admin home, game day, owner dashboard |

### 4.4 States

Every template defines all three, with shared components:

- **Loading.** A `loading.tsx` per signed-in area (`/app`, `/app/admin`, `/app/seasons/[season]/team`, `/app/games/[game]`) built from `PageLoading` with the template's skeleton: the header and the first card's height, so nothing jumps. Public prerendered pages keep painting without a loading state ([ADR 0029](../adr/0029-season-pages-paint-without-a-loading-state.md)).
- **Empty.** `EmptyState`: one sentence on why it is empty, one on what happens next, and at most one action. The copy style in information-architecture.md stays.
- **Error.** An `error.tsx` for `/app` and `/app/admin` with what went wrong in plain words, a Try again button and a link home. Form errors stay inline.

## 5. Component inventory

| Component | Action | Replaces |
|---|---|---|
| `PageShell`, `PageHeader` | **New** | 41 `<main>` variants, free-text back links, title blocks |
| `AppTabBar`, `AppNav` (desktop row), `AdminSidebar` | **New** | The home button stack and the admin tool wall |
| `ListRow` (title, subtitle, trailing status or chevron; a link or a button) | **New** | Full-width secondary buttons used as navigation (home, More, admin hub, captain tools) |
| `Section` (h2, optional "See all" link) | **New** | Hand-written `section` + `h2` pairs |
| `Notice` (kind: info, success, warning, danger; optional action link) | **New**, merged with `FlashMessage` (which becomes `Notice` with `focusOnMount`) | About 250 inline bordered boxes, `GameDayNotice`, the Instagram warning |
| `StatusChip` (word plus tone) | **New**, built from the existing chip styles | Ad-hoc "Paid", "Waiver", "Live" spans |
| `ActionBar` (sticky bottom, safe-area aware) | **New** | Pinned buttons written per page (score, checkout, roster board) |
| `Tabs` (links between sub-routes, `aria-current`) | **New** | Captain tool links, schedule/standings/bracket switching |
| `EmptyState` | **New** | Per-page empty paragraphs |
| `GameDayNotice`, `RainDecisionCard` | **Fold** their frames into `Notice`; keep their content | Three different notice frames on game day |
| `ChecklistCard`, `SeasonCard`, `EventCard`, `GameCard` | **Keep**, adopt `Section`, `ListRow` and `StatusChip` inside | — |
| `SignupBoard`, `MoneySummary`, `Bracket`, `LineScore`, `LiveScore` | **Keep** | — |
| `DemoBanner`, `DemoAdminTools` | **Keep**, demo only | — |
| Footer link list in the root layout | **Trim** to the long-tail links; the main ones move to the header | — |

No new color, font, radius or shadow tokens. New components use `--surface`, `--border`, `--text-muted` and the existing `btn` utilities.

## 6. Density rules

1. **One primary button per screen** (`btn-primary`). Everything else is secondary, a `ListRow`, or a link. The signed-in home has one: the next game's action, or Register when there is no game.
2. **Navigation is not a button.** Moving to another screen is a `ListRow` or a tab; buttons do things.
3. **At most three cards above the fold on phones** on a dashboard: next game, needs attention, then one more.
4. **Conditional prompts collapse into "Needs attention".** Vote for awards, take the survey, pay your share, sign the waiver, permit for today: one list, each row a sentence and a chevron, newest deadline first. Nothing that has no deadline belongs there.
5. **Admin depth goes down, not across.** A tool used less than weekly lives in the hub, never on the admin home.
6. **Destructive and rare actions go under "More actions"** (a disclosure at the end of a detail page): delete, merge, export, take down.
7. **Explanations shrink to one line** with a help link; long how-it-works copy moves to the help pages or a closed `<details>`.
8. **Tables stack on phones** into rows of label and value; no sideways scrolling except the bracket board and the schedule grid.

## 7. Screen changes, in priority order

| # | Screen | Before | After |
|---|---|---|---|
| 1 | **App shell** (all of `/app`) | No navigation; every screen reached from home or the footer | Tab bar (phone) and nav row (desktop): Home, Schedule, Team, (Admin), More. Single-task screens hide it |
| 2 | **Public header** | Name and theme switch; all links in the footer | Mark, Join, Menu sheet (phone); inline links (desktop) |
| 3 | **Signed-in home** `/app` | Up to 25 stacked buttons, 7 primary, then sign out | Dashboard: next game card (RSVP or Score or Check in as its one action; permit, checklist and emergency contacts as rows inside it on game day), Needs attention list, Your season card, then a short Shortcuts list. Shop, events, volunteer, photos, profile and sign out move to More |
| 4 | **More** `/app/more` (new) | — | Grouped `ListRow`s; replaces the bottom half of home |
| 5 | **Admin home and hub** `/app/admin` | 30 buttons, owner links, data download, then content | Season picker in the header, Needs attention, next game day, checklist, missing scores, sign-ups; the hub as grouped rows (phone) or sidebar (desktop) |
| 6 | **Team page** `/app/seasons/[season]/team` | Title with a row of captain links, then challenge, invite, roster, sportsmanship and games stacked | Detail template; header with team badge and record; tabs Roster, Games, and for captains RSVPs, Payments, Subs, Messages (sub-routes that exist today become tabs); invite becomes the header action for captains; challenge and sportsmanship become sections under Roster |
| 7 | **Score entry** `/app/games/[game]/score` | Heading, history and forms in one long page | Task screen: no tab bar, close button, the two counters, the confirm or submit in the `ActionBar`; history behind "Earlier reports" |
| 8 | **Live scoring** `/app/games/[game]/live` | Its own layout | Task screen with the same top bar and `ActionBar` |
| 9 | **Admin game day** `/app/admin/today` | Heading with an underlined back link, buttons above the board | Dashboard template; weather, rain-out and announcement as one action row; the per-game cards keep their shape with `StatusChip`s |
| 10 | **Schedule, standings, bracket** (public and the Schedule tab) | Three pages linked from one another in text | Shared `Tabs` under the season header; filter row sticky on phones |
| 11 | **Registration and checkout** `/app/seasons/[season]/register`, waiver, quiz | Separate pages with their own headers | Form template with "Step N of M" (profile, waiver, quiz for free agents, pay); the payment step's summary uses `StatusChip`s; return from checkout lands on the team page with a success `Notice` |
| 12 | **Game page** (public) | Content stack | Detail template: score card, then where and when, then line score; share in the header |
| 13 | **Ref home** `/app/referee` | Own list styles | List template; today's games as `ListRow`s with Accept or Score |
| 14 | **Remaining admin screens** (about 40) | Own widths, back links and notices | `PageShell`, `PageHeader` and `Notice` adopted mechanically, one area per pull request |
| 15 | **Profile** `/app/profile` | One long page of forms | Sections with headings in the order people use them: name and contact, alerts, away weeks, security, delete account last under More actions |

## 8. Delivery (Phase 2)

Starts only when the merge and schema queues have drained, since nearly every screen has an open pull request. Each step is one pull request in one area, with its e2e selectors updated, axe clean at phone width, the route JS check passing and Lighthouse budgets kept.

1. **Primitives.** `PageShell`, `PageHeader`, `Section`, `ListRow`, `Notice` (with `FlashMessage` folded in), `StatusChip`, `EmptyState`, `ActionBar`, `Tabs`, with unit and axe tests. No screen changes. Design system section 5 updated.
2. **App shell.** `src/app/app/layout.tsx` with the tab bar and desktop nav, `/app/more`, `loading.tsx` and `error.tsx` for `/app`. Information architecture Navigation updated. Check the shell's client code against the signed-in route budget.
3. **Public header.** Menu sheet without client JavaScript; footer trimmed. Lighthouse runs on every public page.
4. **Signed-in home.** Dashboard template, Needs attention, shortcuts moved to More.
5. **Admin hub and sidebar**, admin `loading.tsx` and `error.tsx`.
6. **Team page tabs.**
7. **Game day**: score entry, live scoring, ref home, admin game day.
8. **Registration flow** steps.
9. **Sweep**: remaining screens adopt the templates, one feature area per pull request (seasons admin, people admin, content admin, money and permits, public content pages).

E2E selectors already use roles and names; where a button becomes a `ListRow` link or moves into More, the spec's locator changes from a button to a link in the same pull request.

## 9. Out of scope

Colors, fonts, iconography style, illustration, motion changes and copy rewrites beyond labels that move. Those follow once a visual direction is chosen and apply on top of this structure.
