# Kickball League

> Software to run a recreational adult kickball league: registration and payment, waivers, a fair season schedule, game-day scores and rain-outs, built first for a Brooklyn league of 8 to 12 teams.

**Live:** [kickball-league.vercel.app](https://kickball-league.vercel.app) (an earlier build: automatic deployments are paused until launch) · **Status:** season core in progress. Scheduling, registration, game day and the admin tools work; card payments and email are built but stay off until their accounts are configured (free-tier hosting, see [ADR 0003](docs/adr/0003-free-hosting-and-secrets.md))

## Why this exists

Adult rec leagues run on a patchwork: a registration form, a payment link, a PDF rulebook, a spreadsheet schedule and a group chat. Captains chase teammates for money, admins rebuild the schedule by hand every time it rains, and nobody can find the standings. This project replaces that patchwork with one site a player can use from their phone at the field.

The first deployment targets a real Brooklyn league that plays in McCarren Park: weeknight evenings in spring and fall, Sunday afternoons in summer. The design decisions, tests and history are written to be read.

## Features

What works on `main` today. The [roadmap](docs/roadmap.md) lists what comes next.

**Scheduling**

- A season scheduler that turns permit windows into game slots, builds round-robin rounds, places games with a min-cost assignment and improves them with local search. It checks eleven hard constraints and reports fairness metrics, and property tests cover it ([how it works](docs/scheduling-algorithm.md)).
- Divisions with crossover games: an admin can split a season into divisions, such as Competitive and Social, each with an optional rule set (innings, time limit, bunting, stealing). Each division plays its own round robin, plus a set number of crossover games a team against the other division, spread through the season with every fairness guarantee kept. Standings are ranked within each division, with crossover results counted unless the season says otherwise, and playoffs seed per division, meeting in a combined final or crowning a champion each. A season with no divisions plays as one pool ([ADR 0040](docs/adr/0040-divisions-and-crossover-games.md)).
- Before the schedule is made, captains send the dates their team can't play and the game times it would rather have or avoid. Conflicts are never broken; preferences are weighed, and the schedule screen shows the share honored.
- Admins generate a draft, see why any game could not be placed, move or swap games by form, and publish. Each publish saves a version with a diff.
- Schedule board (desktop): drag a game to an open slot, or onto another game to swap them. While a game is held, the board shows the hard-rule problems and the change in each fairness metric that dropping it there would cause, from the scheduler's own checks. Arrow keys, Enter and Escape do the same without a mouse, and several changes save together as one new draft.
- Rain-outs: pick a scope, preview the affected games and proposed makeups, and confirm. Each affected player is emailed their own game's new time, and nobody else hears about it.
- Weather: upcoming game pages show the temperature at kickoff and the chance of rain from the National Weather Service, cached so pages never wait on it. About a day before each game day, admins get a "watch" or "likely" rain alert linking to the rain-out screen with that day chosen, once per level.
- Playoffs: an admin seeds the bracket from the final standings with the configured tiebreakers, and the scheduler places every round on fields and times, top seeds getting byes when the field is uneven. It publishes as a schedule version like the regular season. Winners move on as soon as a playoff score is final, and the next game appears on the schedule in its reserved slot.

**Registration and payment**

- Player profiles with an 18+ check, and versioned waivers signed before payment.
- An age check ([ADR 0041](docs/adr/0041-age-check-at-registration.md)): the league's minimum age is 21 by default, and a season can set its own. Registering a team, joining as a free agent, joining by a captain's invite and signing the waiver each ask the player to confirm "I'm 21 or older", checked against the birth date on their profile. A player it shows as too young sees a friendly message instead of the form. Only the age confirmed and when are stored with the registration or signature, never a new birth date.
- Team registration with full or split pay, invite links, and a roster board showing who has joined, signed and paid. Free agents register solo, take a one-minute team-fit quiz and can share a friend code so up to four friends stay together.
- A free-agent matcher for admins: it suggests a team for everyone in the pool with plain-language reasons ("Helps Thunder field a full lineup: it has 3 women and 7 men"), keeps friend groups together, stays within roster sizes and fills each team's need for women and men under the fielding rule first. Admins apply one suggestion or all of them, or build a new team from the pool with a volunteer captain. Its promises are checked by property tests.
- Start-a-new-team requests: a player already in the season (on a team or as a free agent) asks to start a team with a name, expected size and a note. Admins approve or decline from one screen, and the requester hears back by email. Approval creates the team in "forming" status with them as captain, moves them off their old team and tells that captain, and the invite flow takes over. A player who already paid keeps that payment as their share.
- Captain handoff and co-captains: a captain offers the captaincy to a teammate, who accepts or declines on their team page; nothing changes until they accept, and then the old captain stays on as a co-captain. The captain also makes teammates co-captains, who get the team's tools (kicking orders, sub requests, scores, who has paid, the private list) but can't hand the team over or change the captain's role, and a co-captain can step down. Admins can do the same from the registrations screen; every change is audited and the people involved are emailed ([ADR 0042](docs/adr/0042-captain-handoff-and-co-captains.md)).
- A private "not on my team" list for each team: a captain adds a league member by email address, with an optional reason only the team's captains and the league's admins read. The team's invite link shows that person exactly what an expired link shows, the matcher never suggests the team for them (an admin placing them by hand sees a warning naming the team, and an override is audited), and they never hear of or see the team's sub requests. Nothing else changes for them, and nobody tells them. Admins see every list with its reasons, long lists and anyone listed by several teams; a person's own export leaves out entries about them unless the owners choose otherwise, and deleting either account removes the entries ([ADR 0036](docs/adr/0036-not-on-my-team-list.md)).
- Stripe Checkout with an idempotent webhook (test mode, on once keys are set), plus cash or Venmo payments recorded by admins and captains.
- Promo codes per season: a percentage or an amount off, with an optional limit on uses and a last day. Players type one when they pay, and Stripe charges the lower price ([ADR 0010](docs/adr/0010-promo-codes-applied-in-app.md)). Admins see how often each code was used and can turn one off.
- League credit: an append-only ledger per player, filled by rain-out rebates, referrals and goodwill from admins, and taken off the next fee at checkout (players can untick it). Credit held by an unfinished checkout comes back on its own. Players see their balance and history on their account page.
- Captain guarantee for split-pay teams: the team page shows the fee, what is paid and what is left, with a button to pay the rest. A captain can save a card through Stripe; 72 hours before the payment deadline they get an email, then the card is charged off-session for whatever is still unpaid, and the webhook confirms the team ([ADR 0022](docs/adr/0022-captain-guarantee-and-league-credit.md)).
- A team waitlist for full seasons. Captains join the line and see their place; when a spot opens (an admin raises the team limit), the next one is emailed and the spot is held for 48 hours. Nobody can take a held spot or jump the line.
- Rain-out rebates: an admin screen shows each team's regular games lost and money paid, and issues the pro-rata rebate as league credit to everyone who paid toward a team that lost more than the season's threshold (25% by default).
- Referral links (`/r/<code>`): when someone new registers through a player's link and pays, the player gets $10 of league credit.
- Full or partial refunds from the registrations screen. Stripe payments go back through Stripe and show as refunded once Stripe's `charge.refunded` webhook confirms; cash and Venmo handed back are marked refunded with a note. A refund needs a sign-in from the last 15 minutes, and every refund is in the audit log and in the payments download.
- Shirt tracking: sizes by team from players' profiles, what is still to order for late joiners, and a received flag per player.
- CSV downloads of rosters (with shirt sizes) and payments: the whole season for admins, one team for its captains. Cells that a spreadsheet would run as a formula are written as text, and every download is logged.
- A league shop: admins list league gear and replacement team jerseys with photos, sizes, a price and member price, stock or made to order, and an order deadline. Players order through Stripe Checkout with league credit applied; a replacement jersey starts in their team's color and their profile's size. Stock never oversells, admins mark orders fulfilled or refund them, and download a CSV for the printer.
- Emergency contacts on game day: each player keeps one emergency contact (name, relationship, phone) and can add a short first-aid note, after a plain note on who sees it and when. The league stores it encrypted. Only the two captains and the ref of a game the player is in can read it, and only on that game's day, on a page that the home screen also saves on their phone until midnight for a field with no signal. Admins don't see it, every read is in the audit log, and it is in the player's data export and deleted with their account ([ADR 0043](docs/adr/0043-emergency-contacts-sealed-and-shown-on-game-day.md)).
- Players download everything the league holds about them as JSON, and can delete their account. Deleting anonymizes the person so past rosters, scores and payments stay correct, and needs a sign-in from the last 15 minutes plus their email address typed again.
- Merging duplicate accounts: an admin picks the account a player uses and the extra one, previews what moves and how each clash is settled (one RSVP per game, one vote per poll, the earliest waiver signature), and merges. Registrations, payments, league credit, waivers, RSVPs, lineups, votes, tickets, merch orders, photos, incidents, passkeys and everything else move in one transaction; the old address keeps working as another name for the kept account and can no longer sign in on its own ([ADR 0041](docs/adr/0041-merging-duplicate-accounts.md)).
- Passkeys: after signing in once, a player adds a passkey and signs in with Face ID, Touch ID or their device PIN, from a button or the email field's autofill. The account page lists every signed-in device and signs one, or all the others, out. Sensitive actions (adding or removing a passkey, deleting the account, the operator's changes) ask for a confirmation from the last 15 minutes, which a passkey gives in one tap.

