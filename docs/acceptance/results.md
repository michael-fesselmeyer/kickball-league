# Acceptance results

Rows are defined in [checklist.md](checklist.md). Each run records the commit tested, the result of every row and where each failure went. Failed rows are run again after their fixes merge.

## Run 1

- Dates: 2026-11-14, in two sittings: rows up to M3-10 on `c8c9b716`, the rest on `c06dd521` (main after 58 more commits, including pick'em, the capacity planner and the error page). Rows passed in the first sitting were not repeated.
- Setup: production build (`npm run build`, `npm run start -- --port 3410`) on a freshly migrated and seeded local Postgres 18, demo mode on, Stripe calls to stripe-mock with signed test webhooks, CI's placeholder environment (no email provider, so queued messages were checked in the `message` table). Driven with real clicks in Chromium at 375 × 812, the schedule and some admin screens at desktop size, and key public pages in the dark theme.
- Data change for game day: the seed pins Fall 2026 to Sep 15 – Oct 27, so on the test date it had no upcoming games (#317). Its three unplayed rounds were moved to Nov 14 (morning, so they had started), Nov 21 and Nov 28. Schedule generation, publishing and the rain-out were run on Spring 2027, whose published version wasn't touched.

### Counts

124 pass, 0 fail, 2 not applicable here, 1 not run, of 127 rows.

### Failures and their fixes

A failed row passes again only after its fix merges and the row is run again; the "Row results" table shows the latest result.

| Row | What | Issue | Fix | Re-run |
|---|---|---|---|---|
| M5-5, M6-8 | The signed-in home links to a season only while its registration is open, so a rostered player, captain or ref in a running season has no link to their team, next game or RSVPs ([before](screenshots/player-home-no-team.jpg), [after](screenshots/player-home-your-season.png)) | [#314](https://github.com/michael-fesselmeyer/kickball-league/issues/314) | [#340](https://github.com/michael-fesselmeyer/kickball-league/pull/340), merged | Passed on a build of `main` at `7f614f94`: player and captain homes show "Your season" with a link to the team page |
| M5-2 | A disputed score queues no message to admins, and the dashboard shows it only the next day | [#315](https://github.com/michael-fesselmeyer/kickball-league/issues/315) | [#338](https://github.com/michael-fesselmeyer/kickball-league/pull/338), merged | Passed on a build of `main` at `4a134a1c` |
| M6-7 | No JSON-LD on team and game pages; no team or schedule pages in the sitemap | [#316](https://github.com/michael-fesselmeyer/kickball-league/issues/316) | [#339](https://github.com/michael-fesselmeyer/kickball-league/pull/339), merged | Passed on a build of `main` at `2d7d6aa8` |
| S9-3 | No one-click unsubscribe per topic and no `List-Unsubscribe` header; announcements on by default | [#331](https://github.com/michael-fesselmeyer/kickball-league/issues/331) | [#342](https://github.com/michael-fesselmeyer/kickball-league/pull/342), merged (the unsubscribe), and [#442](https://github.com/michael-fesselmeyer/kickball-league/pull/442), merged (announcements off for new accounts) | Passed on `main` at `213614f7`: a new account has announcements off and the urgent topics on; the unsubscribe page and one-click POST turn a topic off, and a GET changes nothing |
| M3-2 | "Cut slots" after adding playoff hours cancelled slots holding final games | [#332](https://github.com/michael-fesselmeyer/kickball-league/issues/332) | [#341](https://github.com/michael-fesselmeyer/kickball-league/pull/341), merged | Passed on `main` at `7f614f94`: re-cutting slots left all 16 final games' slots open ("18 slots from games already played were left as they were") |
| M3-1 | A new season has no waiver, and registration opens anyway, stranding players before payment | [#345](https://github.com/michael-fesselmeyer/kickball-league/issues/345) | [#348](https://github.com/michael-fesselmeyer/kickball-league/pull/348), merged | Passed on `main` at `244ee08d`: the settings page warns, opening registration without a waiver is refused (the season stays a draft), and the rollover preview names the waiver |
| Seed | Fall 2026's dates are fixed, so after Oct 27 the demo has no upcoming games | [#317](https://github.com/michael-fesselmeyer/kickball-league/issues/317) | [#351](https://github.com/michael-fesselmeyer/kickball-league/pull/351), merged | Passed on `main` at `244ee08d`: `demo:reset` moved the league 5 weeks, so the next game day is Tue Nov 17; `npm run seed` keeps its calendar |

### UX issues

Things that work but would confuse a volunteer:

- [#333](https://github.com/michael-fesselmeyer/kickball-league/issues/333): no link from the home page or footer to schedules, standings or teams, and no list of seasons. Fix: [#349](https://github.com/michael-fesselmeyer/kickball-league/pull/349), merged; passes on `main` at `244ee08d`.
- [#334](https://github.com/michael-fesselmeyer/kickball-league/issues/334): the minimum age reads 18 on the profile and the sample waiver, 21 at registration. Fix: [#343](https://github.com/michael-fesselmeyer/kickball-league/pull/343), merged; passes on `main` at `244ee08d`.
- [#335](https://github.com/michael-fesselmeyer/kickball-league/issues/335): no next step after signing the waiver. Fix: [#344](https://github.com/michael-fesselmeyer/kickball-league/pull/344), merged; passes on `main` at `244ee08d`. (Saving the quiz already returns to the season page; the first report misread it.)
- [#336](https://github.com/michael-fesselmeyer/kickball-league/issues/336): admin copy (raw audit diffs, an ISO date, "Make a player", per-game check-in buttons that check in the whole day, a new-team card that contradicts itself, a 115-name vote dropdown, a full-pay team's invite text). Fix: [#350](https://github.com/michael-fesselmeyer/kickball-league/pull/350), merged; checked on `main` at `244ee08d`: audit in words, "No longer co-captain"; the ref's single check-in needs a game day today to try.

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
| M3-1 | Season setup | pass | Season settings saved (status, early bird, dates, minimum age, games per day): "Saved." · A new season gets no waiver, and registration can be opened anyway, leaving players at "This season has no waiver yet" with no way to pay (#345) · Re-run after #348 merged, on `main` at `244ee08d`: opening registration without a waiver is refused with a message and the settings page warns |
| M3-2 | Fields and permits | pass | Permit hours (2 windows), "4 slots added, 42 kept", blackout added with "Cut slots again to apply it" · Adding playoff hours and pressing "Cut slots" cancelled 20 slots in use, including slots of final September games, because the seeded 9:00 PM slots don't match the cutter's back-to-back 55-minute slots (#332) · Re-run after #341 merged, on `main` at `7f614f94`: all final games' slots stayed open |
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
| M5-2 | Confirm or dispute | pass | Captain confirms: "Confirmed. The score is final."; dispute button and note present · Dispute works ("Disputed. An admin will sort it out.") and shows on admin Scores, but no admin is messaged: no admin message is queued and the dashboard's game-day card doesn't flag it (#315) · Re-run after #338 merged: a captain's dispute queued an urgent `score_dispute` alert to the admin and the owner (teams, score, note, link to the Scores screen), and the dashboard lists the game as "Disputed" on its own game day |
| M5-3 | Standings | pass | W/L/T/DIFF table, tiebreaker notes in words, power rankings with movement · Public standings and the static game page updated at once after the confirm (Big Kicks 3-1 to 4-1, +21 to +24) |
| M5-4 | Missing scores | pass | Admin Scores lists disputed and missing games with the reminder schedule; dashboard shows "Missing scores" |
| M5-5 | RSVP | pass | Team page In/Maybe/Out; counts update (10 in -> 9 in, 1 out); aria-pressed state · Not reachable from home: once registration closes, the signed-in home has no link to the team page where RSVPs live (#314) · Re-run after #340 merged, on `main` at `7f614f94`: the home links to the team page |
| M5-6 | RSVP counts | pass | Captain sees in/maybe/out counts and the fielding note ("Short-handed: you can field 9 (5 and 4)"); availability per week with who is away |
| M5-7 | Ref assignment | pass | Ref home lists assigned games with Score, "I'm at the field" and Kicking orders |
| M6-1 | Rain-out | pass | Rain-out: pick a day, preview each game's makeup with the fairness change, save as draft, publish: "4 games moved ... 4 rain-out emails queued"; only the 4 rostered players on affected teams, each with their own was/makeup time. It is two steps on two screens (save draft, then publish) |
| M6-2 | Outbox | pass | Outbox tests (same-transaction writes, retry, dedupe) pass in the unit run |
| M6-3 | League announcement | pass | League announcement: "Sent to 16 people"; sent announcement has "Copy for WhatsApp" |
| M6-4 | Team announcement | pass | Team announcement: "Sent to 16 people. Anyone who turned announcements off is skipped." |
| M6-5 | Rulebook | n/a | /rules not built: the rulebook text stays out until the league agrees (AGENTS.md) |
| M6-6 | Content pages | pass | Home, About, FAQ, park page load at 375 px with no horizontal scroll |
| M6-7 | SEO | pass | Sitemap and robots fine; JSON-LD on home, park, events, sponsors, FAQ, article; team and game pages have none (teamJsonLd/gameJsonLd built and tested but never rendered); sitemap has no team, schedule or game pages (#316) · Re-run after #339 merged: team pages carry SportsTeam and game pages SportsEvent JSON-LD; the sitemap lists 11 team pages and 5 schedules. Confirmed again on a build of main at 2d7d6aa8 |
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
| S9-3 | Opt out | pass | Every email says why it came and links to the settings page, and has a one-click unsubscribe per topic with List-Unsubscribe headers (#342). Re-run on `main` at `213614f7` after #442: a brand-new account has announcements off and the urgent topics (rain-outs, payment reminders, scores and the rest) on; the unsubscribe page turned payment reminders off after a confirm, and the one-click POST turned scores off (a GET returns 405 and changes nothing) |
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

## Run 2

- Date: 2026-11-15, Phase A: every row of [Added for run 2](checklist.md#added-for-run-2) that is on `main`, on a production build of `main` at `061faeaa`. Rows waiting for a pull request run in Phase B, once the merge and schema queues drain. Run 1's rows were not repeated.
- Setup: as run 1: `npm run build`, then `npm run start -- --port 3420`, on a freshly migrated local Postgres (Docker) seeded with `npm run demo:reset` (demo mode on), Stripe calls to stripe-mock, CI's placeholder settings (no email provider, so queued messages were checked in the `message` table). Driven with real clicks in Chromium at 375 × 812, admin and owner screens at desktop size unless a row says phone. People who aren't demo personas (a second admin, an owner, new players) signed in with a one-time link; the owner role was given from the operator console.
- Data: the first `demo:reset` moved the league 8 weeks and put Fall 2026's played games in the future (#541). The rows ran on the data that fix makes (5 weeks): played games end Nov 10, a round is live tonight and the next game day is Tue Nov 24.

### Counts

66 pass, 3 fail, 0 not run, of 69 rows on `main`. 28 rows wait for pull requests (Phase B).

### Failures and their fixes

A failed row passes again only after its fix merges and the row is run again.

| Row | What | Issue | Fix | Re-run |
|---|---|---|---|---|
| R2-X2 | `demo:reset` follows the second demo league's calendar and moves the main league 8 weeks, so played games with scores land on Nov 17 to Dec 1 | [#541](https://github.com/michael-fesselmeyer/kickball-league/issues/541) | [#542](https://github.com/michael-fesselmeyer/kickball-league/pull/542), open | After it merges |
| R2-A9 | Publishing one edited rules section marks every section as changed, with the new start date on all of them (the browser's CRLF line breaks) | [#545](https://github.com/michael-fesselmeyer/kickball-league/issues/545) | [#547](https://github.com/michael-fesselmeyer/kickball-league/pull/547), open | After it merges |
| R2-P6 | The player's stats page mixes in their season from the other league, under the same title, and adds it to career totals | [#552](https://github.com/michael-fesselmeyer/kickball-league/issues/552) | Not started | After a fix merges |

### Other issues found

- [#550](https://github.com/michael-fesselmeyer/kickball-league/issues/550): at phone size the profile scrolls sideways (446 px): the daily message limit select grows to its longest option ([screenshot](screenshots/run2-profile-overflow.png)). Fix: [#551](https://github.com/michael-fesselmeyer/kickball-league/pull/551), open. The rows that use the profile passed otherwise.
- [#553](https://github.com/michael-fesselmeyer/kickball-league/issues/553): the seed signs no waivers, so game-day check-in flags all 30 players "No waiver".
- [#554](https://github.com/michael-fesselmeyer/kickball-league/issues/554): the demo's live round is moved to tonight without a permit for today: the live screen and command center say "2806 minutes left in the permit", the permit page shows the Nov 17 hours, the rain-out screen offers a Nov 17 with no games, and one ref has three games at once. It waits for #522 and #476, which change the same file.

### UX notes

Not filed; for the copy and UI pass:

- Ejection notice: "Ejected this game: Wren O.." (double period).
- The schedule's versions table says "Problems: None" for a draft whose H12 permit problem is listed just below it.
- The private-event request shows "Contact , organizer.pat@example.test" when the organizer has no name yet.
- The permit renewal screen reads "Playing fall, Wed, Sep 1, 2027"; the application packet says "Borough not known" while the give-back form names BK.
- Field layouts: attaching a file while "This field needs no layout" is still ticked, then unticking it, sends no file and shows "Upload a layout, or tick that the field needs none, before adding a note."
- The help search shows its matches above the full list rather than filtering the list.

### Row results

| ID | Area | Result | Note |
|---|---|---|---|
| R2-V1 | Seasons page | pass | /seasons lists Spring 2027 (coming up), Fall 2026 (being played), Summer 2026 and earlier, each with schedule and standings links; linked from the footer |
| R2-V2 | Help center | pass | /help lists how-tos by role; typing "rain" shows "1 how-to found. Call a rain-out · Admins" above the full list; /help/captain has numbered how-tos (invite players, kicking order, scores, co-captains, subs), each under its own anchor |
| R2-V3 | Schedule widget | pass | /widget gives a one-line iframe for /embed/schedule; the embed lists the next game day's games with times and fields and is the only page allowed in a frame (frame-ancestors *); others send X-Frame-Options DENY |
| R2-V4 | Rules page | pass | /rules: sections with anchors, "New wording from January 10, 2027", dated "What changed" list. Division game settings show only when a division has a rule set; the seeded Fall 2026 has none, so none shown (by design, src/db/queries/rules.ts) |
| R2-V5 | Park page | pass | /fields/mccarren-park: "Permitted by NYC Parks: Kickball League (demo) holds the fields and hours below, and only those", the next permitted days with each field's hours and permit number; linked from the park page as "See who has which field today" |
| R2-V6 | Contact the league | pass | /contact (no account): park-rules category, rule, date, place, message, reply email: "Got it! Thanks. The league's admins read every message."; the form doesn't show it again; the admin queue lists "How the park is used (public)" |
| R2-V7 | Private events | pass | /private-events is public with "Request a booking", which leads a signed-in organizer (a new example.test account) to the form: "Request sent. We emailed you a confirmation"; their list shows "Waiting for the league" |
| R2-V8 | Game-day status | pass | Public schedule: "Tue, Nov 24: Some games start late. Field 2 still wet." and "Starts late: 8:30 PM" on the delayed game |
| R2-V9 | Rulings in public | pass | Public game page: "Forfeit", "The Big Kicks win by forfeit"; the reason appears nowhere |
| R2-V10 | Clubs run by players | pass | /friends lists "Run by our players" first (Sunday Sketch Club); /events shows it as a featured card with "More friends of the league" |
| R2-V11 | Default league address | pass | /l/demo-league, /l/demo-league/seasons and /l/demo-league/seasons/fall-2026/standings answer 308 to the plain addresses; /l/flag-football/… answers 200 |
| R2-V12 | Security headers | pass | / and /app send CSP, X-Frame-Options DENY, Referrer-Policy, nosniff, HSTS and Permissions-Policy; /app signed out goes to /sign-in?next=%2Fapp |
| R2-P1 | Free-agent quiz | pass | A new free agent's quiz: three self-ratings (still learning, solid, a strength), competitive or fun, game nights, optional note and a friend code; five taps and Save in under 2 seconds: "Thanks! Your answers are saved." |
| R2-P2 | Shirt size at sign-up | pass | New account (riley.newcomer@example.test): profile with shirt size L; Spring 2027's register page offers XS to XXL in both the team and free-agent forms, starting at the profile's size; joining as a free agent with M saves M on the profile; next steps: quiz, waiver, pay $85 |
| R2-P3 | Volunteer shifts | pass | Player signs up for the set-up lead shift: "You're on the shift. Thanks for helping out!", listed under "Your shifts" with a set-up checklist link; another member sees it "Full"; "Drop" frees the spot ("You've dropped the shift", 1 of 1 left) |
| R2-P4 | Season survey | pass | Ref (on a Summer 2026 team) answers the five questions: "Thanks! Your answers are in."; opening it again: "You've already answered." |
| R2-P5 | Season card | pass | Card: Champions, games, team runs, win streak, record, best game, superlatives earned ("Highest-scoring team in the league", "Cardiac kid: 2 wins by a single run"); "Make my card's link public" gives a public page with WhatsApp sharing; home links to "Your Summer 2026 season in kickball" |
| R2-P6 | Player stats | fail | /app/stats works (stats with "based on N of M games", leaderboard opt-out), but it also lists the player's season in the other league (flag football) as a second "Fall 2026 · The Big Kicks" with no league name, and adds it to the career totals |
| R2-P7 | Raise a concern | pass | "Raise a concern" from home: category, optional park rule and game, message; "Your concerns" lists "How a game was played · Sent Nov 15 · Open" |
| R2-P8 | Field check-in | pass | Captain's "Show the check-in code" (code changes every few minutes); the player opens the game's check-in link with it, taps Check in: "You're checked in ... playing for The Big Kicks"; the captain's list goes to 2 checked in |
| R2-P9 | Partiful event | pass | Members-only prom: "The guest list is on partiful.example.test" and an "RSVP on" button; no in-app RSVP or waitlist; calendar and WhatsApp copy still there |
| R2-P10 | Short-handed team | pass | Team page RSVP note: "10 in · 0 maybe · 0 out · 6 no answer. Short-handed: you can field 9 (5 and 4), a lineup the rulebook allows"; below-6 forfeit wording is covered by unit tests (#489), not reproduced with seeded RSVPs |
| R2-C1 | Game-day checklist | pass | Captain's game-day checklist (linked from home on game day): 4 before and 2 after items for their own team; a tick survives a reload |
| R2-C2 | Attendance | pass | Ticked Bea Silva in by hand and saved: "1 checked in", flagged as not signed this season's waiver; the team's attendance page counts games per player (Bea 1). Every seeded player shows "No waiver" because the seed signs no waivers (see issues) |
| R2-C3 | Ruling on our game | pass | The captain's score screen shows "Forfeit ruling · Pitch Please forfeited · Reason: …" and when the admin ruled |
| R2-C4 | Injury report | pass | Captain's injury form (who was hurt, body area, care, witnesses, what happened): "Report sent. The league's owners and admins will follow up."; opening the admin report afterwards is a 404 for the captain |
| R2-C5 | Permit time on live | pass | Captains open the live screen only when their game has no ref (score.live); this game had one, so the line was seen as the ref: "2806 minutes left in the permit" (wrong here because of the demo live round, #554). The warning near the end is checked by src/domain/gameday/permit-end.test.ts, which passes |
| R2-R1 | Ref availability | pass | Ref page lists each Fall 2026 game time; ticking Nov 24 8:00 PM and saving: "Saved. Thanks!"; times already reffed are fixed with "ask an admin" |
| R2-R2 | Drop a game | pass | "Can't make it?" on Dec 1 with a reason, "Drop this game": the assignment is declined and the game leaves the ref's list. Asking the pool happens only within a day of the game, so no pool messages were due; "Take it" not exercised |
| R2-R3 | Quick live scoring | pass | Live screen: two "+1 run" taps then Undo leave 1; the count survives a reload; End half saves the bottom of the 4th and moves to the top of the 5th; Undo reopens the half with its run; the public game page shows "Live: Bottom of the 4th" with the same line score |
| R2-R4 | Eject a player | pass | "Eject a player" (Wren O., with a reason): "Ejected. They're out of the kicking order for the rest of the game, and the league has the report." Copy nit: "Ejected this game: Wren O.." has a double period. The lineup page had no saved order, so the ejected mark there wasn't seen |
| R2-R5 | Permit and layout | pass | Ref's permit page on game day: permit number, field, hours, the permit document and the field's layout image with its note ("Diamond in the north corner.") |
| R2-R6 | Ref who also plays | pass | Not reproducible with the seed (the assigner never puts a ref on their own team's game); checked with the fix's tests: src/domain/scores/scores.test.ts (21) and src/db/queries/score-confirmations.db.test.ts (6) pass |
| R2-A1 | Game-day status | pass | At phone size: Tue Nov 24 set to Watching (decide by 7:00 PM, reason), then Delayed for one game to 8:30 PM: "Saved, and the players in the affected games are being told." |
| R2-A2 | Game-day pack | pass | "Print game-day pack" for Tue Nov 24 with rosters: one sheet per field with the permit line ("Permit SAMPLE-0042. Permit on file"), a printed-permit box, each game's blank line score (innings 1-7, X, R), a QR code for the score, captains' initials, then a check-in sheet per team with sub lines |
| R2-A3 | Scheduled announcement | pass | Announcement scheduled for Sat Nov 28: listed under Scheduled, "sends Sat, Nov 28, 8:30 AM"; edited ("Saved the changes to the scheduled announcement.") and cancelled; audit has announcement.schedule, .edit and .cancel |
| R2-A4 | Game day for WhatsApp | pass | "Game days for the group chat": each game day's games, times, fields and address as text, with a "Copy for WhatsApp" button per day |
| R2-A5 | Rain-out to the owners | pass | A plain admin (not the operator) sees "Send Tue, Nov 24 to the owners to confirm" instead of Cancel; sending: "Sent to the owners", one rainout_request message, audited as rainout.prepare, and the screen says who sent it and "Waiting for an owner to confirm". (The demo admin is also the operator in this setup, so it may confirm directly.) |
| R2-A6 | Ref assigner and pay | pass | Caleb Dubois added to the pool by email; once both refs ticked their Dec 1 times, "4 of 6 games have a proposed ref", each ref kept on one field for back-to-back games, two games explained ("Everyone free then plays in it, has another game, or would have to change fields"); "Accept all": "4 refs assigned." Pay sheet: $25 a game, 6 worked, "Mark paid" by cash or Venmo |
| R2-A7 | Season checklist | pass | Season checklist: open tasks first with "Due in 37 days · Tue, Dec 22 · Addie Admin"; "Mark done": "Ticked off. Nice work."; "Add the task" (Pick up the trophy, Dec 1): "Added the task.", listed as "Due in 16 days" |
| R2-A8 | Win-back list | pass | Spring 2027 opened for registration: "Not signed up yet (116)", the most loyal first ("The Big Kicks in Fall 2026 · 2 seasons"), "Email all 116 not emailed yet"; one Email sends one (win_back_email 1). Before opening, the page says the list shows only while registration is open |
| R2-A9 | Rules editor | fail | Rules editor: changed one sentence of Lineups, start Dec 1: "Published."; /rules shows the entry, but it lists "Lineups changed, Fielding changed, Playoffs changed" and all three say "New wording from December 1, 2026": the browser's CRLF line breaks make untouched sections look edited (#545, fixed in #547) |
| R2-A10 | Shirt order | pass | Shirt order: 116 players, all with a size; sizes by team with each team's color and a league total; status "Not placed yet", vendor CSV, sizes offered (XS to XXXL) |
| R2-A11 | Concerns queue | pass | Concern page: reply ("Reply to the sender"), admin note, close with what was done; 3 concern_update emails (received, reply, closed); the player sees the reply and the closing note but not the admin note; the queue shows the share answered within a day |
| R2-A12 | Injury reports | pass | Injury report: person, body area, care, witnesses, the retention date and "Only owners and admins can read this"; viewing and the carrier CSV are audited (injury.view, injury.export) |
| R2-A13 | Permit coverage | pass | Spring 2027 draft, then Field 1's May 10 permit marked lost: the schedule lists "H12: Field 1's permit for that time was marked lost." and offers no Publish button; restoring the permit brings it back. The versions table still says "Problems: None" for that draft |
| R2-A14 | Field layouts | pass | Field layouts: a PNG with a note saves ("Layout saved.", "A layout is on file"); with Field 2 set to neither, Publish is refused: "A field this schedule uses has no layout yet. Add one, or confirm none is needed". Attaching a file while "This field needs no layout" is still ticked and then unticking it sends no file ("Upload a layout, or tick that the field needs none, before adding a note.") |
| R2-A15 | Written rulings | pass | Admin sets "Pitch Please forfeited" on a final game: with no reason, "A forfeit, or a change to a score that was reported or is final, needs a written reason."; with one, "Score saved." and 8 game_ruling messages (both teams' captains and co-captains, and the ref). Reversed to the played score with a reason; audit has game.forfeit and game.forfeit_reversed |
| R2-A16 | Volunteer shifts | pass | Admin posts a Setup shift and a Set-up lead shift for Tue Nov 24: "Shift posted. Members can sign up now."; the admin list shows who signed up and spots left; the set-up lead's page says it opens on that game day and lists the coming one |
| R2-A17 | League gear | pass | Kit "Ball bag A" added ("It's at its home until someone picks it up"); assigned to Dec 1 8:00 PM with Reese R. bringing it: "Assigned. They'll get a reminder the evening before." and "brings it to McCarren Park, Field 1 by 7:30 PM" |
| R2-A18 | Stat awards | pass | Summer 2026 stat awards: MVP weights form, "Work out the awards": "Awards worked out. Check them below, then publish."; a draft with Season MVP (Quinn U., 100 points, based on 7 of 7 games), Iron Kicker, Golden Boot ("No one qualified this season"), Best Teammate, Rookie, Sub of the Year, each with "How it's worked out" and a note box. Not published in this run |
| R2-A19 | Season cards | pass | Season cards for Summer 2026: 7 built; "Refresh the cards" keeps sharing choices; 7 season_card messages queued once |
| R2-A20 | Survey results | pass | "Open the survey and invite players": 7 survey_invite messages; results show "1 of 7 players answered (14%)", "Average: 5.0 out of 5", answers per choice and comments, never who |
| R2-A21 | Private event requests | pass | Admin queue shows the request (what, when, contact, note); "Set up the private season" with dates and an organization-paid $600: a private season (registration open) and the organizer's page; a second private_event email; the season is not on /seasons. Copy nit: the contact reads ", organizer.pat@example.test" when the account has no name yet |
| R2-A22 | Clubs | pass | Friends admin: "Run by our players · on the events page" on Sunday Sketch Club, links-back and click counts per entry ("None yet"), with a note that blocked pings aren't counted |
| R2-A23 | Suspension history | pass | A captain's unsportsmanlike report naming Wren Okafor shows "Ejected once before: Sun, Nov 15 … Threw the ball at a runner's head after a warning." beside the suspend form |
| R2-A24 | Command center order | pass | At phone size: Today shows status, rain-out, checklist, announcement, refs and print buttons, the forecast card, counts (4 games, 4 of 4 refs, 3 playing) and fields in start-time order. The permit line reads "2804 minutes left in the permit" because of the demo's live round (#554); a game past its permit end couldn't be produced with this data |
| R2-A25 | Season attendance | pass | Season attendance lists every team's players with games played from field check-in (Bea Silva and Pat Player 1 after this run's check-ins; seeded games have no check-ins, which #508 adds) |
| R2-A26 | Hand-added game kept | pass | No screen adds a game without a round, so checked with its database test: "hand" cases in src/db/queries/schedule.db.test.ts pass |
| R2-O1 | Confirm a rain-out | pass | The owner sees "Caleb Dubois sent this rain-out to the owners ... Confirm it below" and confirms: "Rain-out saved as a draft with the makeups"; publishing it queued 115 rain-out emails. "Let admins confirm rain-outs too" saved ("Admins can now confirm rain-outs themselves"), audited as rainout.confirm_policy, and then a plain admin gets the Cancel button; setting turned back off |
| R2-O2 | Books, quicker | pass | At phone size: quick add ($36.75, Equipment) "Expense added." and the next form starts on Equipment; an expected "Bar deposit" listed to confirm or skip; a bank CSV preview leaves out the money-in row, guesses Equipment, Shirts and Fields and permits, and imports 2; an out-of-pocket expense shows "Omar Abara is owed $22.00" with "Reimbursed" |
| R2-O3 | Permit fees | pass | Permits: "Permitted hours 42 of 50" with the 50-hour insurance warning, fees due date, "Give back field time" for the rained-out Nov 24 with the borough office's answers ready to copy. Fee estimates show only for permits with no cost; the seeded permit has one |
| R2-O4 | Permit renewal | pass | Renewal: NYC Parks' renewal and new-request windows, each held field and weekday ("Keep it, 20:00–22:00, 7 dates"), and dates outside the next period called out; packet: league, season, team and player counts, rosters only if chosen. Copy nits: "Playing fall, Wed, Sep 1" in lower case; the packet's request sheet says "Borough not known" while the give-back form says BK |
| R2-O5 | Season report card | pass | Report card beside Summer 2026: people (registered, returning, new, share back), money from the books, games (16 played, 4 rained out), sportsmanship 4.2, community (survey, events, 204 bar check-ins), CSV; the shareable version leaves out money and anything about one person. Summer 2026 shows 7 players because the seed registers few people in past seasons (seen in run 1) |
| R2-O6 | Checklist template | pass | Owner adds "21 days before the start" task to the checklist template: "Added the task to the template." |
| R2-X1 | Build and migrations | pass | Fresh database kb_accept2_demo: every migration applied; npm run build passed on 061faeaa (after clearing a stale .next/dev left by an old dev server in the worktree) |
| R2-X2 | Demo reset | fail | demo:reset moved the league 8 weeks, not 5: the second demo league's calendar set the move and Fall 2026's played games landed on Nov 17 to Dec 1 with scores (#541, fixed in #542; rows below ran on the data #542 makes: 5 weeks) |
| R2-X3 | CI | pass | CI on 061faeaa (the commit tested) passed. Later, while this ran, main's 30dff76b failed end-to-end shard 4 of 4 (left to the merge queue) |
| R2-X4 | More than one league | pass | The second demo league (flag football) has its own seasons and standings under /l/flag-football with its own teams; a team slug shared with the main league ("the-big-kicks") stays separate. The player's stats page mixes the two (R2-P6, #552) |

### Waiting for Phase B

These rows run after their pull requests merge. [#457](https://github.com/michael-fesselmeyer/kickball-league/pull/457) (lost and found) merged after the build tested here, so R2-P13 runs in Phase B too.

| ID | Area | Waiting for |
|---|---|---|
| R2-V13 | Interest sign-ups | #463 |
| R2-V14 | Languages | #447, #448, #526, #533 |
| R2-V15 | Guest teams | #479 |
| R2-V16 | Searchable rulebook | #490 |
| R2-V17 | Email code sign-in | #530 |
| R2-P11 | Open to a new team | #537 |
| R2-P12 | Choose alerts | #536 |
| R2-P13 | Lost and found | #457 |
| R2-P14 | Code of conduct | #458 |
| R2-P15 | Leadership check-in | #538 |
| R2-P16 | Phone apps | #525 |
| R2-C6 | Captain polls | #454 |
| R2-C7 | Shirt opt-out | #475 |
| R2-R7 | Cards | #478 |
| R2-R8 | Daylight clock | #476 |
| R2-R9 | Delayed game clock | #522 |
| R2-A27 | Shared fields | #460 |
| R2-A28 | Playoff formats | #459 |
| R2-A29 | Tournaments | #479 |
| R2-A30 | Interest forms | #463 |
| R2-A31 | Code of conduct editor | #458 |
| R2-A32 | Captain polls | #454 |
| R2-A33 | Late-joiner shirts | #475 |
| R2-A34 | Sport types | #488 |
| R2-A35 | Demo data | #508 |
| R2-A36 | Fixes between features | #522 |
| R2-O7 | Acting admin | #477 |
| R2-O8 | Paste the rulebook | #490 |
