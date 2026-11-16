# Acceptance checklist

A volunteer's walk through the whole app, one row per acceptance criterion: every row of the [roadmap](../roadmap.md) for Phase 0, the MVP, Phase 2 and the Phase 3 items that have shipped, every goal in [product-spec.md](../product-spec.md) section 9 that has shipped, and the features in the README's Features list that landed after those. Results for each run are in [results.md](results.md).

How to run it:

- A production build (`npm run build`, then `npm run start`) on a seeded local Postgres whose name contains `demo`, with demo mode on, so each role is one tap away with "view as". Stripe calls go to stripe-mock, and payments are confirmed with a signed test webhook, as in `e2e/support/stripe-webhook.ts`.
- People who aren't demo personas (a seeded captain, a new player) sign in with a one-time email link, made the way `e2e/support/sign-in.ts` makes it.
- Every screen at phone size (375 × 812) unless the row says desktop; spot checks in the dark theme.
- Rows marked **repo** are checked from the repository and its CI, not in the browser.

Roles: **visitor** (signed out), **player** (Pat Player), **captain** (Casey Captain), **ref** (Reese Ref), **admin** (Addie Admin), **owner**, **operator** (the platform operator, Addie in this setup), **sponsor** (a sponsor's own person), **new** (a made-up person with no account yet).

## Phase 0: Foundation

| ID | Area | Role | Steps | Expected |
|---|---|---|---|---|
| P0-1 | Tooling | repo | Fresh worktree: `npm run build`, `npm test` | Both succeed; TypeScript strict, ESLint with accessibility rules, Prettier configured |
| P0-2 | Database | repo | Create an empty database and run `npm run db:migrate` | Every migration applies; CI runs migrations |
| P0-3 | Sign-in | visitor | Open `/sign-in`, ask for an email link, open the link | Signed in and taken to `/app`; Google button shown only when configured |
| P0-4 | Session guard | visitor | Open `/app` signed out | Redirected to sign-in, and back to `/app` after signing in |
| P0-5 | Session length | repo | Read the auth config | Session lasts 90 days and renews on use |
| P0-6 | GitHub | repo | `gh` repo view, labels, templates, ruleset | Public repo with labels, issue and PR templates, `main` protected (PR, CI, linear history, rebase) |
| P0-7 | CI | repo | Latest `main` CI run | Type check, lint, unit tests, build, Playwright and Lighthouse run and are required |
| P0-8 | Design tokens | visitor | Open `/style` in light and dark | Colors, type and spacing from the design system; both themes readable; logo badge placeholder renders |
| P0-9 | Seed | repo | `npm run seed` | A league, a season, 8 teams with rosters, fields and played games |

## MVP: scheduler (week 2)

| ID | Area | Role | Steps | Expected |
|---|---|---|---|---|
| M2-1 | Scheduler module | repo | Run the scheduler unit and property tests | All pass, including the 14 properties and the 8-team snapshot |
| M2-2 | Scheduler speed | repo | `npm run bench` | 24 teams over 12 dates under 300 ms |
| M2-3 | Scheduler coverage | repo | `npm run test:coverage` | 100% line and branch coverage of the scheduler module |

## MVP: seasons, fields, schedule (week 3)

| ID | Area | Role | Steps | Expected |
|---|---|---|---|---|
| M3-1 | Season setup | admin | Admin, Seasons, New season: name, dates, pricing, roster limits, rule set, waiver | Season saved and listed; its settings page shows what was entered |
| M3-2 | Fields and permits | admin | A season's Fields: add a venue, field, permit window and a blackout date | Slots are generated and shown; the blackout date has none |
| M3-3 | Schedule draft | admin (desktop) | A season's Schedule: generate a draft | Draft shows every fairness metric with a status color; games that could not be placed say why |
| M3-4 | Edit by form | admin | Move one game and swap two by form | Violations shown before saving; saving makes a new draft |
| M3-5 | Publish and diff | admin | Publish the draft | A new version with a diff of what changed |
| M3-6 | Public schedule | visitor | `/seasons/<season>/schedule`, filter by team | Only published games; team filter works from the path |
| M3-7 | Team page | visitor | A team page | Record, next game, results, roster with first name and last initial |
| M3-8 | Game page | visitor | A game page | Time, field, score on a final |
| M3-9 | Team calendar | visitor | Open a team's `calendar.ics` | A valid calendar file with every published game in the league's time zone |
| M3-10 | Audit | admin | Admin, Audit log after the steps above | Each admin action listed in plain words, newest first |

## MVP: registration, waiver, payment (week 4)

| ID | Area | Role | Steps | Expected |
|---|---|---|---|---|
| M4-1 | Profile | player | Profile: gender, shirt size, birth date, emergency contact | Saved; an under-18 birth date is refused with a clear message |
| M4-2 | Waiver | new | Register for the open season; reach the waiver | Full waiver text shown; typed name required; payment not reachable before signing |
| M4-3 | Team registration | new | Register a team, choose split pay | Team created with the new person as captain; fixed share shown; Checkout opens |
| M4-4 | Full pay | new | Register a team and pay in full | Checkout for the whole fee; team confirmed after the webhook |
| M4-5 | Invite and share | new | Open the captain's invite link, sign, pay share | Joins the roster; roster board shows joined, signed and paid for each person |
| M4-6 | Free agent | new | Register as a free agent, sign, pay | Appears in the admin free-agent pool |
| M4-7 | Place free agent | admin | Free agents: place one on a team | Player moves onto the roster |
| M4-8 | Webhook | repo | Replay one signed webhook event twice | Payment state changes once |
| M4-9 | Early bird and promo | new | Register with a promo code before the early-bird date | Early-bird price applied, then the code's discount; Checkout charges the lower price |
| M4-10 | Refund | admin | Registrations: refund one payment in part | Asks for a recent sign-in; refund recorded and audited |
| M4-11 | Payment reminders | repo | Reminder job tests | Unpaid players reminded 7, 3 and 1 days before the deadline |

## MVP: game day (week 5)

| ID | Area | Role | Steps | Expected |
|---|---|---|---|---|
| M5-1 | Score entry | ref | Home, a game waiting for a score, enter a final | Done in a few taps at phone size; forfeit and "called after N innings" offered |
| M5-2 | Confirm or dispute | captain | Home or the game: confirm or dispute the reported score | Confirm makes it final; dispute alerts admins |
| M5-3 | Standings | visitor | `/seasons/<season>/standings` | Wins, losses, ties, run difference; tiebreaker notes; a newly final score counted |
| M5-4 | Missing scores | admin | Admin, Scores | A list of games past their slot with no score |
| M5-5 | RSVP | player | Home: answer in, out, maybe for the next game | Answer saved and shown |
| M5-6 | RSVP counts | captain | Team page: next game counts | In/out/maybe counts and a fielding-rule warning when short |
| M5-7 | Ref assignment | admin | Referees: assign a ref to a game | The ref sees it on their home screen with a score button |

## MVP: rain-outs, content, demo (week 6)

| ID | Area | Role | Steps | Expected |
|---|---|---|---|---|
| M6-1 | Rain-out | admin | Rain-out: pick a game day, preview, confirm | Affected games and proposed makeups with the fairness change; a new version published; only affected players emailed with their own new time |
| M6-2 | Outbox | repo | Outbox tests | Written in the same transaction; retries; never twice |
| M6-3 | League announcement | admin | Announcements: send to the league | Sent through the outbox; respects each person's settings |
| M6-4 | Team announcement | captain | Team announcements: send to the team | Sent to teammates only |
| M6-5 | Rulebook | visitor | `/rules` | Searchable rulebook with a link per rule; old PDF URL redirects (the rulebook text stays out of the repo until the league agrees, see AGENTS.md) |
| M6-6 | Content pages | visitor | Home, About, FAQ, park page | Each loads with the league's details; no broken links |
| M6-7 | SEO | visitor | `/sitemap.xml`, `/robots.txt`, structured data on home, team and game pages | Valid sitemap and robots; JSON-LD present |
| M6-8 | Admin dashboard | admin | Admin home | Next game day at a glance; registrations, payments and waivers by team |
| M6-9 | Demo | visitor | Any page in demo mode | Banner on every page; one-tap "view as" player, captain, ref, admin |
| M6-10 | Accessibility and speed | repo | Latest Lighthouse and axe runs in CI | Budgets met; axe finds no violations on key screens |
| M6-11 | End-to-end tests | repo | Latest e2e run on `main` | Registration with split pay, free agent, publish, score, rain-out all covered and green |

## Phase 2: wow pack

| ID | Area | Role | Steps | Expected |
|---|---|---|---|---|
| P2-1 | Playoffs | admin, visitor | Admin, Playoffs: seed and publish; open the bracket page and its list view | Seeds from standings; rounds placed on fields; bracket animates and has a list view |
| P2-2 | Live scoring | ref, visitor | Live: enter runs per half-inning; watch the public game page | Line score updates within 15 seconds without reload; "called" reverts to the last complete inning |
| P2-3 | Share images | visitor | A final game and a team: share image and WhatsApp button | 1200 × 630 image; WhatsApp link with text and link; copy button |
| P2-4 | Copy for WhatsApp | admin | Rain-out notice and a sent announcement | "Copy for WhatsApp" gives one message |
| P2-5 | Sub finder | captain, player | Captain asks for subs; an eligible player claims; captain approves | Claim holds a spot; approved pickup visible to both captains and the ref; not offered for playoff games |
| P2-6 | Free-agent quiz | new | Free agent: take the quiz, share a friend code | Quiz under two minutes; friend code shown |
| P2-7 | Matcher | admin | Free agents: see suggestions, apply one, build a new team | Suggestions with reasons; new team from the pool with a captain |
| P2-8 | New-team request | player, admin | Player requests a new team; admin approves | Team created in "forming" status with the requester as captain; requester notified |
| P2-9 | Weather | visitor, admin | Upcoming game page; admin alerts | Forecast chip (or a quiet fallback with no network); rain alert links to the rain-out screen |
| P2-10 | Events and RSVP | player | Events: RSVP to a public event; a full event | RSVP saved; waitlist with place in line when full |
| P2-11 | Theme weeks | visitor | Public schedule | Theme weeks marked on their game days |
| P2-12 | Sponsors | visitor | `/sponsors`, a sponsor page | Home bar first; deals with confirmed dates; team of the week |
| P2-13 | QR check-in | player | Check in with the sponsor's current code | Check-in counted once a day; deal used once |
| P2-14 | Weekly numbers | sponsor, admin | Sponsor report | Counts by week, no names |
| P2-15 | Fun with scores | visitor | Standings (power rankings, game of the week), team page (streaks, rivalry), `/records` | All render from the seeded games |
| P2-16 | Weekly recap | admin | Recap: draft, edit, send | Draft from templates; sent as an announcement |
| P2-17 | Awards voting | admin, player | Open a poll; player votes; close; results | One vote per player; never for self or own team; no counts while open; results ranked after close |
| P2-18 | Installable app | visitor | Manifest and service worker; `/offline` | Manifest with icons and theme colors; offline page; install prompt for captains, refs, admins on second visit |
| P2-19 | Push settings | player | Profile: push topics | Per-topic push opt-in shown (off until VAPID keys are set) |
| P2-20 | Captain guarantee | captain | Team page: fee, paid, left; pay the rest; save a card | Numbers add up; Checkout for the rest |
| P2-21 | League credit | player | Account: credit balance and history; checkout with credit | Balance and history shown; credit applied and can be unticked |
| P2-22 | Rebates | admin | Rebates screen | Teams' lost games and money; issue rebates as credit |
| P2-23 | Waitlist | captain | Full season: join waitlist | Place in line shown; held spot when one opens |
| P2-24 | Referral | new | Open `/r/<code>`, register and pay | Referrer gets $10 credit |
| P2-25 | History | visitor | `/history`, a team page | Past seasons with champions and standings; team's all-time record and titles |
| P2-26 | Motion | visitor | Schedule to game page and back; reduced motion | Transitions play; off under reduced motion |
| P2-27 | Schedule board | admin (desktop) | Board: drag a game, keyboard move, save | Live violations while held; keyboard works; saves as one draft |
| P2-28 | Conflicts and preferences | captain, admin | Team requests; schedule metrics | Captain submits dates and times; "preferences honored" metric shown |
| P2-29 | Shirts | admin | Shirts screen | Sizes by team; to-order list; received flag |
| P2-30 | CSV exports | admin, captain | Download rosters and payments | CSV with shirt sizes; formula-looking cells as text |
| P2-31 | Data export and deletion | player | Profile: download data; delete account | JSON download; deletion needs recent sign-in and the email typed |
| P2-32 | Passkeys and devices | player | Security: list devices, sign one out; add passkey | Devices listed; sign-out works; passkey add asks for fresh sign-in |
| P2-33 | Instagram | admin, visitor | Connect (recorded fixture), sync, feature a post, set a cover | Featured post on home linking to Instagram; disconnect stops sync |
| P2-34 | Search content | visitor | `/nyc-kickball-league`, `/free-agents`, `/news/how-to-play-kickball` | Each loads with metadata and structured data; linked from home and sitemap |

## Phase 3 items that have shipped

| ID | Area | Role | Steps | Expected |
|---|---|---|---|---|
| P3-1 | Offline score entry | ref | Score screen with the network off; enter; back online | "Saved on this phone"; sent when back online; server's score wins on conflict |
| P3-2 | Sponsor portal | sponsor, admin | Admin adds a sponsor and gives access; sponsor edits a deal and confirms | Deal changes show on the sponsor page with the confirmed date |
| P3-3 | Paid event tickets | player, admin | Buy a ticket; admin checks in by code; refund | Spot held while paying; code shown; refund returns the spot |
| P3-4 | Kicking order | captain, player | Lineup: build an order; auto-arrange; player sees spot | Gender rule checked with plain explanations; auto-arrange valid |
| P3-5 | Incidents and suspensions | ref, admin | Report an incident; admin suspends | Suspended player can't RSVP in or claim subs; captain sees "suspended" only |
| P3-6 | Sportsmanship | captain, admin | Rate the other team after a final | Admin sees averages; captain sees blocks of three |
| P3-7 | Member photos | player, admin | Upload a photo tagged to a game; admin approves | Shows on the game or team page; player can delete it |
| P3-8 | Merch | player, admin | Shop: order an item; admin fulfils | Stock never oversells; CSV for the printer |
| P3-9 | Divisions | admin, visitor | Divisions screen; division schedule page | Divisions with rule sets; crossover games marked; standings per division |
| P3-10 | Friends directory | visitor, admin | `/friends`; admin adds an entry | Grouped by activity; https links only; "Link to us" snippet |

## Product spec section 9 goals that have shipped

| ID | Area | Role | Steps | Expected |
|---|---|---|---|---|
| S9-1 | Fast sign-up | new | Phone size: sign in, register, pay | Under two minutes from sign-in to paid |
| S9-2 | One account, installable | player | Install prompt / manifest | PWA shares the browser's sign-in |
| S9-3 | Opt out | player | Profile: email topics; an email's unsubscribe link | News off by default; one-click unsubscribe per topic; game-critical can move to push or site only |
| S9-4 | Alerts that fit | player | Profile: daily limit, digest, quiet hours | Settings present with defaults; each message says why |
| S9-5 | Money summary | owner, visitor | Preview and publish a season's money summary | Category totals only; 404 until published |
| S9-6 | Off-app payments | captain, admin | Record a cash or Venmo payment | Counted toward the team's total with a note and who recorded it |
| S9-7 | Events with invite link | admin | Event with a Partiful link and a chosen audience | "RSVP on partiful.com" shown; members-only events not public |
| S9-8 | Specials stay current | sponsor | Portal: confirm deals | Confirmed date updates on the sponsor page |
| S9-9 | Owners' books | owner | Books: add an expense with a receipt; CSV | Money in from payments; expense listed; CSV without names |
| S9-10 | Owner dashboard | owner | Owner dashboard | Membership, money, completion, turnout and check-ins |
| S9-11 | Permits | owner | Permits: add a permit; "What to request" | Permit with cost and renewal; request sheet |

## Features shipped since

| ID | Area | Role | Steps | Expected |
|---|---|---|---|---|
| F-1 | Age check | new | Register with a birth date under the season's minimum | Friendly message instead of the form; "I'm 18 or older" confirmation otherwise (or the season's minimum) |
| F-2 | Captain handoff | captain, player | Offer captaincy to a teammate; they accept | Old captain becomes co-captain; both emailed; audited |
| F-3 | Co-captains | captain | Make a teammate co-captain | Co-captain gets team tools but can't hand over |
| F-4 | Not-on-my-team list | captain, admin | Add a member by email with a reason | Listed person's invite link looks expired; admin sees lists |
| F-5 | Away weeks | player, captain | Tick weeks to miss; captain's availability view | Counts per week; short weeks flagged with a sub link |
| F-6 | Emergency contacts | player, ref | Player saves a contact; ref opens it on game day | Only on game day for that game's captains and ref; read is audited |
| F-7 | Game-day command center | admin | Admin, Today | Every game of the day with field, ref check-in and score state; refreshes |
| F-8 | Ref check-in | ref | "I'm at the field" on game day | Command center shows the ref as checked in |
| F-9 | Season rollover | admin | Rollover: preview, rename, create | New draft season with moved dates, teams and captains |
| F-10 | Merge accounts | admin | Accounts: preview a merge, merge | Rows move; old address becomes an alias |
| F-11 | Sign-up challenge | admin, player | Challenge: set prize and deadline; team page progress | "N of M signed up"; leaderboard |
| F-12 | Giveaways | admin, player | Add a giveaway to a free event; enter by code; draw | One entry each; draw audited; winner sees it on home |
| F-13 | Alert limits | player | Profile: daily limit and quiet hours | Saved; explained in plain words |
| F-14 | Permit at the field | ref | Home: game's permit | Permit number and document for the game's ref and captains |
| F-15 | Operator console | operator | `/operator`: read-only, feature switch, export | Settings take effect; audited; 404 for others |
| F-16 | Team lists for admins | admin | Admin, Team lists | Every list with reasons |
| F-17 | Private event feed | player | Events: personal calendar link; reset | Private feed link; reset changes it |
| F-18 | Dark theme and phone layout | all | Key screens in dark mode at 375 px | Readable, no horizontal scroll |
| F-19 | Pick'em | player, admin | Pick'em: pick winners for the next game day; leaderboard | Picks saved and locked at kickoff; scored when games go final; admin setting for picking one's own games |
| F-20 | Capacity planner | owner | Owners' capacity planner for a season | How many teams the season's field time fits; nearby NYC Parks fields suggested |
| F-21 | Error page | visitor | A page that fails to load | A league error page with a way back, not a blank screen |

## Added for run 2

Features and fixes merged after run 1, and those still waiting in pull requests, as tasks for each role. Phone size (375 × 812) unless the row says desktop. **Status** says whether the row can run on `main` or waits for a pull request; a waiting row runs once its pull request merges.

### Visitor

| ID | Area | Role | Steps | Expected | Status |
|---|---|---|---|---|---|
| R2-V1 | Seasons page | visitor | Home, then the Seasons link (header or footer) | Every public season listed with its dates; each opens its schedule and standings | on main |
| R2-V2 | Help center | visitor | `/help`, type "rain" in the search box; open the captain how-tos | List filters as you type; each role page has numbered how-tos with anchors | on main |
| R2-V3 | Schedule widget | visitor | `/widget` | The league's next games in a small embeddable page with a link back to the full schedule; no horizontal scroll | on main |
| R2-V4 | Rules page | visitor | `/rules` | Rules by section with anchors, each division's game settings and a dated "What changed" list | on main |
| R2-V5 | Park page | visitor | A park page from the footer or `/fields/<park>` | The next permitted days with each field's hours and permit number, "Permitted by NYC Parks" and the house rules | on main |
| R2-V6 | Contact the league | visitor | `/contact`: pick a category, write a message, give a reply email, send | Thank-you message; the admin sees it in the concerns queue; no earlier submissions shown | on main |
| R2-V7 | Private events | visitor, new | `/private-events`, then "Request a booking" signed in: organization, date, head count | Booking page is public; the request is saved and listed for the organizer and the admins | on main |
| R2-V8 | Game-day status | visitor | Public schedule and a game page after an admin marks a game day | A status line per game day; "Starts late" or "Off" on affected games | on main |
| R2-V9 | Rulings in public | visitor | Public game page of a game an admin forfeited with a reason | Says "Forfeit" or "Ruling"; the reason is not shown | on main |
| R2-V10 | Clubs run by players | visitor | `/friends` and `/events` | "Run by our players" group first; a featured club card on the events page | on main |
| R2-V11 | Default league address | visitor | Open `/l/<default league slug>/schedule`-style addresses | Redirects to the plain address | on main |
| R2-V12 | Security headers | visitor | Response headers of `/` and `/app` | Content security policy, frame, referrer and content-type headers present | on main |
| R2-V13 | Interest sign-ups | visitor | `/interest`: answer an open interest form without an account | Answer saved; totals toward the target show for admins | waiting for #463 |
| R2-V14 | Languages | visitor | Switch to Spanish (and the other offered languages) on home, FAQ and schedule | Pages, dates and numbers in that language; English fallback where untranslated | waiting for #447, #448, #526, #533 |
| R2-V15 | Guest teams | visitor | A tournament's public page: sign up a guest team with no account | Guest team listed under the cap; charity link shown | waiting for #479 |
| R2-V16 | Searchable rulebook | visitor | `/rules`, search a word from the rulebook | Matching rules with links to their sections | waiting for #490 |
| R2-V17 | Email code sign-in | visitor | Sign-in: ask for a link, type the 6-digit code instead | Signed in with the code; the link still works | waiting for #530 |

### Player

| ID | Area | Role | Steps | Expected | Status |
|---|---|---|---|---|---|
| R2-P1 | Free-agent quiz | player | Season, "Find me a team" quiz | Five one-tap questions (three self-ratings, competitive or fun, nights) and an optional note | on main |
| R2-P2 | Shirt size at sign-up | new | Register for an open season | Sign-up asks for a shirt size from the season's list and saves it on the profile | on main |
| R2-P3 | Volunteer shifts | player | `/app/volunteer`: claim a spot, then drop it | Spot count goes down and back up; can't claim a full shift | on main |
| R2-P4 | Season survey | player | Survey for a finished season | Questions answered once; thank-you message | on main |
| R2-P5 | Season card | player | Home, "Your season in kickball"; share it | Card with games, runs, superlatives earned and sub games; sharing makes a public card page | on main |
| R2-P6 | Player stats | player | `/app/stats` | Games played, attendance, wins and runs per season and career, each with how many games it is based on | on main |
| R2-P7 | Raise a concern | player | Home, "Raise a concern": category and message; then "Your concerns" | Saved and listed with its status; admin notes not shown | on main |
| R2-P8 | Field check-in | player | On game day, open the game's check-in code from the ref's or captain's phone, tap Check in | "Checked in"; the captain's attendance shows it | on main |
| R2-P9 | Partiful event | player | An event whose invite is on Partiful | "RSVP on Partiful" button; no in-app RSVP or waitlist | on main |
| R2-P10 | Short-handed team | player | RSVP "Out" until the team has fewer than 6 of its own players | Team page says it's a forfeit below 6 and that pickups don't count toward it | on main |
| R2-P11 | Open to a new team | player | Profile, "Looking for a change": choose who sees it, then take it back | Saved quietly; recruiting captains see it; no reason asked | waiting for #537 |
| R2-P12 | Choose alerts | player | Profile alerts with the lean defaults and the helper | Defaults match the plan; the helper explains each topic | waiting for #536 |
| R2-P13 | Lost and found | player | Post a found item; another member taps "That's mine" | Both talk in the app; first names only | waiting for #457 |
| R2-P14 | Code of conduct | new | Sign the season waiver | Code of conduct accepted with the waiver; version stored | waiting for #458 |
| R2-P15 | Leadership check-in | player | Season-end check-in: volunteer, suggest or "good as is" | Answer private; a ballot opens only at quorum with a candidate | waiting for #538 |
| R2-P16 | Phone apps | player | iOS and Android shells around the site | Same sign-in, push and pages as the site | waiting for #525 |

### Captain

| ID | Area | Role | Steps | Expected | Status |
|---|---|---|---|---|---|
| R2-C1 | Game-day checklist | captain | On game day, the game's checklist: tick before and after items | Ticks saved per team; the other team's ticks separate | on main |
| R2-C2 | Attendance | captain | Game's attendance: show the code, tick a player in by hand; team attendance page | Ticks audited; games played counted per player; unsigned waiver flagged | on main |
| R2-C3 | Ruling on our game | captain | Game page after an admin forfeits or rules on it with a reason | The captain sees the ruling and its reason and has a message about it | on main |
| R2-C4 | Injury report | captain | Game's incident page, injury form: who, body area, care, what happened | "Report sent"; the captain can't open it again | on main |
| R2-C5 | Permit time on live | captain | Live game screen near the permit's end | Minutes left in the permit, and a warning when the game would run past it | on main |
| R2-C6 | Captain polls | captain | Answer a captains' poll for the team; change the answer | One vote per team; the last answer counts | waiting for #454 |
| R2-C7 | Shirt opt-out | captain | Team opts out of league shirts | Team left out of the order; late joiners listed for a reorder | waiting for #475 |

### Ref

| ID | Area | Role | Steps | Expected | Status |
|---|---|---|---|---|---|
| R2-R1 | Ref availability | ref | Ref page: tick game times you can work | Saved; times already reffed shown fixed | on main |
| R2-R2 | Drop a game | ref | "Can't make it?" on a coming game with a reason; another ref opens "Take it" | Game is open; pool refs get one message each; the first to take it is assigned | on main |
| R2-R3 | Quick live scoring | ref | Live game: "+1 run", "End half", "Undo" | Runs counted on the phone and saved once per half; Undo takes back the last run or reopens the half | on main |
| R2-R4 | Eject a player | ref | Live game, "Eject a player" after confirming | Ejection report filed; the player leaves the kicking order and shows as ejected | on main |
| R2-R5 | Permit and layout | ref | Game's permit page on game day | Permit number, hours and the field's layout image or "no layout needed" | on main |
| R2-R6 | Ref who also plays | ref | A ref playing in the game opens its score screen | Reports for their own team, not as the game's ref | on main |
| R2-R7 | Cards | ref | Score screen: yellow card, red card, take one back | Card recorded; admin sees it beside incidents | waiting for #478 |
| R2-R8 | Daylight clock | ref | Live screen near sunset or the permit end | End of play is the earlier of the field-clear time and sunset less the margin | waiting for #476 |
| R2-R9 | Delayed game clock | ref | Live screen of a delayed game | Time limit counts from the delayed start | waiting for #522 |

### Admin

Desktop size unless said.

| ID | Area | Role | Steps | Expected | Status |
|---|---|---|---|---|---|
| R2-A1 | Game-day status | admin (phone) | Season, game-day status: Watching with a decision time, then Delayed for one game | Saved and audited; shown on the command center and public pages | on main |
| R2-A2 | Game-day pack | admin | Today, "Print game-day pack", with rosters | One sheet per field: permit line, games with blank line scores, check-in sheets | on main |
| R2-A3 | Scheduled announcement | admin | Announcement for a later day; edit, then cancel it | Listed under Scheduled with the send time in the league's time zone; edits and cancel audited | on main |
| R2-A4 | Game day for WhatsApp | admin | Announcements: copy a game day for WhatsApp | Games, times and fields as plain text | on main |
| R2-A5 | Rain-out to the owners | admin | Rain-out screen: "Send to the owners to confirm" | Owners messaged; the screen shows who sent it; admins can't confirm unless allowed | on main |
| R2-A6 | Ref assigner and pay | admin | Referees: add a ref to the pool; assign refs for a game day; pay sheet | Proposals respect availability and never the ref's own team; pay sheet per ref | on main |
| R2-A7 | Season checklist | admin | Season checklist: mark a task done, add one | Open tasks by due date with "Due in" words; changes saved | on main |
| R2-A8 | Win-back list | admin | Win-back list for a season open for registration; email one | Earlier players who haven't signed up, most loyal first; one email each | on main |
| R2-A9 | Rules editor | admin | Edit a rules section, publish with a start date | New "What changed" entry on `/rules`; a later start says "New wording from" | on main |
| R2-A10 | Shirt order | admin | Season shirt order: counts by size and team, who has no size, mark ordered | Counts match the sign-ups; status saved; expense in the books | on main |
| R2-A11 | Concerns queue | admin | Incidents screen: reply to a concern, add a note, close it | Reply emailed; the player sees the reply but not the note; time to first reply counted | on main |
| R2-A12 | Injury reports | admin | Open an injury report; export it | Views and the export are audited | on main |
| R2-A13 | Permit coverage | admin | Draft with a game past a permit's end; publish | Publish refused with the gap in words ("permitted until …; this game ends at …") | on main |
| R2-A14 | Field layouts | admin | Fields and permits: upload a layout or mark "no layout needed" | A schedule can't publish while a field has neither | on main |
| R2-A15 | Written rulings | admin | Record a forfeit with a reason; reverse it | Reason required; captains and ref messaged; audited | on main |
| R2-A16 | Volunteer shifts | admin | Post a shift (including Set-up lead), see who signed up | Shift listed for members; the set-up lead's page shows that day's fields and permits | on main |
| R2-A17 | League gear | admin | Add a kit, assign it to a game | Where each kit is and its next game; handoff logged | on main |
| R2-A18 | Stat awards | admin | Season awards, stats page | Six stat awards with the numbers behind them; MVP weighting explained | on main |
| R2-A19 | Season cards | admin | Build the cards for a finished season; build again | Cards built; rebuilding sends nothing twice | on main |
| R2-A20 | Survey results | admin | Season survey results | Averages and answer counts | on main |
| R2-A21 | Private event requests | admin | Private events queue: set up or decline a request | Organizer messaged; a private season made on setup | on main |
| R2-A22 | Clubs | admin | Friends: mark an entry run by a player, feature it | Shown first and on the events page; click counts listed | on main |
| R2-A23 | Suspension history | admin | Incident report naming a player with an earlier ejection | Earlier ejections and suspensions shown beside the report | on main |
| R2-A24 | Command center order | admin (phone) | Today | Fields in start-time order; a game past its permit flagged | on main |
| R2-A25 | Season attendance | admin | Season attendance | Games played per player for every team | on main |
| R2-A26 | Hand-added game kept | admin | Add a game by hand on the board, publish | Game keeps its slot after publishing | on main |
| R2-A27 | Shared fields | admin | Record another group's usual hours on a field | Next handover with a countdown on the game-day screen | waiting for #460 |
| R2-A28 | Playoff formats | admin | Double elimination bracket with a third-place game | Losers' side, grand final and "if necessary" slot | waiting for #459 |
| R2-A29 | Tournaments | admin | Tournament that takes guest teams | Cap, partner league and charity saved | waiting for #479 |
| R2-A30 | Interest forms | admin | Open an interest form with options and a target | Totals per option toward the target | waiting for #463 |
| R2-A31 | Code of conduct editor | admin | Edit and publish a new version | New version required at the next waiver | waiting for #458 |
| R2-A32 | Captain polls | admin | Ask the captains a question with a close time | Live totals; results per the chosen rule | waiting for #454 |
| R2-A33 | Late-joiner shirts | admin | Shirt waiting list; hand out a spare; batch reorder | Waiting players by team and size | waiting for #475 |
| R2-A34 | Sport types | admin | League with dodgeball | Scoring, periods and standings per the sport | waiting for #488 |
| R2-A35 | Demo data | admin | Fresh demo: shirt order, concerns, checklist ticks and attendance | Each screen has data to show | waiting for #508 |
| R2-A36 | Fixes between features | admin | Rain-out of a delayed day; check-in notices | Each fix's case behaves as its issue says | waiting for #522 |

### Owner

| ID | Area | Role | Steps | Expected | Status |
|---|---|---|---|---|---|
| R2-O1 | Confirm a rain-out | owner | Rain-out decision card: confirm; change "admins can confirm" | Rain-out published; setting audited and owners-only | on main |
| R2-O2 | Books, quicker | owner (phone) | Quick add an expense in three taps; expected costs; a reimbursement; import a statement CSV | Expense saved with the last category; expected costs listed; import matched or added | on main |
| R2-O3 | Permit fees | owner | Season permits | Fee estimate where no cost is entered, the 50-hour insurance line and "give back" time | on main |
| R2-O4 | Permit renewal | owner | Renewal draft and application packet | Windows moved 52 weeks on into the same period; packet printable | on main |
| R2-O5 | Season report card | owner | Owner dashboard, season report card | People, money, games and community beside the season before; share view | on main |
| R2-O6 | Checklist template | owner | Checklist template: add a task due before the first day | New seasons start with it | on main |
| R2-O7 | Acting admin | owner | Name a player acting admin for set dates with chosen powers | Powers only between the dates; money and roles never | waiting for #477 |
| R2-O8 | Paste the rulebook | owner | Paste the rulebook, review sections, save | Lands in the change log; anchors kept | waiting for #490 |

### Repository

| ID | Area | Role | Steps | Expected | Status |
|---|---|---|---|---|---|
| R2-X1 | Build and migrations | repo | Fresh database, `npm run db:migrate`, `npm run build` on the latest `main` | Every migration applies; the build passes | on main |
| R2-X2 | Demo reset | repo | `npm run demo:reset` | League moved to the current week, a live game and waiting mail | on main |
| R2-X3 | CI | repo | Latest `main` CI run | Every required check green | on main |
| R2-X4 | More than one league | repo, visitor | A second league's `/l/<slug>` pages | Each league's data stays its own | on main |