**Game day**

- Refs see their assigned games and enter scores from their phone. The captains who need to answer are asked by email (and push, if they turned it on) to confirm or dispute, and undisputed scores become final.
- Live scoring: the ref, or a captain when there is no ref, taps in the runs after each half-inning. The public game page shows the line score and updates within 15 seconds without a reload. A called game goes back to the score at the last complete inning, and the final score is confirmed like any other.
- Players answer in, out or maybe, and captains see a warning when the fielding rule is at risk.
- Away weeks: players tick the weeks of a season they'll miss on their profile. Captains see how many players are available for each game week, who is away, and when the players left can't field a full lineup under the fielding rule, with a one-tap link to ask for a sub. The captains also get one email the first time a player's change leaves a week short.
- A kicking-order builder: the captain orders the players who are in (and any approved pickups, who kick last) by dragging, by keyboard or with up and down buttons. It checks the league's rule of no more than two of the same gender in a row as the order changes, counting from the last kicker back to the first, explains each break in plain words, and auto-arranges a valid order, moving as few people as it can, or says why none exists. An order can be copied from the team's last game. Each player sees their spot; on game day the ref and the other captain see the order, names only ([ADR 0030](docs/adr/0030-kicking-order-sides.md)).
- A sub finder: a short-handed captain asks for subs for a game, with spots reserved for women or men when the fielding rule needs them. Registered players with a signed waiver who are free at that time hear about it by email (free agents first, and only if sub alerts are on). A player's "I'm in" holds a spot until the captain approves or declines, so two players can never take the last spot at once. Both captains and the ref see who is playing as a pickup. Not offered for playoff games.
- Awards voting: admins open a poll for one game day or the whole season (MVP, best play, best sport, best newcomer, or team spirit and best dressed for teams) with a closing time. Players on a roster that season vote once, never for themselves or their own team, and a weekly ballot lists only the teams that played that day. Nobody, admins included, sees a count while voting is open; after it closes a results page ranks everyone, with ties sharing a place. The database keeps it to one vote per player per poll, even when two arrive at once.
- Sportsmanship, incidents and suspensions: after a final score each captain rates the other team from 1 to 5, with an optional note only admins read. Admins see every team's average for the season, and a captain sees their own team's averaged over whole blocks of three ratings, so nobody can tell who gave which rating. The game's ref, either captain or an admin can report an incident (an ejection, outside alcohol at the sponsor bar, a safety issue and so on) naming the people involved; admins review reports, add notes and resolve them. From a report an admin suspends a player for a number of games, the rest of the season or permanently, with the rulebook's outside-alcohol ladder (1 game, then the season, then for good) suggested from the player's history. A suspended player can't say they're in for a game, claim a sub spot or be placed from the free-agent pool; their captain sees that they're suspended, not why, and they get one email with the length and how to appeal. Games served count down on their own as the team's games go final ([ADR 0026](docs/adr/0026-discipline-counted-not-stored.md)).
- Public standings with the configured tiebreakers, a table per division when the season has divisions. Each division has its own static schedule page, and crossover games are marked.
- An installable app: a web app manifest with the league's icons and light and dark theme colors, and a service worker that keeps the app shell and each signed-in person's next game on the phone, so the game page opens with no signal (marked as a saved copy) and anything else shows an offline page. Signed-in screens, payments, waivers, admin and API responses are never cached. Captains, refs and admins are offered the install from their second visit on; "Not now" is remembered.
- Offline score entry: with no signal, a ref or captain can still enter the final score, or the runs of each half-inning when scoring live, on an open score screen. Each entry is saved on the phone ("Saved on this phone, will send when you're back online") and sent when the signal returns: in the background on Android, and the next time the app is opened on an iPhone. The server takes each entry once, and if the score changed in the meantime (the other captain reported or confirmed one, or someone saved that half first), it keeps the server's score and tells the person what stands.
- Share a photo: players and captains upload photos from their phones, tagged to a recent game day, a public event or their team, with an optional caption and a required "The league may repost this on its socials". The phone shrinks the photo before sending it; the server checks it is really a photo by its bytes, stores one JPEG at most 1440 px and 1 MB with its location and other metadata removed, and allows 10 a day per person and 100 MB for the league, saying clearly when either is reached. Photos only, no videos. Each player sees what the league decided and can delete their photo at any time; deleting an account deletes them all ([ADR 0039](docs/adr/0039-member-photos-in-postgres.md)).

