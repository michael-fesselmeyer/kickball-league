# Roadmap

Status: draft v1, 2026-11-11. Dates assume part-time work starting the week of November 16, 2026, and a spring season that opens registration around March 1 and plays its first games around April 11, 2027 **(A: confirm with the owners)**.

## 1. The shape of the plan

The owners have not agreed to switch, so there are two deadlines, not one:

1. **The pitch** (week of February 8, 2027): a demo that makes them want it.
2. **Spring registration** (about March 1, 2027): the real thing, taking real money.

The goal is as many extras as possible in the first pass. A season cannot run without the core, and the core is also what the scheduler showpiece lives in, so it comes first. Almost every extra is in Phase 2, which finishes before the pitch. The demo deployment shows all of it with seeded data.

| Phase | Weeks | Dates | Outcome |
|---|---|---|---|
| 0. Foundation | 1 | Nov 16 – Nov 22 | An empty app deployed, with sign-in, CI and seed data |
| 1. MVP: season core | 2–6 | Nov 23 – Dec 27 | A season can be registered, paid, scheduled, played, scored and rained out |
| 2. Wow pack | 7–12 | Dec 28 – Feb 7 | The extras that sell it: subs, matching, playoffs, live scoring, events, sponsors, awards, installable app |
| Pitch | 13 | Feb 8 – Feb 14 | Owners see the demo and decide |
| Launch | 13–15 | Feb 8 – Mar 1 | Real waiver text, live Stripe, domain cut-over, spring registration opens |
| 3. In season and after | — | April 2027 on | SMS, offline scoring, sponsor portal, and the other items tagged P3 in the spec |
| Pending | — | After owner decisions | Referee marketplace and payouts, sponsorship pricing, SMS program |

If time runs short, Phase 2 items drop in the order listed at the end of that section. Nothing in Phase 1 can drop.

## 2. Phase 0: Foundation (week 1)

| Milestone | Acceptance criteria |
|---|---|
| Repository and tooling | Next.js 16, TypeScript strict, Tailwind v4, ESLint with accessibility rules, Prettier, pnpm. `pnpm dev`, `pnpm test`, `pnpm build` all work from a fresh clone |
| Database | Drizzle connected to the existing Neon project; first migration creates auth tables, `profile`, `league`; migrations run in CI |
| Auth | Sign in with Google and an email link works locally and on a preview; a session lasts 90 days and renews on use; a signed-out user visiting `/app` is redirected |
| GitHub | Public repository under `michael-fesselmeyer` with labels, milestones, issue and pull-request templates, and branch protection on `main` (pull request, passing CI, linear history, rebase merges) |
| Deploy | Production and demo projects on Vercel; every pull request gets a preview with its own database branch |
| CI | Type check, lint, unit tests, build, Playwright smoke test and Lighthouse CI run on every pull request and block merging |
| Design tokens | Colors, type and spacing from [design-system.md](design-system.md) in CSS; light and dark themes; the logo badge component renders placeholders |
| Seed | `pnpm seed` creates a league, a season, 8 teams with rosters, fields and a few played games |

## 3. Phase 1: MVP, season core (weeks 2–6)

Done means: **a commissioner could run a real 8-team season on it without touching the database.**

### Week 2: The scheduler (the showpiece first)
| Milestone | Acceptance criteria |
|---|---|
| Scheduler domain module | `generateSlots`, `generate`, `validate`, `measure`, `applyEdit`, `reschedule` implemented as pure functions per [scheduling-algorithm.md](scheduling-algorithm.md) |
| Property tests | All 14 properties pass on at least 1,000 generated inputs each; the 8-team example passes as a snapshot with spreads of 1 and 1 |
| Performance | `generate` for 24 teams over 12 dates runs in under 300 ms in the benchmark |
| Coverage | 100% line and branch coverage of the scheduler module |

Building this first, before any screen depends on it, is deliberate: it is the riskiest and most interesting part, and it needs no other feature to be tested.

