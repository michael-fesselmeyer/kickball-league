# Acceptance results

Rows are defined in [checklist.md](checklist.md). Each run records the commit tested, the result of every row and where each failure went. Failed rows are run again after their fixes merge.

## Run 1

- Dates: 2026-11-14, in two sittings: rows up to M3-10 on `c8c9b716`, the rest on `c06dd521` (main after 58 more commits, including pick'em, the capacity planner and the error page). Rows passed in the first sitting were not repeated.
- Setup: production build (`npm run build`, `npm run start -- --port 3410`) on a freshly migrated and seeded local Postgres 18, demo mode on, Stripe calls to stripe-mock with signed test webhooks, CI's placeholder environment (no email provider, so queued messages were checked in the `message` table). Driven with real clicks in Chromium at 375 × 812, the schedule and some admin screens at desktop size, and key public pages in the dark theme.
- Data change for game day: the seed pins Fall 2026 to Sep 15 – Oct 27, so on the test date it had no upcoming games (#317). Its three unplayed rounds were moved to Nov 14 (morning, so they had started), Nov 21 and Nov 28. Schedule generation, publishing and the rain-out were run on Spring 2027, whose published version wasn't touched.

### Counts

119 pass, 5 fail, 2 not applicable here, 1 not run, of 127 rows.

### Failures and their fixes

A failed row passes again only after its fix merges and the row is run again; the "Row results" table shows the latest result.

| Row | What | Issue | Fix | Re-run |
|---|---|---|---|---|
| M5-5, M6-8 | The signed-in home links to a season only while its registration is open, so a rostered player, captain or ref in a running season has no link to their team, next game or RSVPs ([before](screenshots/player-home-no-team.jpg), [after](screenshots/player-home-your-season.png)) | [#314](https://github.com/michael-fesselmeyer/kickball-league/issues/314) | [#340](https://github.com/michael-fesselmeyer/kickball-league/pull/340), open | Checked on the PR's build; re-run after merge |
| M5-2 | A disputed score queues no message to admins, and the dashboard shows it only the next day | [#315](https://github.com/michael-fesselmeyer/kickball-league/issues/315) | [#338](https://github.com/michael-fesselmeyer/kickball-league/pull/338), open | After merge |
| M6-7 | No JSON-LD on team and game pages; no team or schedule pages in the sitemap | [#316](https://github.com/michael-fesselmeyer/kickball-league/issues/316) | [#339](https://github.com/michael-fesselmeyer/kickball-league/pull/339), merged | Passed |
| S9-3 | No one-click unsubscribe per topic and no `List-Unsubscribe` header; announcements on by default | [#331](https://github.com/michael-fesselmeyer/kickball-league/issues/331) | [#342](https://github.com/michael-fesselmeyer/kickball-league/pull/342), open (the unsubscribe; the announcement default waits for the owners) | After merge |
| M3-2 | "Cut slots" after adding playoff hours cancelled slots holding final games | [#332](https://github.com/michael-fesselmeyer/kickball-league/issues/332) | [#341](https://github.com/michael-fesselmeyer/kickball-league/pull/341), open | After merge |
| M3-1 | A new season has no waiver, and registration opens anyway, stranding players before payment | [#345](https://github.com/michael-fesselmeyer/kickball-league/issues/345) | Not started | – |
| Seed | Fall 2026's dates are fixed, so after Oct 27 the demo has no upcoming games | [#317](https://github.com/michael-fesselmeyer/kickball-league/issues/317) | Not started | – |

### UX issues

Things that work but would confuse a volunteer:

- [#333](https://github.com/michael-fesselmeyer/kickball-league/issues/333): no link from the home page or footer to schedules, standings or teams, and no list of seasons. Not started.
- [#334](https://github.com/michael-fesselmeyer/kickball-league/issues/334): the minimum age reads 18 on the profile and the sample waiver, 21 at registration. Fix: [#343](https://github.com/michael-fesselmeyer/kickball-league/pull/343), open.
- [#335](https://github.com/michael-fesselmeyer/kickball-league/issues/335): no next step after signing the waiver. Fix: [#344](https://github.com/michael-fesselmeyer/kickball-league/pull/344), open. (Saving the quiz already returns to the season page; the first report misread it.)
- [#336](https://github.com/michael-fesselmeyer/kickball-league/issues/336): admin copy (raw audit diffs, an ISO date, "Make a player", per-game check-in buttons that check in the whole day, a new-team card that contradicts itself, a 115-name vote dropdown, a full-pay team's invite text). Not started.

Also seen, not filed: the demo seed has no emergency contacts on file and no registrations for past seasons (the owner dashboard shows 0 members for them); Summer 2026 has no bracket.

### Row results

| ID | Area | Result | Note |
|---|---|---|---|
| P0-1 | Tooling | pass | Fresh worktree on the latest main: npm ci, npm run build and npm test (211 files, 2176 tests) pass |
| P0-2 | Database | pass | Every migration applies to an empty database (both sittings, including new ones on the latest main) |
| P0-3 | Sign-in | pass | Sign-in page offers an email link and a passkey; asking for a link writes it (here the page then says "We couldn't send the link just now", since this setup has no email provider); opening a link signs in and lands on /app. Google shows only when configured |
| P0-4 | Session guard | pass | Signed out, /app/profile goes to /sign-in?next=%2Fapp%2Fprofile |
| P0-5 | Session length | pass | Session lasts 90 days and renews daily on use (src/lib/auth/config.ts) |
| P0-6 | GitHub | pass | Public repo, labels, milestones, issue and PR templates; ruleset "Protect main": PR with rebase only, linear history, no force-push or deletion, 5 required checks |
| P0-7 | CI | pass | CI on main (c8c9b716, a08c9c46) green: lint, types, tests, build, migrations, 3 e2e shards, 4 Lighthouse shards, secret scan, all required. The newest main at writing, 35a7540d, failed Lighthouse shard 3 of 4 |
| P0-8 | Design tokens | pass | /style shows buttons, stickers and team badges; light and dark themes, no overflow |
| P0-9 | Seed | pass | Seed: 8 teams, 113 people, 42 slots, 28 games (16 played), Spring 2027 ready to schedule |
| M2-1 | Scheduler module | pass | Scheduler tests pass, including the property tests and the 8-team snapshot (an earlier 5 s timeout happened only while a build was loading the machine) |
| M2-2 | Scheduler speed | pass | npm run bench: both benchmarks assert p50 under 300 ms (24 teams over 12 dates; the worked example) and pass |
| M2-3 | Scheduler coverage | pass | Scheduler coverage 100% lines, branches and functions |
| M3-1 | Season setup | fail | Season settings saved (status, early bird, dates, minimum age, games per day): "Saved." · A new season gets no waiver, and registration can be opened anyway, leaving players at "This season has no waiver yet" with no way to pay (#345) |
| M3-2 | Fields and permits | fail | Permit hours (2 windows), "4 slots added, 42 kept", blackout added with "Cut slots again to apply it" · Adding playoff hours and pressing "Cut slots" cancelled 20 slots in use, including slots of final September games, because the seeded 9:00 PM slots don't match the cutter's back-to-back 55-minute slots (#332) |
| M3-3 | Schedule draft | pass | Generate: every metric with a status word (good/review/poor), and each unplaced game says why ("could not be placed on 2027-04-19: no free slot suits both teams"; raw ISO date in that sentence) |
| M3-4 | Edit by form | pass | Move by form saves a new draft and recomputes the metrics (field spread 1 to 3, poor) before publishing; the board shows hard-rule problems live |
| M3-5 | Publish and diff | pass | Publish: "Published. 0 games moved, 36 games added and 0 games removed; 9 teams affected."; version table keeps history. Publishing with 9 unplaced games gives no extra warning |
| M3-6 | Public schedule | pass | Schedule shows only published games; team filter goes to ?team=sun-kickers, "Showing 7 games for Sun Kickers" · Public Spring 2027 schedule refreshed at once after publish ("Showing all 36 games", new team listed) |
| M3-7 | Team page | pass | Team page: record and place, next game, coming up, results table, scores still to come; roster names as first name and last initial |
| M3-8 | Game page | pass | Final game page: score, when (league time zone), where with a map link, head to head, share buttons, players' photos |
| M3-9 | Team calendar | pass | Team .ics: VCALENDAR with 26 events, each with a UID, time zone set, CRLF line endings, lines folded at 75 bytes |
| M3-10 | Audit | pass | Audit log lists each admin and captain action newest first; publish rows show raw field diffs (version ids, "none -> 36"), not plain words |
| M4-1 | Profile | pass | Under-18 refused ("Players must be 18 or older."); valid save "Saved."; phone and emergency contact required |
| M4-2 | Waiver | pass | Profile required before registering; waiver shown in full; agree, typed name and "I'm 21 or older" required; payment locked until signed; stored name, IP, SHA-256 and age |
| M4-3 | Team registration | pass | New person registers a team (per-player season, so no split-pay choice here); becomes captain; checklist captain/waiver/pay |
| M4-4 | Full pay | pass | Per-team season: the captain picks "I'll pay it all: $1,000"; Checkout for $1,000; after the webhook the board shows them signed and paid |
| M4-5 | Invite and share | pass | Captain's roster board: Waiver and Paid per person, "16 signed the waiver, 16 paid"; invite link made and copyable · New player opens the invite link, joins, signs, pays $75; captain's board shows both signed and paid |
| M4-6 | Free agent | pass | Free agent registers, signs, pays; listed in the admin pool |
| M4-7 | Place free agent | pass | Applying a suggestion places the free agent: "Suggestion applied. They're on the team." |
| M4-8 | Webhook | pass | Signed checkout.session.completed: processed; same event again: duplicate; a second event for the same session: no second payment (1 payment, $67.50) |
| M4-9 | Early bird and promo | pass | Early bird ($85 to $75) and promo SPRING10 (10%) applied: Checkout total $67.50 |
| M4-10 | Refund | pass | Partial refund asks for a sign-in from the last 15 minutes (clear message, nothing refunded); fresh: "Refund of $20 pending", then "Refunded $20 of $75" after charge.refunded |
| M4-11 | Payment reminders | pass | Payment reminder job tests (src/emails/payment-reminder and domain notifications) pass in the unit run |
| M5-1 | Score entry | pass | Ref score screen at 375 px: two numbers and Save, about 3 s to save; forfeit and "called early" with complete innings offered |
| M5-2 | Confirm or dispute | fail | Captain confirms: "Confirmed. The score is final."; dispute button and note present · Dispute works ("Disputed. An admin will sort it out.") and shows on admin Scores, but no admin is messaged: no admin message is queued and the dashboard's game-day card doesn't flag it (#315) |
| M5-3 | Standings | pass | W/L/T/DIFF table, tiebreaker notes in words, power rankings with movement · Public standings and the static game page updated at once after the confirm (Big Kicks 3-1 to 4-1, +21 to +24) |
| M5-4 | Missing scores | pass | Admin Scores lists disputed and missing games with the reminder schedule; dashboard shows "Missing scores" |
| M5-5 | RSVP | fail | Team page In/Maybe/Out; counts update (10 in -> 9 in, 1 out); aria-pressed state · Not reachable from home: once registration closes, the signed-in home has no link to the team page where RSVPs live (#314) |
| M5-6 | RSVP counts | pass | Captain sees in/maybe/out counts and the fielding note ("Short-handed: you can field 9 (5 and 4)"); availability per week with who is away |
| M5-7 | Ref assignment | pass | Ref home lists assigned games with Score, "I'm at the field" and Kicking orders |
| M6-1 | Rain-out | pass | Rain-out: pick a day, preview each game's makeup with the fairness change, save as draft, publish: "4 games moved ... 4 rain-out emails queued"; only the 4 rostered players on affected teams, each with their own was/makeup time. It is two steps on two screens (save draft, then publish) |
| M6-2 | Outbox | pass | Outbox tests (same-transaction writes, retry, dedupe) pass in the unit run |
| M6-3 | League announcement | pass | League announcement: "Sent to 16 people"; sent announcement has "Copy for WhatsApp" |
| M6-4 | Team announcement | pass | Team announcement: "Sent to 16 people. Anyone who turned announcements off is skipped." |
| M6-5 | Rulebook | n/a | /rules not built: the rulebook text stays out until the league agrees (AGENTS.md) |
| M6-6 | Content pages | pass | Home, About, FAQ, park page load at 375 px with no horizontal scroll |
| M6-7 | SEO | pass | Sitemap and robots fine; JSON-LD on home, park, events, sponsors, FAQ, article; team and game pages have none (teamJsonLd/gameJsonLd built and tested but never rendered); sitemap has no team, schedule or game pages (#316) · Re-run after #339 merged: team pages carry SportsTeam and game pages SportsEvent JSON-LD; the sitemap lists 11 team pages and 5 schedules |
| M6-8 | Admin dashboard | pass | Admin home: next game day (games, refs, forfeit risk), registrations, payments and waivers by team, sign-up rate |
| M6-9 | Demo | pass | Demo banner on every page with one-tap Player, Captain, Ref, Admin |
| M6-10 | Accessibility and speed | pass | Lighthouse shards and axe checks green in CI on main |
| M6-11 | End-to-end tests | pass | e2e covers split-pay registration, free agent, publish, score confirm and rain-out; green in CI on main |
| P2-1 | Playoffs | pass | With playoff-day permit hours, "Make the bracket" seeds 1-8 from the standings, places rounds on the free slots (semifinals move to the next date when a day is full), publish: "Winners move on as scores become final" |
| P2-2 | Live scoring | pass | Ref picks who kicks first, taps runs per half-inning; the public game page showed "Live: Bottom of the 1st" in about 6 s with no reload. Called-game revert not exercised by hand (unit-tested) |
| P2-3 | Share images | pass | Game and team share images are 1200x630 PNG; WhatsApp link carries the text and the page link; "Copy the message" button |
| P2-4 | Copy for WhatsApp | pass | Rain-out preview has "Copy for WhatsApp" for the notice |
| P2-5 | Sub finder | pass | Captain asks for 2 subs: "We're emailing 57 players who could sub"; a free agent taps "I'm in" and holds a spot; captain approves; sub sees "You're playing!" |
| P2-6 | Free-agent quiz | pass | Quiz is five taps (saved in a few seconds); "Your friend code is 4UU-SXQ ... Up to 4 of you stay together" |
| P2-7 | Matcher | pass | Matcher: suggestions with reasons (keeps groups, lineup needs, positions, vibe), before/after table, apply one, build-a-team form |
| P2-8 | New-team request | pass | Free agent asks to start "Cash Kickers": "Request sent"; admin sees it with the note and approves: "The team is forming and the captain has been emailed."; team created in forming status |
| P2-9 | Weather | not run | The chip shows only when the forecast reaches the game; the next game was 7 days out and, after the slot re-cut bug (#332) cancelled this run's November slots, no game was in range. Needs a current-dated seed (#317) |
| P2-10 | Events and RSVP | pass | RSVP "You're going. See you there!" with a drop option; a full event: "You're number 4 on the waitlist" with leave option |
| P2-11 | Theme weeks | pass | Neon week and Costume week marked on their game days |
| P2-12 | Sponsors | pass | Sponsors page: team of the week with the tab at the home bar; sponsor pages with deals (Restaurant structured data) · Team of the week saved: "It's on the sponsors page now." |
| P2-13 | QR check-in | pass | Rotating bar code; player checks in ("You're checked in"), today's deals shown, "Deal used. Show this screen" |
| P2-14 | Weekly numbers | pass | Sponsor's weekly numbers: check-ins, players, teams, deals used by week, counts only |
| P2-15 | Fun with scores | pass | Game page head to head ("lead the series 3-1") and streaks · Records page (most runs, biggest win, highest-scoring game, longest streak), power rankings, streaks, head to head |
| P2-16 | Weekly recap | pass | Recap drafted from templates (results with playful lines, power rankings), editable, sent as an announcement: "Sent to 116 people" |
| P2-17 | Awards voting | pass | One vote per award, can't be changed: "Your vote: Alex K. Results show when voting closes."; self left out of player polls, own team left out of team polls · Admin closes voting: "Voting closed. The results are up."; results rank every team with vote counts, ties share a place ("2nd ... 2nd"), "40 votes cast" |
| P2-18 | Installable app | pass | Manifest (standalone, 3 icons, start /app), service worker served, offline page |
| P2-19 | Push settings | n/a | Push topics show only when VAPID keys are set; this setup has none |
| P2-20 | Captain guarantee | pass | Split team: "$84 of $1,000 paid. $916 left", Pay the remaining $916 (Checkout $916), Save a card as guarantee: "Visa ending 4242 guarantees the balance" with the 72-hour warning and Remove card. The deadline charge job itself was not run |
| P2-21 | League credit | pass | Goodwill credit: unknown email refused ("Nobody with that email has an account yet"); "Credit given. It shows on the player's account and comes off their next fee." · "Use my $5 league credit" ticked at payment; Checkout total $70 of $75; ledger shows the credit spent |
| P2-22 | Rebates | pass | Rebates screen: games lost, paid and rebate per team with the 25% rule explained |
| P2-23 | Waitlist | pass | Season full (9 of 9): "Join the waitlist ... 48 hours to claim it"; "You're #1 on the waitlist" |
| P2-24 | Referral | pass | Pat's /r/ link: two people who registered through it and paid (one by cash, one through Stripe) each gave Pat $10 of referral credit |
| P2-25 | History | pass | History: champions per season, all-time table; team page has a season switcher |
| P2-26 | Motion | pass | View-transition rules present and switched off under prefers-reduced-motion |
| P2-27 | Schedule board | pass | Board by keyboard: Enter picks up ("Picked up …"), arrows move with a live check ("no new problems"), Enter drops, Save as a new draft makes version 2 (manual edit) |
| P2-28 | Conflicts and preferences | pass | Scheduling requests screen with conflicts and preferences, closed after the deadline with an admin override note |
| P2-29 | Shirts | pass | Shirts: sizes by team, ordered and received counts, no-size count |
| P2-30 | CSV exports | pass | Roster CSV with shirt sizes (118 lines); payments CSV link per season and per team |
| P2-31 | Data export and deletion | pass | Download your data gives kickball-league-my-data-2026-11-14.json · Delete page lists what is deleted and what the league keeps; deletion is switched off in demo mode by design (needs a non-demo run to exercise) |
| P2-32 | Passkeys and devices | pass | Passkeys and devices: add-passkey button, this device listed with sign-in and last-used times |
| P2-33 | Instagram | pass | Instagram admin (recorded fixture): Connect, feature, hide, tag, cover, alt text; Feature saved; home page shows featured posts linking to Instagram |
| P2-34 | Search content | pass | City-wide page, free-agent page and how-to-play guide load with their structured data (FAQPage, Article, SportsOrganization) |
| P3-1 | Offline score entry | pass | Offline (service worker active): "Saved on this phone, will send when you're back online."; back online: "Sent: Final: Grand Slammers 3, Foul Play 2"; one report stored |
| P3-2 | Sponsor portal | pass | Sponsor portal: edit, add or turn off deals, show the check-in code, edit details, give a person access by email (admin view) |
| P3-3 | Paid event tickets | pass | Ticket at the member price ($10 of $15), spot held while paying; after Stripe's webhook "You have a ticket", check-in code shown · Admin sees ticket holders and what they paid ("$10 card"), checks in by code at the door ("Pat Player is checked in."), refunds: "The ticket is cancelled, the buyer got an email, and the spot went to the waitlist." |
| P3-4 | Kicking order | pass | Kicking order: rule explained, auto-arrange, up/down buttons, keyboard hint; removed player flagged; player sees "You kick 2nd of 10" |
| P3-5 | Incidents and suspensions | pass | Ref reports an incident (kind, people involved, details): "Report sent. The league's admins will review it."; audited · Admin reviews the report, suspends for 1 game: "Suspended. They've been emailed the length and how to appeal."; the player sees why they can't RSVP and the In buttons are disabled; captain sees "Suspended, 1 more game" only |
| P3-6 | Sportsmanship | pass | Captain rates the other team after a final: "Thanks. Your rating is saved."; average hidden until 3 more ratings |
| P3-7 | Member photos | pass | Photo upload (JPEG, tagged to the team, consent box): "Thanks! Your photo is with the league for review"; listed as waiting with a Delete button · Admin queue shows storage use (0.4 MB of 100 MB), approve, download, reject with a note: "Approved. It's on its pages now, and the player has been told." |
| P3-8 | Merch | pass | Shop: member price $20, Checkout, after the webhook "League shirt (M) Ordered · $20" · Admin marks an order fulfilled ("The buyer gets a note"); orders CSV for the printer |
| P3-9 | Divisions | pass | Divisions added with rule sets (Competitive/Social), crossover settings form · Divisions screen: add divisions with rule sets, crossover count, combined final (teams not assigned in this run) |
| P3-10 | Friends directory | pass | Friends page grouped by activity, "Links to us" marks, ItemList structured data · Admin adds a friend league: a plain http link is refused ("Use the site's https:// address"); https saved: "It's on the public page now." |
| S9-1 | Fast sign-up | pass | Scripted at 375 px: sign-in, profile, team, waiver and Checkout took well under two minutes of app time (human typing not measured) |
| S9-2 | One account, installable | pass | Manifest start_url /app and the same cookie sign-in, so the installed app shares the browser's session |
| S9-3 | Opt out | fail | Every email says why it came and links to the settings page (sign-in needed), but there's no one-click unsubscribe per topic and no List-Unsubscribe header; announcements are on by default for new members (#331) |
| S9-4 | Alerts that fit | pass | Daily limit, digest (evenings or Sundays) and quiet hours on the profile with defaults; "Message limits saved."; each email has a "why you got this" line |
| S9-5 | Money summary | pass | Seeded published summary: category totals, per-fee split, no names · Owner preview shows exactly what goes public; publishing (15 members) puts /seasons/spring-2027/money live |
| S9-6 | Off-app payments | pass | Admin records cash for a signed, unpaid player (method and note): "Payment recorded. They're paid up." (shown once the waiver is signed). Captain's version is for split-fee teams and was not reached, since these seasons charge per player |
| S9-7 | Events with invite link | pass | Members-only prom shows "RSVP on partiful.example.test" in the app and is absent from the public events page and feed · Admin creates an event (public, Partiful link, capacity, optional announce): "It's on the events page now."; audiences public, members, teams |
| S9-8 | Specials stay current | pass | Sponsor portal "Yes, all still current": "Every deal is marked as current as of today." |
| S9-9 | Owners' books | pass | Books: money in (in app, outside, refunds), money out by category, net; expense with a receipt photo: "Expense added."; tax CSV has no player names (checked against every profile name) |
| S9-10 | Owner dashboard | pass | Owner dashboard: members (new, returning, retention), money, completion, refresh button, CSV. Past seasons show 0 members because the seed gives them games but no registrations |
| S9-11 | Permits | pass | Permits: cost, dates, renewal, document, insurance certificate; "What to request" sheet with CSV |
| F-1 | Age check | pass | Born 2006 with the league minimum 21: "Thanks for wanting to play! Players in this league must be 21 or older ... If your birth date on your profile is wrong, fix it there." instead of the forms |
| F-2 | Captain handoff | pass | Offer: "Offer sent. You stay captain until they accept."; teammate sees the offer with Become captain / No thanks; accepting makes them captain and the old captain a co-captain; audited |
| F-3 | Co-captains | pass | "Make co-captain": "They're a co-captain now."; captain_handoff and team_role emails queued |
| F-4 | Not-on-my-team list | pass | New captain adds a member with a reason: "Added. Nobody tells them."; audited. A person already approved as a sub stays in that game |
| F-5 | Away weeks | pass | Player ticks a week, "Away weeks saved. Your captain sees who is available each week." |
| F-6 | Emergency contacts | pass | Today's game: captains and the ref see each player's contact ("Opening this page is recorded"); a future game and an admin get 404; reads are in the audit log. The seed has no contacts on file, so the demo shows none |
| F-7 | Game-day command center | pass | Command center at phone size: every game of the day with field, ref "not here yet" with Mark here, score state, rain-out and announcement buttons; "Last checked" moved from 3:52:48 to 3:52:58 on its own |
| F-8 | Ref check-in | pass | "I'm at the field" checks the ref in for all of that day's games (by design, referee-actions.ts) |
| F-9 | Season rollover | pass | Rollover creates a draft season with 8 teams and their captains: "Captains still sign the waiver and pay; apply for the permits before opening registration." |
| F-10 | Merge accounts | pass | Merge preview shows both accounts and what moves; not executed in this run |
| F-11 | Sign-up challenge | pass | Sign-up challenge started with prize and deadline; teams ranked with "1 of 14 signed up · 7%" and how many more are needed |
| F-12 | Giveaways | pass | Giveaway with prize, donor, winner count, window and official rules (no purchase necessary); rotating code; player enters once ("You're in! Good luck."). Draw not exercised (entry was still open) |
| F-13 | Alert limits | pass | Daily limit 1 and Sunday digest saved: "Message limits saved." |
| F-14 | Permit at the field | pass | Ref's permit page: permit number, field and hours, "Show this to a park officer" |
| F-15 | Operator console | pass | Operator console: Read-only blocks changes ("your last change was not saved") and back to Active; feature switch on and off (audited as the operator); league JSON export (288 KB); non-operators see "This page could not be found" (HTTP 200, since the page streams) |
| F-16 | Team lists for admins | pass | Admin sees every list with who added it, plus a "worth a look" check for long or overlapping lists |
| F-17 | Private event feed | pass | Private events feed (webcal and Google links) per member; public events .ics has the 7 public events only |
| F-18 | Dark theme and phone layout | pass | Dark theme on home, schedule, standings, team, events, sponsors and style: dark background, no horizontal scroll at 375 px |
| F-19 | Pick'em | pass | Pick'em: next game day's games, "Picks saved. Good luck!", lock at each kickoff, hide-me option, free with no prizes · Pick'em page back after the feature is switched on again |
| F-20 | Capacity planner | pass | Capacity planner: "The field time you hold fits 12 teams", game days, field hours, how many want to play, ways to make room |
| F-21 | Error page | pass | Seen when the local database was missing a migration: "That didn't load. Something on our side went wrong … Try again / Go to the home page" |

### Not run, and why

- P2-9 (Weather): The chip shows only when the forecast reaches the game; the next game was 7 days out and, after the slot re-cut bug (#332) cancelled this run's November slots, no game was in range. Needs a current-dated seed (#317)