**Score stats**

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
- A "Link to us" section with the league's address and a copyable HTML snippet, so partner leagues can link back; entries that do show "Links to us".
- Admins add, edit and remove entries. Website links must be https on a public host name, and are checked on the server. An optional logo is shrunk on the server to one small WebP and kept in Postgres, within a per-logo and total cap. Every change is audited.

**Messaging**

- A transactional outbox: messages are written with the change that caused them, failed sends retry, and nothing sends twice.
- League and team announcements, with per-person email settings.
- Alerts without too many: rain-outs, sub spots, payment deadlines and other urgent messages always go at once, while news and reminders that can wait count toward a daily limit (3 by default, lower if a member likes). Anything over it comes in one digest email, every evening or on Sundays. During quiet hours (10 pm to 8 am by default) only urgent news is sent, and it reaches phones silently. Every email and push says why the person got it and links to the setting that changes it. Email stays inside the provider's free quota (100 a day, 3,000 a month by default): pushes go first, urgent email goes to people without push first, news over the quota joins the digest, and urgent email that cannot go today goes after midnight UTC, with admins told ([ADR 0019](docs/adr/0019-urgent-and-non-urgent-messages.md)).
- Payment reminders 7, 3 and 1 days before the deadline, and missing-score reminders to the ref and then the captains.
- Web push for rain-outs, sub requests and scores: each player opts in per topic on their profile, and the outbox sends a push to each of their phones alongside the email. Push is off until VAPID keys are set, devices a push service reports gone are removed, and the protocol is written against the standards with Node's crypto ([ADR 0014](docs/adr/0014-web-push-without-a-library.md)).