### Week 3: Seasons, fields, schedule screens
| Milestone | Acceptance criteria |
|---|---|
| Season setup | An admin creates a season with dates, pricing model, roster limits, rule set and waiver |
| Fields and permits | An admin adds a venue, fields, permit windows and blackout dates; slots are generated and shown |
| Schedule admin | Generate a draft, see every fairness metric with status colors, move or swap a game by form with violations shown, publish. Publishing creates a version and a diff |
| Public pages | Schedule, team pages and game pages render from the published version; a calendar feed per team validates in Apple and Google calendars |
| Audit | Every admin action in this week's scope writes an audit row |

### Week 4: Registration, waiver, payment
| Milestone | Acceptance criteria |
|---|---|
| Profile | Gender, shirt size, birth date (under 18 is refused), emergency contact |
| Waiver | A versioned waiver is shown in full; signing stores the typed name, time, IP and a hash of the text; nobody reaches payment unsigned |
| Team registration | A captain registers a team and pays in full or chooses split pay with a fixed share |
| Invites and shares | A player opens an invite, signs, pays their share in Stripe Checkout (test mode); the roster board shows joined, signed and paid for each person |
| Free agents | A solo player registers, signs and pays; appears in the admin pool; an admin can place them on a team |
| Webhooks | Payment state changes only through the Stripe webhook; replaying the same event twice changes nothing |
| Pricing | Early-bird price applies by date; promo codes work; an admin can refund fully or partly |
| Reminders | Unpaid players get emails at 7, 3 and 1 days before the deadline |

### Week 5: Game day
| Milestone | Acceptance criteria |
|---|---|
| Score entry | A ref or captain enters a final score from a phone in under 20 seconds; forfeit and "called after N innings" are supported |
| Confirmation | The other captain confirms or disputes; an undisputed score becomes final after 24 hours; a dispute alerts admins |
| Standings | Win, loss, tie, run difference and the configured tiebreakers; a table-driven test covers each tiebreaker |
| Missing scores | The ref is reminded 30 minutes after the slot, captains after 2 hours; admins see a list |
| RSVPs | Players answer in, out or maybe; captains see counts and a fielding-rule warning computed by a tested pure function |
| Referee role | An admin assigns a ref to a game; the ref sees it on their home screen with a score button |

### Week 6: Rain-outs, content, polish, demo
| Milestone | Acceptance criteria |
|---|---|
| Rain-out | An admin picks a scope, previews affected games and proposed makeups with the fairness change, and confirms; a new version is published and only affected players are emailed, each with their own game's new time |
| Outbox | Messages are written in the same transaction as their cause; a failed send retries; nothing sends twice |
| Announcements | Admin to league, captain to team, by email, respecting preferences |
| Rulebook | The 2025 rulebook as searchable HTML with a link per rule; the old PDF URL redirects to it |
| Content and SEO | Home, About, FAQ, McCarren Park page, sitemap, robots, structured data for the league, teams and games |
| Admin dashboard | This Sunday at a glance; registrations, payments and waivers by team |
| Demo | The demo deployment has seed data, a banner, one-tap "view as" for player, captain, ref and admin, and resets nightly |
| Quality gate | Lighthouse mobile: performance ≥ 95 on public pages, accessibility 100 everywhere. Axe finds no violations on key screens. All JavaScript budgets met |
| End-to-end tests | Playwright covers: team registration with split pay, free-agent signup, generate and publish a schedule, enter and confirm a score, rain-out |

## 4. Phase 2: Wow pack (weeks 7–12)

Done means: **the demo makes the owners say yes.** Listed in build order; if time runs out, cut from the bottom.

