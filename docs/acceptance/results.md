# Acceptance results

Rows are defined in [checklist.md](checklist.md). Each run records the commit tested, the result of every row and where each failure went.

## Run 1 (in progress)

- Date: 2026-11-14
- Commit: `c8c9b716` (main)
- Setup: production build (`npm run build`, `npm run start -- --port 3410`) on a freshly migrated and seeded local Postgres 18, demo mode on, Stripe calls to stripe-mock with signed test webhooks, CI's placeholder environment (no email provider: queued messages are checked in the `message` table). Driven in headless Chromium at 375 × 812 (desktop for the schedule screens).
- Data change for game day: the seed pins Fall 2026 to Sep 15 – Oct 27, so on the test date it had no upcoming games. Its three unplayed rounds were moved to Nov 14 (morning, so they had started), Nov 21 and Nov 28. The published version still names the old dates, so the Fall 2026 rain-out screen lists them; schedule, publish and rain-out were tested on Spring 2027 instead.

### Counts so far

52 pass, 2 fail, 1 not shipped (M6-5), of 118 rows. The rest are not yet run.

### Failures found

| Row | What | Next step |
|---|---|---|
| M5-5, M6-8 (home) | The signed-in home links to a season only while its registration is open. A rostered player, captain or ref in a running season has no link to their team, next game, RSVP or what they owe ([screenshot](screenshots/player-home-no-team.jpg)) | Issue (`acceptance`) |
| M5-2 | A disputed score queues no message to admins; it only shows on the Scores screen, and the dashboard's game-day card doesn't flag it | Issue or small fix |
| M6-7 | Team and game pages render no JSON-LD (`teamJsonLd` and `gameJsonLd` exist and are tested but no page uses them); the sitemap has no team, schedule or game pages | Small fix PR |
| Seed | Fall 2026 dates are fixed, so after Oct 27 the demo has no upcoming games, past games sit unscored, and the player's home is empty | Issue (`acceptance`) |

### UX notes (to file as `ux`)

- Home and footer have no link to the schedule, standings, teams, history or records; `/seasons/<slug>` is a 404, so no public page lists the seasons.
- Profile hint says "Players must be 18 or older" while registration asks "I'm 21 or older" (the league default); the sample waiver says 18 too.
- After signing the waiver the page offers only "Home", not "Next: pay".
- Rain-out is two steps on two screens (save the draft, then publish on the schedule screen).
- Unplaced-game messages show a raw date ("2027-04-19"); publishing with unplaced games gives no extra warning.
- Audit rows for publishing show raw field diffs and version ids.
- Captain screen's "Make a player" button reads oddly (means "make them a player again").
- Email topics are all on by default, including Announcements, while spec section 9 says news is off until a member turns it on.
- Each assigned game shows its own "I'm at the field" button, but one tap checks the ref in for the whole day.

### Row results