**Events**

- An events calendar for parties and prom, bar nights, BBQs, tournaments and theme weeks. Admins create an event with a place, time, capacity and description, edit it, call it off (everyone who RSVP'd is emailed) or delete it.
- Each event is for everyone, all members, or chosen teams from the active season, another season or every season. Members-only and team events never reach public pages, the public feed or the sitemap; the people they're for see them in the app, and admins see everything.
- An optional external invite link (Partiful or any https page) shows as an "RSVP on partiful.com" button, alongside or instead of RSVPs in the app. The link is only shown and shared, never fetched.
- When posting or changing an event, an admin can email everyone it's for through the outbox (event emails can be turned off), and copy a ready-made message for the WhatsApp group.
- Players RSVP from the app. When an event is full they join a waitlist, see their place in line, and move up in order when someone drops out or the admin adds spots, with an email when they do. A spot is never taken from anyone when capacity shrinks.
- Paid tickets: an admin can give an event a ticket price and a lower member price. Anyone who can see the event buys one ticket through Stripe Checkout, with their league credit applied unless they untick it, and the spot is held while they pay so the capacity is never oversold. The ticket shows a check-in code on the event page and the events list, and comes with an emailed receipt. Admins see ticket holders and what they paid, check people in by code at the door, and refund a ticket in full: the card part goes back through Stripe, the credit part back to the balance, and the spot is offered to the next person on the waitlist for a day.
- A public events page and a page for every public event (static HTML with `SocialEvent` structured data), all in the sitemap, with share buttons. Theme weeks mark their game days on the public schedule.
- Free giveaways ([ADR 0035](docs/adr/0035-free-giveaways-and-the-sign-up-challenge.md)): an admin adds a giveaway to an event with a prize (often a sponsor's), the number of winners, when entry opens and closes, and official rules that must say no purchase is necessary. Players enter by scanning the giveaway's rotating QR code at the event, once each, with only a free account: never a ticket, payment or fee, and an event that sells tickets can't hold one. The event's audience decides who can enter. After entry closes the admin draws winners in the app with `crypto.randomInt`; the draw goes into the audit log with the entry count, the method and the result, and replacing a winner needs a reason and is audited too. Winners see it on the app's home screen and get one message.
- Calendar export: a subscribed `.ics` feed of every public event (theme weeks as all-day entries), a private feed per member with every event they can see (its link can be reset), plus "save the date" links for one event to Apple Calendar, Outlook or Google Calendar.

**Admin**

- Season setup, fields, permits and blackout dates.
- Season rollover: start the next season from the last one in one step. A preview shows what the new draft gets (every date moved by the same number of days at the same local time, prices, early bird, roster limits, divisions and their rule sets, the teams that played with their captains and co-captains, and the permit hours on the new dates) and what starts fresh (payments, waiver signatures, other players, games, scores, RSVPs, kicking orders, suspensions, promo codes, photos and permit numbers). The admin can rename it, change the first day and leave teams out. Captains still sign the waiver and pay, and someone suspended for good doesn't come back as captain.
- A dashboard for the next game day: games, refs, RSVP warnings, missing scores, and registrations, payments and waivers by team.
- A team sign-up challenge for a season: a prize and a deadline for the first team whose whole roster has an account and has signed the waiver. Each team sees "9 of 12 signed up" on its team page, signed-in players see a leaderboard of teams by percentage (team names and counts only), the first team to 100% wins (a tie goes to the team whose last player finished first), and an admin confirms the winner in the audit log. The dashboard shows every team's sign-up rate, lowest first, so admins know who needs a nudge.
- Instagram photos: an admin connects the league's professional account on Instagram's own sign-in, and recent posts sync daily with each photo copied to the site. Admins feature or hide posts, tag them to a team or event, set a cover for the home or a team page and describe each photo for screen readers; nothing shows until it is featured, unless the league turns on "show new posts". To stay on the free database tier it keeps only the 30 newest posts plus featured ones and covers, and at most 25 MB of photos, telling admins when that fills up. A post deleted on Instagram leaves the site at the next sync, a weekly job keeps the sign-in alive and emails admins if Instagram stops accepting it, and disconnecting deletes the token. Off until the Instagram app's ID and secret are set; development and the demo can use a recorded copy of the API instead ([ADR 0023](docs/adr/0023-instagram-photos-stored-in-postgres.md)).
- Member photos: a review queue to approve a photo, download its stored copy for Instagram, or reject it with a note only admins see. The player gets a non-urgent message either way. Approved photos can be taken down at any time, and every approve, reject and delete is in the audit log.
- An audit log of admin actions that admins and owners can read in plain words, newest first, with a filter for the platform operator's actions; and a permissions matrix enforced by one tested function.

**Owners**

- The books: for each season, money in from the payments the app already records (paid in the app, cash and Venmo, less refunds; league credit is shown beside it but not counted), money out by category (fields and permits, equipment, shirts, refs, events, sponsor costs, other) and the net. Owners add expenses from their phone with a photo of the receipt, which is shrunk on the server to one small copy without its location data and shown only to owners. A CSV for taxes lists every transaction with no player's name, and formula-looking text stays text. Only owners and the platform operator see the books, and their audit rows are hidden from admins ([ADR 0034](docs/adr/0034-owners-books-and-permits-in-postgres.md)).
- Game-day command center: one phone screen for the admins at the park with every game of the day, its field, the ref and whether they have checked in, and where each score stands (live with runs and inning, reported, final, called off or missing), the weather, and one tap to call a rain-out or send an announcement. It refreshes itself every 10 seconds by polling a small JSON route, with no realtime service. Refs check in with one tap on game day ("I'm at the field"), and an admin can mark a ref with no phone as there.
- Owner dashboard: membership by season (new, returning, and how many of the season before came back), money in and out by season from the books (registrations, tickets, payments made outside the app, refunds and league credit; expenses by category), each team's roster against its target with waiver and payment completion, event turnout (going against tickets checked in) and sponsor check-ins by week. Charts are drawn on the server with the numbers in tables beside them, and a CSV lists every number. Owners and the platform operator only; the numbers are at most five minutes old, with a button to refresh them.
- Where the money goes: owners can choose to publish a season's money summary, off until they do. It shows category totals and how each fee divides across them, never any one person's payment, name or contact details. Owners preview exactly what goes public, can fold a category into "Other" when its total would point at one person, and need at least ten members in the season before it can be published. The page is static and in the sitemap ([ADR 0038](docs/adr/0038-season-money-summary.md)).
- Park permits: each permit's cost (split across its dates, so it shows in the books), document, application window and renewal date, and the league's insurance certificate with its expiry. NYC Parks has no public permit API, so nothing is sent to it: "What to request" works out the fields, dates and hours the league needs from the number of teams, the game day and the slot length, as a sheet to copy into the application or download. Owners are emailed 30 and 7 days before an application window opens, a permit renews or the insurance runs out. When a permit is marked lost, its games are listed with a link to the schedule board.
- The permit at the field: a game's ref and both captains see its permit number and document from their home screen and the score page, and the installable app keeps it on their phone with the next game, for a park officer who asks without signal.
- Receipts, permit documents and certificates live in Postgres, up to 1 MB each and 50 MB in all, with a clear message at the cap.

**Public site**

- Public schedule, team and game pages. Anyone can see the season schedule (filter by team), each team's record, next game, results and roster (first name and last initial), and each game's time, field and score. Pages read only the published schedule version, never a draft.
- A playoff bracket page that draws winners' lines as it loads (still under reduced motion), with a plain list view of the same bracket.
- Motion that explains what changed: a game card grows into the game page's scoreboard and folds back into the schedule, a team's badge moves into its page header, run totals roll like a scoreboard during a live game, the winning total gets a burst of gold when the result comes in, and home sections rise into place as they scroll in. All of it is CSS and the browser's View Transitions API, and all of it is off under reduced motion.
- Team calendar feeds: every team has an `.ics` feed that Apple Calendar, Google Calendar and Outlook can subscribe to. Moved or rained-out games update in place.
- Featured photos from the league's Instagram on the home page and tagged ones on team and event pages, each linking back to its post.
- Players' approved photos on the team, event and game pages they were tagged to, with a link to share one.
- Home, About, FAQ and a park page, with a generated sitemap, robots file and structured data for the league, teams and games.
- Search landing pages: a city-wide page with subway routes and rough travel times from every borough, a free-agent page that explains joining without a team, and a "how to play kickball" guide. Each carries its own metadata and structured data (league, FAQ and article) and is linked from the home page and the sitemap.
- Sharing to WhatsApp: every game and team has a generated share image (1200 × 630, in the league's colors) for link previews, with the score on a final. One tap on a game or team page opens WhatsApp with a ready-made message and the link; a second button opens the phone's share sheet or copies the message. Admins can copy a rain-out notice, with every makeup, and any sent announcement as one message for the group chat.

**Demo mode**

- Turned on only by a server environment flag and refused in production: a banner on every page and one-tap "view as" a player, captain, ref or admin, plus a reset script that reseeds the demo database.

**Platform operator**

- A role above the league's owners for whoever runs the platform, set only in the server's environment ([ADR 0009](docs/adr/0009-platform-operator.md)). From a hidden console it sets owners and admins, makes the site read-only or pauses it (enforced on the server), switches features off, and downloads the whole league as JSON. Owners see every operator action in the audit log and can always download the same data.

**Sign-in**

- Email links and, when configured, Google.

## Design documents

| Document                                                     | What it covers                               |
| ------------------------------------------------------------ | -------------------------------------------- |
| [Product spec](docs/product-spec.md)                         | Roles, permissions matrix, features by phase |
| [Information architecture](docs/information-architecture.md) | Routes, user flows, key screens              |
| [Data model](docs/data-model.md)                             | Tables, constraints, indexes                 |
| [Scheduling algorithm](docs/scheduling-algorithm.md)         | The season scheduler and its property tests  |
| [Architecture](docs/architecture.md)                         | Stack, rendering, auth, jobs, security, CI   |
| [Design system](docs/design-system.md)                       | Tokens, type, components, motion, budgets    |
| [SEO plan](docs/seo-plan.md)                                 | Metadata, structured data, content           |
| [Roadmap](docs/roadmap.md)                                   | Phases and acceptance criteria               |
| [Decisions](docs/adr/)                                       | Architecture decision records                |

## Tech stack

Next.js 16 (App Router, Cache Components) · React 19 · TypeScript (strict) · Tailwind CSS v4 · Drizzle on Neon Postgres · Better Auth · Stripe · Resend · Vercel (with cron jobs)

Every service runs on its free tier, and no feature needs a paid plan, a paid API key or a monthly bill ([ADR 0021](docs/adr/0021-free-services-only.md)). Stripe has no monthly fee; its per-payment fees come out of the league's own payments. Each free limit and what the site does near it is in the [free-tier budget](docs/architecture.md#15-free-tier-budget).

Quality: Vitest (unit, property and database tests) · Playwright with axe · Lighthouse CI · gitleaks secret scanning · GitHub Actions

## Getting started

Requires Node 24 (`nvm use` reads `.nvmrc`).

```bash
npm install
cp .env.example .env.local   # fill in values; DATABASE_URL is your own Neon branch
npm run db:migrate           # apply migrations to that branch
npm run seed                 # a demo league: 8 teams, invented players, a season half played, three past seasons
npm run dev
```

Environment variables are validated with Zod in [`src/lib/env.ts`](src/lib/env.ts) whenever Next loads its config, so `npm run dev`, `npm run build` and `npm start` stop immediately and name any variable that is missing or malformed. Server code reads them through `env` from `src/env.ts`, never `process.env` directly.

### Turning on Google sign-in

Sign-in works by email link out of the box. Google is added when both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set (one without the other is rejected at startup):

1. In Google Cloud Console, create an OAuth client ID of type **Web application**.
2. Add the authorized redirect URIs `http://localhost:3000/api/auth/callback/google` and `https://kickball-league.vercel.app/api/auth/callback/google`.
3. Put both values in `.env.local`, and in Vercel with `npx vercel env add GOOGLE_CLIENT_ID --environment production` (and the same for the secret). Values go straight from your terminal to Vercel and are never committed.

### Turning on web push

Push is off until the league has a VAPID key pair. Generate one into `.env.local` (it prints only the public key):

```bash
npm run push:keys
```

For hosting, copy `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` from `.env.local` into the provider's encrypted settings. `VAPID_SUBJECT` (a `mailto:` address or `https://` URL push services can contact) is optional and defaults to the site's address. Keep the same pair once players have opted in: a new pair means every device has to opt in again. Push needs the service worker, which only production builds register, so try it with `npm run build && npm start`.

### Turning on the Instagram connection

The photo sync is off until both `INSTAGRAM_APP_ID` and `INSTAGRAM_APP_SECRET` are set. Like `DEMO_MODE`, they are read straight from the server's environment and checked where they are used, not in `src/lib/env.ts` or `.env.example`: one without the other, or a malformed value, leaves the connection off, and the server log and the Instagram admin screen name the variable to fix.

1. In Meta's developer dashboard, create an app with the **Instagram API with Instagram Login** product, and add the league's Instagram professional (Business or Creator) account to the app's roles. An app used only by its own account needs no App Review.
2. Add the redirect URI `<site address>/app/admin/instagram/callback`, for example `http://localhost:3000/app/admin/instagram/callback`.
3. Put the Instagram app ID and secret in `.env.local`, and in Vercel's encrypted settings for production. Then an admin chooses **Connect Instagram** on the Instagram admin screen.

To try the whole flow without an account, start the development server with `INSTAGRAM_FIXTURE=true` and no app ID: connecting and syncing then play back a recorded copy of the API (`src/services/fixtures/instagram`) with generated pictures. A production build ignores it unless demo mode is on.

### Email quota

The outbox keeps email inside the provider's free plan. It assumes Resend's free limits, 100 emails a UTC day and 3,000 a month, and keeps 10 of each back for sign-in links. Different limits can be set with the optional `EMAIL_DAILY_LIMIT`, `EMAIL_MONTHLY_LIMIT` and `EMAIL_RESERVE` (whole numbers), read straight from the environment like `DEMO_MODE`. What happens when the quota runs out is in [docs/architecture.md](docs/architecture.md), section 5, "The email budget".

### Run the database tests against a local Postgres

`npm run test:db` needs a real database, but not a Neon branch. With PostgreSQL installed locally (CI uses 18, the same major version as Neon; 16 passes too), one script creates a throwaway database matching CI's and applies every migration:

```bash
scripts/setup-local-postgres.sh
export DATABASE_URL=postgresql://ci:ci@localhost:5432/ci
npm run test:db
```

It starts the server if it is stopped, creates the `ci` role and `ci` database only when they are missing, and runs `npm run db:migrate`, so it is safe to run again after pulling new migrations. It connects as the `postgres` superuser (through `sudo` when you are not root); set `PG_SUPERUSER_URL` to connect another way, for example to a Postgres in Docker. Nothing here is a secret: the database is local and holds only test data.

### Demo mode

The demo deployment lets anyone view the league as a player, captain, ref or admin in one tap, with a banner on every page. It is off unless `DEMO_MODE=true` **and** the database's name contains `demo` **and**, on a Vercel production deployment, the project's address contains `demo`; see [ADR 0004](docs/adr/0004-demo-mode.md). To try it locally against a throwaway database:

```bash
PGDATABASE_NAME=kb_demo scripts/setup-local-postgres.sh
export DATABASE_URL=postgresql://ci:ci@localhost:5432/kb_demo DEMO_MODE=true
npm run demo:reset
npm run dev
```

The app talks to Neon through its HTTP and WebSocket drivers, and to a Postgres on `localhost` through node-postgres, so a local database works for `npm run dev` too.

### End-to-end and Lighthouse tests

`npm run test:e2e` builds the app and starts it twice: once as the league's site for the smoke tests, and once in demo mode for the flows, which reach every signed-in screen (the list is in [architecture](docs/architecture.md#end-to-end-coverage)). One of them walks a whole season: an admin sets up a season and its fields, a captain registers a team with split pay and pays through a signed Stripe webhook, a player joins by invite and pays their share, a free agent is placed on a new team, the schedule is published, a sub picks up a spot, a score is confirmed and counted in the standings, and a rain-out notice goes out. One journey per role (player, captain, ref, admin, owner and operator) walks that role's work across features, with people made up for it. Every key screen is checked with axe, and screens no flow visits are also checked in the dark theme and at a phone width. `npm run test:e2e:site-wide` then runs the operator's read-only, paused and feature switches on their own, since they change the site for every other test. `npm run test:e2e` seeds the database before building, so the public season and team pages are prerendered as in production and the flows check that their actions refresh them. Both reseed the database before the tests and send Stripe calls to [stripe-mock](https://github.com/stripe/stripe-mock), so they need both running locally:

```bash
PGDATABASE_NAME=kb_e2e_demo scripts/setup-local-postgres.sh
docker run -d --rm -p 12111:12111 stripe/stripe-mock:v0.197.0
export DATABASE_URL=postgresql://ci:ci@localhost:5432/kb_e2e_demo
npm run test:e2e
# Reuses the build the first command made.
E2E_PREBUILT=true npm run test:e2e:site-wide
```

The database's name must contain `demo`, because the flows sign in with one-tap "view as". To run beside another checkout's tests on the same machine, set `E2E_SMOKE_PORT` and `E2E_FLOWS_PORT` (3100 and 3110 by default). `npm run lighthouse` measures a production build (`npm run build` first) against the same seeded database, with the budgets in [design-system.md](docs/design-system.md#performance-budgets). It starts the server on port 3200 and warms every page before the first measurement.

In CI, the end-to-end and Lighthouse checks each build the app once and share that build across their shards: Playwright runs on two shards (`E2E_PREBUILT=true` starts the existing build instead of building again), and Lighthouse's pages are split across four runners (`node scripts/lighthouse-shard.mjs <shard> 4` writes one shard's config, with the same five runs and budgets). A pull request that changes only Markdown or `docs/` skips that work and still reports every required check as passed. The layout is in [architecture](docs/architecture.md#11-continuous-integration).

## Scripts

| Command                      | What it does                                                     |
| ---------------------------- | ---------------------------------------------------------------- |
| `npm run dev`                | Start the development server                                     |
| `npm test`                   | Run unit tests once                                              |
| `npm run test:coverage`      | Run unit tests with coverage of `src/domain` and `src/lib`       |
| `npm run db:generate`        | Generate a SQL migration from `src/db/schema`                    |
| `npm run db:migrate`         | Apply pending migrations to `DATABASE_URL`                       |
| `npm run db:check`           | Check migration files are consistent                             |
| `npm run db:studio`          | Browse the database in Drizzle Studio                            |
| `npm run test:db`            | Database constraint tests (each rolls back)                      |
| `npm run seed`               | Replace the demo league with fresh seed data; refuses production |
| `npm run demo:reset`         | Reseed the demo deployment; refuses unless demo mode is on       |
| `npm run push:keys`          | Add a new VAPID key pair for web push to `.env.local`            |
| `npm run lint`               | ESLint, failing on any warning                                   |
| `npm run typecheck`          | Generate route types and run `tsc`                               |
| `npm run format:check`       | Check Prettier formatting                                        |
| `npm run build`              | Production build                                                 |
| `npm run test:e2e`           | Seed, build, then smoke tests and core flows with axe            |
| `npm run test:e2e:site-wide` | Reseed, then the operator's site-wide switches on their own      |
| `npm run lighthouse`         | Lighthouse budgets on the public pages of the last build         |
| `npm run check:route-js`     | Every route's first-load JavaScript against its budget           |

## How changes land

Every change starts as an issue sized to 30–60 minutes, gets its own branch (`<issue>-<slug>`) and reaches `main` through a pull request that is rebase-merged, so each small commit stays in the history. Several changes are often built at once, each in its own worktree; the rules that keep them from colliding are in [`AGENTS.md`](AGENTS.md#working-in-parallel). `main` is protected by the ruleset in [`.github/rulesets/main.json`](.github/rulesets/main.json): pull request required, CI must pass on an up-to-date branch, linear history, no force-pushes or deletion. To apply a change to it:

```bash
gh api -X PUT repos/michael-fesselmeyer/kickball-league/rulesets/<id> --input .github/rulesets/main.json
```

## Project layout

`src/domain/` holds pure TypeScript (the scheduler, standings, permissions, pricing) with no framework or database imports, enforced by a lint rule. That is where the interesting logic and most of the tests live. See [architecture](docs/architecture.md#code-layout).