| # | Milestone | Acceptance criteria |
|---|---|---|
| 1 | Playoffs | Seeds from standings; bracket placed on fields; winners advance as scores become final; bracket page animates and has a list alternative |
| 2 | Inning-by-inning live scoring | Runs per half-inning; the game page updates within 15 seconds; "called" games revert to the last complete inning automatically |
| 3 | Share images and WhatsApp sharing | Every final game and every team has a generated share image; one tap opens WhatsApp with the text and link; rain-out and sub notices have "copy for WhatsApp" |
| 4 | Sub finder | Post, notify eligible players, claim, approve; blocked for playoff games; the opposing captain and ref see pickups |
| 5 | Free-agent quiz and matcher | Quiz under 2 minutes; friend codes keep groups together; the matcher suggests placements with reasons and passes its own property tests; an admin can build a new team from the pool |
| 6 | Start-a-new-team request | Request, admin approval, captain notice, team created in "forming" status |
| 7 | Weather | Forecast chip on game pages; an automatic "watch" or "likely" alert to admins about 24 hours ahead; squeeze-day re-slotting |
| 8 | Events calendar | Events with RSVPs and capacity; theme weeks shown on the schedule |
| 9 | Home bar and sponsors | Sponsor pages with deals; QR check-in with a rotating code; team of the week; a simple weekly numbers view for admins |
| 10 | Fun with scores | Power rankings, streaks, rivalry history, game of the week, league records; an auto-drafted weekly recap |
| 11 | Awards voting | Weekly and season polls; one vote per player; results page |
| 12 | Installable app and push | Manifest, service worker, install prompt for captains, refs and admins; push for rain-outs, sub requests and score confirmations |
| 13 | Money, part two | Captain guarantee with saved card and deadline charge; league credit ledger at checkout; season rebate tool; waitlist with timed offers; referral credit |
| 14 | History | Past seasons with champions and final standings; team pages show all-time records |
| 15 | Motion pass | Shared-element transitions, scoreboard flips, scroll reveals, winner moments, all within budget and off under reduced motion |
| 16 | Drag-and-drop schedule board | Drag on desktop with live violations; full keyboard and form alternative |
| 17 | Team conflicts and preferences | Captains submit them before the schedule is made; the metric "preferences honored" appears |
| 18 | Shirt tracking, exports, account deletion | Sizes by team, received flag, CSV exports for rosters and payments; a player can export or delete their account |
| 19 | Passkeys and device list | A player adds a passkey and signs in with Face ID or Touch ID; the account page lists signed-in devices and can sign one out; sensitive actions ask for a fresh confirmation |
| 20 | AI: recap draft and Ask the rulebook | Hidden with no API key; every cited rule number exists in the rulebook; spend is recorded and both features switch off at the monthly cap |
| 21 | Instagram connection | An admin connects the league's Instagram account; recent posts sync on a schedule and are copied to our storage; an admin can feature, hide, tag to a team or event, or set one as a cover photo; each shown post links back to Instagram; disconnecting stops the sync |
| 22 | Search content | The city-wide landing page, the free-agent page and the "how to play kickball" guide from [seo-plan.md](seo-plan.md) |

## 5. The pitch (week 13)

| Item | Detail |
|---|---|
| What they see | The demo deployment, on a phone, as each role in turn: a player's Sunday, a captain collecting money without Venmo, a ref entering a score, a commissioner calling a rain-out |
| The three things to land | 1. Captains stop chasing payments. 2. Scores are never missing and standings are always right. 3. The schedule is provably fair, and a rain-out takes one tap |
| Leave-behind | A one-page summary and the open questions that need their answer |
| Decisions needed that day | Those marked "pitch" in [open-questions.md](open-questions.md) |

## 6. Launch (weeks 13–15)

| Milestone | Acceptance criteria |
|---|---|
| Legal text | Real waiver, terms and privacy policy supplied or approved by the league |
| Stripe live | The league's Stripe account connected; a real $1 payment and refund succeed end to end |
| Production hardening | Vercel Pro, paid email tier, Sentry alerts, a restore test from backup, rate limits verified |
| Data | Spring season, fields and permit windows entered; returning teams created with their names and colors |
| Domain | Cut over `brooklynkickballclub.com` with every old URL redirected; Search Console verified; Google Business Profile claimed |
| Dry run | One commissioner and two captains complete registration, payment, a mock game and a mock rain-out on production |
| SMS registration started | Brand and campaign submitted to Twilio with the league's details |