| ID | Result | Note |
|---|---|---|
| M3-6 | pass | Schedule shows only published games; team filter goes to ?team=sun-kickers, "Showing 7 games for Sun Kickers" |
| P2-11 | pass | Neon week and Costume week marked on their game days |
| M5-3 | pass | W/L/T/DIFF table, tiebreaker notes in words, power rankings with movement |
| M6-6 | pass | Home, About, FAQ, park page load at 375 px with no horizontal scroll |
| M6-7 | fail | Sitemap and robots fine; JSON-LD on home, park, events, sponsors, FAQ, article; team and game pages have none (teamJsonLd/gameJsonLd built and tested but never rendered); sitemap has no team, schedule or game pages |
| M6-5 | n/a | /rules not built: the rulebook text stays out until the league agrees (AGENTS.md) |
| S9-5 | pass | Seeded published summary: category totals, per-fee split, no names |
| M5-5 | pass | Team page In/Maybe/Out; counts update (10 in -> 9 in, 1 out); aria-pressed state |
| M4-1 | pass | Under-18 refused ("Players must be 18 or older."); valid save "Saved."; phone and emergency contact required |
| F-5 | pass | Player ticks a week, "Away weeks saved. Your captain sees who is available each week." |
| P2-31a | pass | Download your data gives kickball-league-my-data-2026-11-14.json |
| M4-5a | pass | Captain's roster board: Waiver and Paid per person, "16 signed the waiver, 16 paid"; invite link made and copyable |
| M5-6 | pass | Captain sees in/maybe/out counts and the fielding note ("Short-handed: you can field 9 (5 and 4)"); availability per week with who is away |
| M6-4 | pass | Team announcement: "Sent to 16 people. Anyone who turned announcements off is skipped." |
| P3-4 | pass | Kicking order: rule explained, auto-arrange, up/down buttons, keyboard hint; removed player flagged; player sees "You kick 2nd of 10" |
| P2-28 | pass | Scheduling requests screen with conflicts and preferences, closed after the deadline with an admin override note |
| M5-7 | pass | Ref home lists assigned games with Score, "I'm at the field" and Kicking orders |
| F-8 | pass | "I'm at the field" checks the ref in for all of that day's games (by design, referee-actions.ts) |
| M5-1 | pass | Ref score screen at 375 px: two numbers and Save, about 3 s to save; forfeit and "called early" with complete innings offered |
| M5-2 | pass | Captain confirms: "Confirmed. The score is final."; dispute button and note present |
| M5-3b | pass | Public standings and the static game page updated at once after the confirm (Big Kicks 3-1 to 4-1, +21 to +24) |
| P3-6 | pass | Captain rates the other team after a final: "Thanks. Your rating is saved."; average hidden until 3 more ratings |
| P2-15a | pass | Game page head to head ("lead the series 3-1") and streaks |
| P2-2 | pass | Ref picks who kicks first, taps runs per half-inning; the public game page showed "Live: Bottom of the 1st" in about 6 s with no reload. Called-game revert not exercised by hand (unit-tested) |
| M5-2b | fail | Dispute works ("Disputed. An admin will sort it out.") and shows on admin Scores, but no admin is messaged: no admin message is queued and the dashboard's game-day card doesn't flag it |
| M5-4 | pass | Admin Scores lists disputed and missing games with the reminder schedule; dashboard shows "Missing scores" |
| M6-8 | pass | Admin home: next game day (games, refs, forfeit risk), registrations, payments and waivers by team, sign-up rate |
| M3-1 | pass | Season settings saved (status, early bird, dates, minimum age, games per day): "Saved." |
| M4-9 | pass | Early bird ($85 to $75) and promo SPRING10 (10%) applied: Checkout total $67.50 |
| M4-2 | pass | Profile required before registering; waiver shown in full; agree, typed name and "I'm 21 or older" required; payment locked until signed; stored name, IP, SHA-256 and age |
| M4-3 | pass | New person registers a team (per-player season, so no split-pay choice here); becomes captain; checklist captain/waiver/pay |
| M4-8 | pass | Signed checkout.session.completed: processed; same event again: duplicate; a second event for the same session: no second payment (1 payment, $67.50) |
| M4-5 | pass | New player opens the invite link, joins, signs, pays $75; captain's board shows both signed and paid |
| M4-6 | pass | Free agent registers, signs, pays; listed in the admin pool |
| P2-6 | pass | Quiz is five taps (saved in a few seconds); "Your friend code is 4UU-SXQ ... Up to 4 of you stay together" |
| P2-7 | pass | Matcher: suggestions with reasons (keeps groups, lineup needs, positions, vibe), before/after table, apply one, build-a-team form |
| M4-7 | pass | Applying a suggestion places the free agent: "Suggestion applied. They're on the team." |
| S9-1 | pass | Scripted at 375 px: sign-in, profile, team, waiver and Checkout took well under two minutes of app time (human typing not measured) |
| M3-3 | pass | Generate: every metric with a status word (good/review/poor), and each unplaced game says why ("could not be placed on 2027-04-19: no free slot suits both teams"; raw ISO date in that sentence) |
| M3-4 | pass | Move by form saves a new draft and recomputes the metrics (field spread 1 to 3, poor) before publishing; the board shows hard-rule problems live |
| M3-5 | pass | Publish: "Published. 0 games moved, 36 games added and 0 games removed; 9 teams affected."; version table keeps history. Publishing with 9 unplaced games gives no extra warning |
| M3-6b | pass | Public Spring 2027 schedule refreshed at once after publish ("Showing all 36 games", new team listed) |
| M6-1 | pass | Rain-out: pick a day, preview each game's makeup with the fairness change, save as draft, publish: "4 games moved ... 4 rain-out emails queued"; only the 4 rostered players on affected teams, each with their own was/makeup time. It is two steps on two screens (save draft, then publish) |
| P2-4a | pass | Rain-out preview has "Copy for WhatsApp" for the notice |
| M3-2 | pass | Permit hours (2 windows), "4 slots added, 42 kept", blackout added with "Cut slots again to apply it" |
| M6-3 | pass | League announcement: "Sent to 16 people"; sent announcement has "Copy for WhatsApp" |
| M4-10 | pass | Partial refund asks for a sign-in from the last 15 minutes (clear message, nothing refunded); fresh: "Refund of $20 pending", then "Refunded $20 of $75" after charge.refunded |
| M3-10 | pass | Audit log lists each admin and captain action newest first; publish rows show raw field diffs (version ids, "none -> 36"), not plain words |

| P0-2 | pass | All migrations applied to an empty database |
| P0-5 | pass | Session 90 days, renewed daily on use (src/lib/auth/config.ts) |
| P0-6 | pass | Public repo, labels, milestones, issue and PR templates; ruleset: PR with rebase only, linear history, 5 required checks |
| P0-7 | pass | CI on c8c9b716 all green and required |
| P0-9 | pass | Seed: 8 teams, 113 people, 28 games (16 played) |
| M6-10 | pass | Lighthouse shards and axe checks green on c8c9b716 |
| M6-11 | pass | e2e covers split pay, free agent, publish, score confirm, rain-out; green on c8c9b716 |

### Resume here

Not yet run: P0-1, P0-3, P0-4, P0-8, M2-1..3 (a scheduler property test timed out only while a build loaded the machine; rerun), M3-7..9, M4-4, M4-11, M6-2, M6-9, P2-1 (needs playoff-day permit hours), P2-3, P2-5, P2-8..10, P2-12..14, P2-16..27 (except P2-15), P2-29, P2-30, P2-32..34, P3-1..3, P3-5, P3-7..10, S9-2..4, S9-6..11, F-1..4, F-6, F-7, F-9..18. Then file the issues above, open the fix PRs, and re-run the failed rows.
