# Kickball League

> One site to run a recreational adult kickball league: registration and payment, waivers, a fair season schedule, game-day scores and rain-outs, and the owners' books, all usable from a phone at the field.

**Live:** [kickball-league.vercel.app](https://kickball-league.vercel.app) (an earlier build: automatic deployments are paused until launch) · **Status:** feature complete. Card payments, email and push stay off until their accounts are configured (free-tier hosting, see [ADR 0003](docs/adr/0003-free-hosting-and-secrets.md)). Read the [case study](docs/case-study.md) for how it is built and why.

## The problem

Adult rec leagues run on a patchwork: a registration form, a payment link, a PDF rulebook, a spreadsheet schedule and a group chat. Captains chase teammates for money, admins rebuild the schedule by hand every time it rains, refs text scores from the sideline, and nobody can find the standings. The league's owners also have to hold park permits, insurance and the books together.

This project replaces the patchwork with one site. Players register, sign the waiver and pay in a few taps. The schedule is generated fairly and re-planned when it rains. Refs enter scores with no signal. Everyone is told only what concerns them. The first deployment targets a Brooklyn league that plays at McCarren Park, and one deployment can host several leagues.

## Screenshots

> Screenshots are added once the launch build is live. Until then, `npm run demo` runs the whole app on one laptop ([walkthrough](docs/demo.md)).

| Player home   | Public schedule | Game day command center | Schedule board |
| ------------- | --------------- | ----------------------- | -------------- |
| _placeholder_ | _placeholder_   | _placeholder_           | _placeholder_  |

## Features

Highlights by audience. The complete list, with every rule and edge case, is in [docs/features.md](docs/features.md).

**Players**

- Sign up with an email link, Google or a passkey; sign the waiver and accept the league's code of conduct (written in the app, versioned, asked once per version), confirm the age check and pay by full or split pay through Stripe, with promo codes and league credit applied.
- Join a team by invite link or as a free agent; a matcher finds the best-fit team and keeps friends together.
- RSVP, see the kicking order, find and take sub spots, and check in at the field by scanning a rotating QR code.
- Live scores, standings, power rankings, pick'em for bragging rights, awards votes and an end-of-season card to share.
- An installable phone app: the next game opens with no signal, and push messages cover rain-outs and sub requests.
- Download everything the league holds, or delete the account.
- Lost and found: members post a found item (with an optional photo, where it was found, a park or the home bar, and where it is now) or a lost note, newest first on one screen. The owner taps "That's mine" (or the finder taps "I found it" on a lost note) and the two talk inside the app, by first name, without anyone's phone or email shown; the poster marks it handed over, which closes the post and deletes its photo. Posts close after 30 days with a note to the poster, admins can take any post down, and photos share the member-photo limits (shrunk on upload, location removed, daily and storage caps).

**Captains**

- Register a team, share the invite link and see who has joined, signed and paid; a card on file guarantees a split-pay team's balance.
- Send blackout dates and time preferences before the schedule is made; build kicking orders that check the league's gender-run rule.
- Ask for subs, answer score confirmations, see availability by week and hand the team to a co-captain.
- Keep a private "not on my team" list and download the team's roster and payments.
- Choose your team's own shirts or jerseys instead of the league's, and see local shirt makers.
- Vote in the league's quick captains' polls: one vote for the team (co-captains too, when a poll says so), changeable until it closes, with the totals once the team has voted or at close, as the admin chose; a reminder comes once a day while the team hasn't voted.

**Refs**

- See assigned games, take an uncovered game with one tap, enter the final score or keep score live inning by inning, with offline entry that syncs when the signal returns.
- Report incidents, eject a player from the live game screen (after confirming), and see the permit for the field they are at.
- Give a player a yellow or red card from the score screen, a calm-down tool that never suspends anyone; admins see cards beside incident reports and players see their own ([ADR 0064](docs/adr/0064-cards-never-suspend.md)).
- Start on time and finish before dark: the live-scoring and score screens show when play must end, the earlier of the field's permit and sunset at the park less a margin (computed on the server, no outside service; lit fields have no daylight end), and count down to first pitch and then to that end on the phone's own clock. One tap records first pitch and who held up a late start, a called game says whether daylight or field time ran out, and the captains and ref of a game with no time to spare get a reminder two hours before. Admins see start times by team and a schedule warning for slots that run past daylight.

**Admins**

- Generate a season schedule, see why any game could not be placed, edit on a drag-and-drop board, publish versions with a diff and run playoffs: single or double elimination, a third-place game, and tiers of the standings on their own days.
- Written rulings: recording or reversing a forfeit, settling a disputed score or correcting a final one asks for a short reason. Both captains and the ref see the ruling and reason and are messaged, the public game page says only "Forfeit" or "Ruling", and each one is in the audit log.
- Captains' polls: ask a season's captains a quick question with two to five options and a closing time, choosing whether co-captains vote and whether captains see results after their team votes or at close. Each team has one vote and the last answer counts. Watch live totals and each team's answer, remind teams that haven't voted (counted against the daily limit for non-urgent messages), close early or remove ([ADR 0063](docs/adr/0063-quick-polls-for-captains.md)).
- Call a rain-out with a weather decision card, a preview of makeups and notices to only the players affected.
- A game-day command center, a ref assigner and pay sheet, rule changes with a dated change log, sub, concern and incident queues, and an audit log.
- Divisions with crossover games, season rollover, events with tickets and giveaways, sponsors, and photo review.
- Power rankings from record, recent form, run difference and strength of schedule, with each team's movement since the last game day.
- Win and loss streaks, the all-time series between any two teams, a game of the week for the next game day, and a league records page. All of it is computed on demand by pure, property-tested functions in `src/domain/stats`.
- A weekly recap drafted from templates (results, rankings, streaks, new records, next week's big game) that an admin edits and sends as an announcement through the outbox.
- A league history page: every completed season with its champion and final standings, and an all-time table. Team pages show the team's all-time record (wins, losses, ties, run difference) and the titles it won, added up from each season's standings in `src/domain/history`.

**Home bar and sponsors**

- A sponsors page with the home bar first, and a page for each sponsor with its deals (days, hours, fine print) and the date the sponsor last confirmed them. Both are static HTML and carry structured data for the business.
- QR check-in with a rotating code ([ADR 0016](docs/adr/0016-rotating-check-in-code.md)): the bar shows a code that changes every 5 minutes, drawn as a QR code on the server. A signed-in player scans it, taps Check in (once a day counts) and can use each of the day's deals once. An old or copied code soon stops working.
- A sponsor portal for the sponsor's own people and admins: add, change or turn off deals, confirm in one tap that they are still current, show the check-in code on a screen at the bar, and edit the page's details. Admins add sponsors, choose the home bar and give people access.
- Weekly numbers for each sponsor: check-ins, different players, teams and deals used by week, with the most used deals and the teams that came by most. Counts only, never names.
- Team of the week: admins see each game day's best wins (an upset of a higher-ranked team counts most) and name a team, with an optional tab at a sponsor. It shows on the sponsors page and the sponsor's page.

**Friends of the league**

- A public, static directory of the other local leagues players also play in (softball, soccer, pool, tabletop games and more), grouped by activity, with each league's area, a short description, its logo and a link to its own site. The page carries `ItemList` structured data.
- Clubs run by our players: a hobby club or meetup one of the league's players runs is listed first, under "Run by our players". An admin can feature one, which also shows a small card for it on the public events page.
- Click counts: each entry counts how many people followed its link out, per day, with nothing about who they were (the link's `ping` attribute, so no script and no redirect). Admins see the last 30 days and the total, to show a club what the league's promotion is worth when they agree a cross-promotion or a fee. Any agreement and payment happen outside the app; owners record the income in the books as usual.
- A "Link to us" section with the league's address and a copyable HTML snippet, so partner leagues can link back; entries that do show "Links to us".
- Admins add, edit and remove entries. Website links must be https on a public host name, and are checked on the server. An optional logo is shrunk on the server to one small WebP and kept in Postgres, within a per-logo and total cap. Every change is audited.

**Help center and schedule widget**

- Contact the league: a public form at `/contact`, linked from the About and park pages, takes a question or a problem at the field (with an optional date, field and email for a reply) with no account. It is protected by a honeypot, a link cap and rate limits per address, per network and overall, and shows nothing from earlier submissions. Messages join a queue on the incidents screen where admins reply by email, add notes and close each with what was done; a park-rules category (hours, alcohol or glass, sound, litter, field damage, sharing the space) lets them see these issues across a season. The share answered within a day is shown, a sender's address is visible only to admins and every read is audited, and it is deleted 12 months after the message closes ([ADR 0060](docs/adr/0060-one-queue-for-concerns-and-public-contact.md)).
- Raise a concern privately: any signed-in player can send the league a concern about a game, a team or how they were treated, with an optional game link and park rule, from "Raise a concern" on their home screen. Only admins read it (it is never shown to a captain, the other team or the public); they reply in the app and by email and close it with a note. The player gets an acknowledgement, each reply and a note when it closes, and follows them under "Your concerns"; admin notes are never shown to them. It uses the same queue as the public contact form ([ADR 0060](docs/adr/0060-one-queue-for-concerns-and-public-contact.md)).
- Interest sign-ups: an admin opens a public form at `/interest` for a new night, park or format, with a target number of teams (default 8). Anyone answers without an account, with a Not sure choice for every question and how many friends might join; the admin sees each option's totals and an "enough to run" marker, and one email goes to everyone who picked an option when it goes ahead. Answers are protected by a honeypot and rate limits, and addresses are deleted six months after the form closes ([ADR 0075](docs/adr/0075-interest-sign-ups.md)).
- A static help center at `/help`: short how-tos for players (sign up, pay your share, RSVP, subs, installing the app, alerts), captains (invites, kicking orders, scores, co-captains, subs), refs (game day, live scoring, incidents), admins (season setup, the schedule, rain-outs, the game-day command center) and owners (books, permits, the dashboard). A search box filters them as you type; every how-to is still listed without JavaScript. The screens they describe link to them with a "Help" link.
- An embeddable schedule widget: a sponsor bar or a team pastes one iframe snippet from `/widget` to show the league's next game day or one team's next three games. The widget is a single static HTML page with inline styles and no JavaScript, follows the visitor's light or dark setting, and updates when the schedule changes. Only `/embed/*` may be framed by other sites; every other page sends `frame-ancestors 'none'` and `X-Frame-Options: DENY`.

**Messaging**

- A transactional outbox: messages are written with the change that caused them, failed sends retry, and nothing sends twice.
- League and team announcements, with per-person email settings. An admin can send one now or schedule it for a day: it goes out with the outbox's morning send that day (scheduled jobs run once a day on the free hosting plan, and the form says so), reaches whoever is registered when it sends, and can be edited or cancelled until then ([ADR 0058](docs/adr/0058-scheduled-announcements-ride-the-daily-sweep.md)).
- "Copy for WhatsApp" on each announcement and on each upcoming game day's schedule: plain text with times, matchups, fields and the schedule link, ready to paste in the league's group chat.
- Rule changes: an admin edits the rules in sections and publishes each change with a one-line summary and a start date. A change marked for notice emails every player in the active seasons through the outbox. Its start date must be at least 3 days after publishing, and the email says when it takes effect.
- Alerts without too many: rain-outs, sub spots, payment deadlines and other urgent messages always go at once, while news and reminders that can wait count toward a daily limit (3 by default, lower if a member likes). Anything over it comes in one digest email, every evening or on Sundays. During quiet hours (10 pm to 8 am by default) only urgent news is sent, and it reaches phones silently. Every email and push says why the person got it and links to the setting that changes it, every email has a one-click unsubscribe for its topic, and league news emails are opt-in: a new account starts with announcements off and turns them on in its email settings, while game messages (rain-outs, schedule changes, sub requests, payments) keep coming, in its footer and as the `List-Unsubscribe` header mail apps show as their own button. Email stays inside the provider's free quota (100 a day, 3,000 a month by default): pushes go first, urgent email goes to people without push first, news over the quota joins the digest, and urgent email that cannot go today goes after midnight UTC, with admins told ([ADR 0019](docs/adr/0019-urgent-and-non-urgent-messages.md)).
- Payment reminders 7, 3 and 1 days before the deadline, and missing-score reminders to the ref and then the captains.
- Web push for rain-outs, sub requests and scores: each player opts in per topic on their profile, and the outbox sends a push to each of their phones alongside the email. Push is off until VAPID keys are set, devices a push service reports gone are removed, and the protocol is written against the standards with Node's crypto ([ADR 0014](docs/adr/0014-web-push-without-a-library.md)).

**Events**

- An events calendar for parties and prom, bar nights, BBQs, tournaments and theme weeks. Admins create an event with a place, time, capacity and description, edit it, call it off (everyone who RSVP'd is emailed) or delete it.
- Each event is for everyone, all members, or chosen teams from the active season, another season or every season. Members-only and team events never reach public pages, the public feed or the sitemap; the people they're for see them in the app, and admins see everything.
- Partiful first: when an event has a Partiful (or any https) invite link, its guest list is the one that counts. Adding the link switches the app's own RSVPs, waitlist and RSVP emails off by default, and the event shows one "RSVP on Partiful" button on its page, card, shared message and emails. An admin can turn RSVPs in the app back on, and an event that sells tickets or already has RSVPs keeps them. The app still does what the invite doesn't: the calendar and `.ics` feeds, the public page and sitemap, theme weeks, giveaways, volunteer shifts and telling the right members about the event. The link is only shown and shared, never fetched ([ADR 0051](docs/adr/0051-partiful-takes-the-rsvps.md)).
- When posting or changing an event, an admin can email everyone it's for through the outbox (event emails can be turned off), and copy a ready-made message for the WhatsApp group.
- Players RSVP from the app. When an event is full they join a waitlist, see their place in line, and move up in order when someone drops out or the admin adds spots, with an email when they do. A spot is never taken from anyone when capacity shrinks.
- Paid tickets: an admin can give an event a ticket price and a lower member price. Anyone who can see the event buys one ticket through Stripe Checkout, with their league credit applied unless they untick it, and the spot is held while they pay so the capacity is never oversold. The ticket shows a check-in code on the event page and the events list, and comes with an emailed receipt. Admins see ticket holders and what they paid, check people in by code at the door, and refund a ticket in full: the card part goes back through Stripe, the credit part back to the balance, and the spot is offered to the next person on the waitlist for a day.
- A public events page and a page for every public event (static HTML with `SocialEvent` structured data), all in the sitemap, with share buttons. Theme weeks mark their game days on the public schedule.
- Free giveaways ([ADR 0035](docs/adr/0035-free-giveaways-and-the-sign-up-challenge.md)): an admin adds a giveaway to an event with a prize (often a sponsor's), the number of winners, when entry opens and closes, and official rules that must say no purchase is necessary. Players enter by scanning the giveaway's rotating QR code at the event, once each, with only a free account: never a ticket, payment or fee, and an event that sells tickets can't hold one. The event's audience decides who can enter. After entry closes the admin draws winners in the app with `crypto.randomInt`; the draw goes into the audit log with the entry count, the method and the result, and replacing a winner needs a reason and is audited too. Winners see it on the app's home screen and get one message.
- Volunteer sign-ups: admins post shifts for a season's game days or an event (setup, teardown, check-in table, ref fill-in) with when, where and how many spots. Members claim a spot and drop it again until the shift starts, a shift never takes more people than it has spots (even when several people grab the last one at once), and everyone on a shift gets a reminder the day before. Admins see who signed up for each shift.
- End-of-season survey: once a season is completed an admin opens a short survey (an overall rating from 1 to 5, would you play again, the best part, one thing to change, and a free comment) and every player who was on a roster gets one invite. Each player answers once. Owners and admins see totals and the written answers as anonymous lists: the answer is stored with no link to the person, so no screen or query can say who wrote what.
- Calendar export: a subscribed `.ics` feed of every public event (theme weeks as all-day entries), a private feed per member with every event they can see (its link can be reset), plus "save the date" links for one event to Apple Calendar, Outlook or Google Calendar.

**Admin**

- Acting admin: an owner hands some admin powers to a trusted player for set dates, such as game day, scores, rain-outs, the schedule, rosters, announcements or discipline, so the league keeps running while the organizers are away. Access starts and ends by itself at the dates, the owner can end it early, and the powers never include money, roles, exports or the audit log. Everything the acting admin does is in the audit log under their name, and they and every owner are told when it starts and ends ([ADR 0076](docs/adr/0076-acting-admin-handover.md)).
- Season setup, fields, permits and blackout dates. Registration opens only once a season has a waiver, since players sign it before they pay; the settings page says so until one is chosen. A season can also set a minimum number of games played for the playoffs.
- Private leagues and tournaments: companies, clubs and groups ask for a one-day tournament or a private league from a public booking page (signing in, with a confirmation email), and admins accept a request as an invite-only private season or decline it. The season uses the league's scheduler or playoffs bracket, its waiver and its refs. The organization pays once for every team through Stripe Checkout, or each player pays as in any season. The organizer's page shows the invite link, teams, schedule and results. Private seasons never appear on public pages, in the main standings, history, records, pick'em or the sitemap ([ADR 0049](docs/adr/0049-private-events-are-private-seasons.md)).
- Season rollover: start the next season from the last one in one step. A preview shows what the new draft gets (every date moved by the same number of days at the same local time, prices, early bird, roster limits, its waiver, divisions and their rule sets, the teams that played with their captains and co-captains, and the permit hours on the new dates) and what starts fresh (payments, waiver signatures, other players, games, scores, RSVPs, kicking orders, suspensions, promo codes, photos and permit numbers). The admin can rename it, change the first day and leave teams out. Captains still sign the waiver and pay, and someone suspended for good doesn't come back as captain.
- Attendance: every team's players with their games played this season, and who is short of the playoff minimum. Every tick in or out on a game's check-in screen is in the audit log.
- A dashboard for the next game day: games, refs, RSVP warnings, missing scores, and registrations, payments and waivers by team.
- A ref pool, a ref assigner and a ref pay sheet. Admins add refs to the league's pool, and each ref ticks the game times they can work on their own page. "Assign refs" proposes a ref for every game still without one, for a game day or the whole season: only at times the ref ticked, never for a game their own team plays or while they play or ref another, keeping a ref on one field for back-to-back games, and spreading games evenly. It says why a game has nobody. Admins accept all, accept one, or pick someone else by hand. The pay sheet sets the season's per-game fee and shows each ref's games worked (checked in for, or scored as its ref), what they're owed, what's been paid and the balance; "Mark paid" records cash or Venmo and adds a Refs expense to the books. A ref sees only their own games and pay ([ADR 0053](docs/adr/0053-ref-assigner-and-pay-sheet.md)).
- A season ops checklist for owners and admins: the jobs that keep a season running, each with an owner, a due date, notes and done or not. It starts from a league template with typical tasks (renew permits, the insurance certificate, open registration, book the bar for the season party, order shirts, line up refs, send the schedule, the end-of-season survey), dated from the season's first day. Owners edit the template, season rollover offers to start the new season's checklist, the dashboard shows the next three tasks, and each task's owner gets a non-urgent email 3 days before it is due and once if it is overdue ([ADR 0061](docs/adr/0061-season-ops-checklist-from-a-template.md)).
- A team sign-up challenge for a season: a prize and a deadline for the first team whose whole roster has an account and has signed the waiver. Each team sees "9 of 12 signed up" on its team page, signed-in players see a leaderboard of teams by percentage (team names and counts only), the first team to 100% wins (a tie goes to the team whose last player finished first), and an admin confirms the winner in the audit log. The dashboard shows every team's sign-up rate, lowest first, so admins know who needs a nudge.
- Instagram photos: an admin connects the league's professional account on Instagram's own sign-in, and recent posts sync daily with each photo copied to the site. Admins feature or hide posts, tag them to a team or event, set a cover for the home or a team page and describe each photo for screen readers; nothing shows until it is featured, unless the league turns on "show new posts". To stay on the free database tier it keeps only the 30 newest posts plus featured ones and covers, and at most 25 MB of photos, telling admins when that fills up. A post deleted on Instagram leaves the site at the next sync, a weekly job keeps the sign-in alive and emails admins if Instagram stops accepting it, and disconnecting deletes the token. Off until the Instagram app's ID and secret are set; development and the demo can use a recorded copy of the API instead ([ADR 0023](docs/adr/0023-instagram-photos-stored-in-postgres.md)).
- Member photos: a review queue to approve a photo, download its stored copy for Instagram, or reject it with a note only admins see. The player gets a non-urgent message either way. Approved photos can be taken down at any time, and every approve, reject and delete is in the audit log.
- An audit log of admin actions that admins and owners can read in plain words, newest first, with a filter for the platform operator's actions; and a permissions matrix enforced by one tested function.

**Owners**

- The books: money in from recorded payments, expenses with receipts, expected costs, statement import and a CSV for taxes.
- Park permits, fees, renewals and a capacity planner; the schedule cannot be published outside a documented permit.
- Other groups on our fields: admins record who else uses each field, their usual days and hours, and a contact only admins see. The game-day screen shows each field's next handover with a countdown in the last 30 minutes, and the set-up lead's checklist shows it too, without contacts. A recorded overlap warns admins ahead of the day with the borough permit office's number ([ADR 0066](docs/adr/0066-other-groups-on-a-field.md)).
- A dashboard, a season report card, win-back list and a public "where the money goes" page.
- Several leagues on one deployment, and a platform operator role above the owners.

**Everyone, signed in or not**

- Public schedule, standings, team, game, event, sponsor and field pages as static HTML that paints fast on a phone, with share images and a calendar feed per team.

## Tech stack

Next.js 16 (App Router, Cache Components) · React 19 · TypeScript (strict) · Tailwind CSS v4 · Drizzle on Neon Postgres · Better Auth · Stripe · Resend · Vercel

Quality: Vitest (unit, property and database tests) · fast-check · Playwright with axe · Lighthouse CI · gitleaks secret scanning · GitHub Actions

Every service runs on its free tier, and no feature needs a paid plan, a paid API key or a monthly bill ([ADR 0021](docs/adr/0021-free-services-only.md)). Each free limit and what the site does near it is in the [free-tier budget](docs/architecture.md#15-free-tier-budget).

## Getting started

Requires Node 24 (`nvm use` reads `.nvmrc`).

To see the app with nothing to set up but Docker or a local Postgres:

```bash
npm run demo
```

It builds and starts the whole app in demo mode on this computer, offline, and opens the browser. To work on the code:

```bash
npm install
cp .env.example .env.local   # fill in values; DATABASE_URL is your own Neon branch
npm run db:migrate           # apply migrations to that branch
npm run seed                 # a demo league: 8 teams, invented players, a season half played, three past seasons; plus a small second league
npm run dev
```

Environment variables are validated with Zod in [`src/lib/env.ts`](src/lib/env.ts), so the app stops at startup and names any variable that is missing or malformed. Optional integrations (Google sign-in, web push, Instagram, the email quota), a local Postgres for the database tests and demo mode on a deployment are covered in the [development guide](docs/development.md). Going live is in the [launch kit](docs/launch/README.md).

## Scripts

| Command                      | What it does                                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                | Start the development server                                                                                    |
| `npm test`                   | Run unit and property tests once                                                                                |
| `npm run test:coverage`      | Run unit tests with coverage of `src/domain` and `src/lib`                                                      |
| `npm run test:db`            | Database constraint tests against a real Postgres (each rolls back)                                             |
| `npm run test:e2e`           | Seed, build, then smoke tests and core flows with axe                                                           |
| `npm run test:e2e:site-wide` | Reseed, then the operator's site-wide switches on their own                                                     |
| `npm run lighthouse`         | Lighthouse budgets on the public pages of the last build                                                        |
| `npm run check:route-js`     | Every route's first-load JavaScript against its budget                                                          |
| `npm run lint`               | ESLint, failing on any warning                                                                                  |
| `npm run typecheck`          | Generate route types and run `tsc`                                                                              |
| `npm run format:check`       | Check Prettier formatting                                                                                       |
| `npm run build`              | Production build                                                                                                |
| `npm run db:generate`        | Generate a SQL migration from `src/db/schema`                                                                   |
| `npm run db:migrate`         | Apply pending migrations to `DATABASE_URL`                                                                      |
| `npm run db:check`           | Check migration files are consistent                                                                            |
| `npm run db:studio`          | Browse the database in Drizzle Studio                                                                           |
| `npm run seed`               | Replace the demo league and the small second league with fresh seed data; refuses production                    |
| `npm run demo`               | Run the whole app locally in demo mode, offline, for showing the league ([walkthrough](docs/demo.md))           |
| `npm run demo:reset`         | Reseed the demo deployment, bring its season up to today and start a game night; refuses unless demo mode is on |
| `npm run push:keys`          | Add a new VAPID key pair for web push to `.env.local`                                                           |
| `scripts/backup-drill.sh`    | Back up a database, restore it to a scratch database and compare ([steps](docs/launch/backup-and-restore.md))   |

## Testing and CI

- **Unit and property tests** (Vitest, fast-check): the scheduler, standings, permissions, pricing, the matcher and the other rules live in `src/domain` as pure functions, with property tests for the scheduler's and matcher's promises.
- **Database tests** run against a real Postgres, each in a transaction that rolls back, to prove the constraints, locks and idempotency the app relies on.
- **End-to-end tests** (Playwright with axe) walk a whole season and one journey per role, check every key screen for accessibility, and send Stripe calls to stripe-mock.
- **Lighthouse CI** holds each public page to its performance and accessibility budgets on a throttled phone profile, and a route-by-route first-load JavaScript check runs on every pull request.
- **Hygiene and security:** secret scanning over the whole history, a migrations check (consistent, idempotent, no schema change without a migration) and a pull request check for text that must not reach GitHub.

A pull request that changes only Markdown or `docs/` skips the heavy jobs and still reports every required check. The layout and sharding are in [architecture](docs/architecture.md#11-continuous-integration); running the checks locally is in the [development guide](docs/development.md).

## Documentation

| Document                                                     | What it covers                                                                   |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| [Case study](docs/case-study.md)                             | The problem, constraints, architecture, deep dives, trade-offs and numbers       |
| [Features](docs/features.md)                                 | Every feature by area, in full                                                   |
| [Development guide](docs/development.md)                     | Optional integrations, local databases, end-to-end tests, how changes land       |
| [Product spec](docs/product-spec.md)                         | Roles, permissions matrix, features by phase                                     |
| [Information architecture](docs/information-architecture.md) | Routes, user flows, key screens                                                  |
| [Data model](docs/data-model.md)                             | Tables, constraints, indexes                                                     |
| [Scheduling algorithm](docs/scheduling-algorithm.md)         | The season scheduler and its property tests                                      |
| [Architecture](docs/architecture.md)                         | Stack, rendering, auth, jobs, webhooks, security, CI, free-tier budget           |
| [Design system](docs/design-system.md)                       | Tokens, type, components, motion, performance budgets                            |
| [SEO plan](docs/seo-plan.md)                                 | Metadata, structured data, content                                               |
| [Roadmap](docs/roadmap.md)                                   | Phases and acceptance criteria                                                   |
| [Launch kit](docs/launch/README.md)                          | Hosting brief, environment checklist, runbook, backups, acceptance tests, alerts |
| [Security review](docs/security-review.md)                   | Findings, fixes and follow-ups                                                   |
| [Demo walkthrough](docs/demo.md)                             | A 10-minute tour from one laptop                                                 |
| [Decisions](docs/adr/)                                       | Architecture decision records, one per real trade-off                            |

Decisions worth reading first: [stack and tooling](docs/adr/0001-stack-and-tooling.md), [static public pages](docs/adr/0008-static-public-pages.md), [free services only](docs/adr/0021-free-services-only.md), [captain guarantee and league credit](docs/adr/0022-captain-guarantee-and-league-credit.md), [offline scores](docs/adr/0025-offline-scores-keep-the-servers-version.md) and [several leagues on one deployment](docs/adr/0048-several-leagues-on-one-deployment.md).

## Project layout

`src/domain/` holds pure TypeScript (the scheduler, standings, permissions, pricing) with no framework or database imports, enforced by a lint rule. That is where the interesting logic and most of the tests live. `src/app` holds the routes, `src/db` the schema and queries, and `src/services` the integrations. See [architecture](docs/architecture.md#code-layout).

Contributions follow [`AGENTS.md`](AGENTS.md): small Conventional Commits, one pull request per issue, rebase merges onto a protected `main`.