## 7. Phase 3 and later

In rough priority order: SMS with the full compliance design; offline score entry; sponsor portal and reports; paid event tickets; lineup and kicking-order builder; incident reports and suspensions; photo galleries; merch and jerseys; divisions with crossover games; a second park; the affiliated football league on the same deployment; corporate leagues; charity tie-in; a "friends of the league" directory.

**Pending owner approval**, designed but not scheduled: referee availability and accept or decline, compensation tracking and incentives, Stripe Connect payouts, sponsorship tiers and pricing.

### Proposals for the pending items

**Referee incentives** (base is about $20 a game today):

| Incentive | Amount | Fixes |
|---|---|---|
| On-time score bonus | +$2 when the final score is entered within 15 minutes of the game ending | Missing scores |
| Last-minute fill-in | +$10 for accepting a game within 24 hours of first pitch | Sunday-morning scrambles |
| Full-day bonus | +$5 a game when working three or more games in a day | Coverage with fewer refs |
| Reliability tier | Base rises to $25 after 10 games with no no-shows | Retention |
| Season completion | $40 for working at least 80% of game days | Late-season drop-off |
| Player-ref credit | Fees can be taken as league credit at 120% of cash value | Cheaper for the league, keeps refs playing |

**Sponsorship tiers** (starting points for the owners to adjust):

| Tier | Suggested price per season | Includes |
|---|---|---|
| Home bar (one only) | $1,500–2,500, or in kind: the team-of-the-week tab and after-game specials | Named on the home page and every game page, a sponsor page with deals, QR check-in, the weekly report, event hosting first refusal |
| Field or playoff sponsor | $500–750 | Name on a field or the bracket, logo on schedule pages, one event |
| Team sponsor | $250–400 | Logo on one team's page and share images; optionally on the jersey |
| Supporter | $100–150 | Logo on the sponsors page and one mention in the newsletter |

## 8. Portfolio checklist

| Item | Detail | Phase |
|---|---|---|
| Live URL | Production (or the demo if the league has not switched) on a custom domain | 1 |
| Demo account | One-tap "view as" player, captain, ref, admin and sponsor on the demo; no sign-up needed | 1 |
| Seed data | Realistic league, three seasons of history, played and upcoming games, a rain-out, a full bracket | 1, extended in 2 |
| README | What it is and for whom, a screenshot and a 60-second GIF, the live link, the stack and why, how to run it locally in under five commands, test and CI badges, what is next | 1 |
| Architecture write-up | These documents, linked from the README, kept current; a short "decisions" log of what changed and why | 0, ongoing |
| Scheduler write-up | A standalone article: the problem, the fixed-seat quirk, the algorithm, the property tests, the 8-team example with before and after numbers | 2 |
| Test coverage | Domain modules at 100%; overall above 80%; mutation score above 85% on the scheduler; coverage badge | 1 |
| Property-based tests | The 14 scheduler properties, plus properties for standings, pricing and the matcher | 1, 2 |
| CI | All checks on every pull request; green badge; preview deployments linked on pull requests | 0 |
| Lighthouse | Performance ≥ 95, accessibility 100, best practices 100, SEO 100 on public pages; scores in the README with the date measured | 1 |
| Accessibility | WCAG 2.2 AA; axe in CI; a short accessibility statement page; one manual screen-reader pass per phase | 1, 2 |
| Real users | The league uses it for a real season, with numbers: registrations processed, payments collected, messages delivered | Launch |
| Commit history | One issue per 30–60 minute slice, one pull request per issue, small Conventional Commits, rebase merges so every commit lands on `main` | Ongoing |
| Security notes | A section in the README on payments, permissions, webhooks and personal data | 1 |
| Case study | One page: the problem, your role, three hard decisions, results | After launch |
