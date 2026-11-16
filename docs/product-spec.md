# Product spec

Status: draft v1, 2026-11-11; goals added 2026-11-12 (section 9).
Items marked **(A)** are assumptions waiting on an answer in [open-questions.md](open-questions.md).

## 1. What this is

A web platform that runs an adult kickball league end to end: registration and payment, waivers, a fair season schedule, game-day scores and standings, rain-outs, subs, events, and sponsor value. The first league is Brooklyn Kickball Club (BKC), which plays at McCarren Park on a night or afternoon that changes by season. League name, colors and logos are configuration, not code.

It replaces brooklynkickballclub.com, which today offers account registration, a season list, a rulebook PDF, a dead scores link, and social links that point to a different league (Golden State Kickball).

### Goals

1. Run a real season with less work for the commissioners and captains than the current mix of website, Venmo and WhatsApp.
2. Win the owners over. They have not agreed to switch, so the first audience is a demo that makes the decision easy.
3. Serve as a flagship portfolio piece: deployed, tested, fast, accessible, and documented.

### How we will know it works

| Measure | Target for the first real season |
|---|---|
| Players registered and paid through the site | 90% or more of rostered players |
| Captain time spent collecting money | No manual Venmo requests needed |
| Final scores recorded the same day | 100% (today umpires sometimes forget) |
| Rain-out notice reaches players | Within 10 minutes of the admin's decision |
| Schedule fairness | No team more than 1 game off an even split of time slots and fields |
| Public pages | Lighthouse mobile performance 95+, accessibility 100 |

## 2. What we know about the league

| Fact | Source |
|---|---|
| One league at McCarren Park (Williamsburg/Greenpoint). Play days follow the park permits and change by season: summer on Sunday afternoons (about 2 to 6 pm), spring on Monday evenings (about 8 to 10 pm), fall on Tuesday evenings; all subject to change | Owner of this project (updated 2026-11-12) |
| About 8 teams in spring and fall, about 12 in summer | Owner of this project |
| Usually 3 fields; often only 2 in summer | Owner of this project |
| Spring and fall: 7 innings, one game per team per game day. Summer: 5 innings, usually two games per team per game day | Owner of this project |
| A game is 7 innings or 90 minutes, whichever comes first; no new inning in the last 10 minutes | Rulebook 3.1 |
| Regular-season games can end in a tie; playoff games cannot | Rulebook 3.1.2 |
| A game called after 4 complete innings counts, with the score at the last complete inning | Rulebook 3.1.5 |
| Players must be 18+, registered, on a team, and must have signed the "Amateur Athletic and Release of Liability" | Rulebook 2.1 |
| The app's minimum age is a league setting, 18 by default, and a league or season can raise it (never below 18). Players confirm it to register and to sign the waiver ([ADR 0041](adr/0041-age-check-at-registration.md), [ADR 0050](adr/0050-minimum-age-defaults-to-18.md)) | Owner of this project |
| On defense: at most 11 fielders and at most 6 of any gender. Short-handed options: 9 (4 and 5) or 7 (4 and 3). Fewer than 7 is a forfeit | Rulebook 2.3 |
| Kicking order: no more than 2 players of the same gender in a row. A team with more than twice as many of one gender as the other may keep a separate order for each | Rulebook 2.2.4 |
| Short teams may pick up other registered players, who kick last. Not allowed in playoffs. A team needs at least 6 of its own players for the game to count | Rulebook 2.1.4, 2.1.6.1, 2.7 |
| Home and away are decided by rock-paper-scissors at the field | Rulebook 3.1.6.2.2 |
| Cards are a calm-down tool, never a discipline system. A yellow card is a warning; a red card asks the player to sit out the rest of the game. A card never causes a suspension on its own, however many a player has. Suspensions are a manual admin decision kept for serious conduct: hurting someone, sexual misconduct, or repeated behavior that makes someone deeply uncomfortable | Owner of this project |
| Outside alcohol at the sponsor bar: 1-game suspension, then out for one full season, then a permanent ban. The app suggests these lengths; the admin decides | Rulebook 4.0 |
| Umpires report final scores to the commissioners; refs are paid about $20 a game | Owner of this project |
| The league talks in one WhatsApp group; each team has its own | Owner of this project |
| The old site advertised $85 per player | Current site |
| Teams usually pay one team fee and the captain collects by Venmo **(A: exact fee and model unknown)** | Owner of this project |

The rulebook I was given describes one rule set. The old site describes Fun and Competitive options. Divisions and rule sets are modeled as optional so either reality works **(A)**.

## 3. Personas

| Persona | Who they are | What they need most |
|---|---|---|
| **Newcomer Nia** (free agent) | New to Brooklyn, signs up alone or with one friend | A clear price, a team that fits, and to know where to be on game day |
| **Regular Ray** (player) | Third season on the same team | One tap to see game time and field, RSVP, pay his share, and get rain-out news |
| **Captain Cam** | Runs a 16-person roster and a team WhatsApp chat | To stop chasing Venmo payments, to know who is coming to the next game, and to find subs fast |
| **Ump Uma** (referee) | Players or friends who ref for $20 a game | Her assignments, a 20-second score entry, and a record of what she is owed |
| **Commissioner Chris** (admin/owner) | One of a few volunteers who run everything | A schedule nobody complains about, one-click rain-outs, and a view of who has paid |
| **Bar owner Bo** (sponsor) | Owns the home bar | Proof that the league brings people in after games |
| **Searcher Sam** (visitor) | Googles "Brooklyn kickball" | A fast page that answers what, where, when and how much, with a way to join |

"Free agent" is a state, not a separate account type: a registered player who has no team this season.

## 4. User stories by role

### Visitor
- See what the league is, where and when it plays, what it costs, and how to join, without signing in.
- Browse the schedule, standings, teams, rules, parks and events.
- Join a waitlist or interest list with an email or phone number when registration is closed.

### Player
- Create an account with Google or an email link, and stay signed in on my own devices.
- Register for a season, sign that season's waiver, and pay my share from my phone, with a promo code if I have one.
- See my next game (time, field, opponent, weather) on my home screen after sign-in.
- RSVP in or out for each game so my captain can plan.
- Add my team's games to my calendar and share results to WhatsApp.
- Choose which notifications I get and by which channel.
- Claim an open sub spot on another team when I am free.
- Check in at the home bar and use the day's deal.
- Vote for weekly and season awards.
- Pick the winners of each game day's games, for bragging rights only, and see where I rank.
- Ask the league to let me start a new team, with my current captain kept informed.
- Quietly say I'm open to a new team next season, without my current team ever knowing or being asked why, and choose who hears it: recruiting captains, admins, or both. My name goes to a team only when I say yes to its invite.

### Free agent
- Register alone or with a friend, take a short skill and vibe quiz, and get placed on a team.
- Say whether I would help captain a new team made of free agents.
- See my placement status and, once placed, everything a player sees.

### Captain
- Register a team and either pay in full or split the fee across players.
- Invite players by link, see who has joined, signed the waiver and paid, and send reminders.
- See RSVPs for the next game with a warning when I am short overall or short on one gender under the fielding rule.
- Post a sub request and approve who claims it.
- See the opposing captain's contact details and game-day information.
- Enter or confirm the final score when the ref has not.
- Message my team and copy any update into our WhatsApp chat.
- Give the league scheduling conflicts before the schedule is made.
- While next season is open for registration, see how many players are open to a new team and invite them, then hear from those who say yes.
- Hear my team's season-end leadership check-in result privately first, and choose whether to hand over now or keep the chosen teammate as co-captain until next season.

### Referee
- Set which game days and time slots I can work.
- Accept or decline assignments and see where I need to be.
- Enter the final score, or score inning by inning, including with poor signal at the field.
- Flag forfeits, ejections and incidents. Eject a player from the live game screen, which takes them out of the kicking order for the rest of the game.
- Give a player a yellow card (a warning) or a red card (asked to sit out the rest of the game) to calm a game down, with an optional short note, and take it back within a few minutes if it was a slip, from kickoff until two days after the game (an admin can record one for an older game).
- See what I have earned and what has been paid.

### League admin
- Set up a season: dates, price, early-bird window, roster limits, divisions, rule set and waiver.
- Enter fields, permit windows and blackout dates.
- Record the other groups that use each field: name, usual days and hours, and a contact only admins see. The game-day screen shows the next handover at each field with a countdown in the last 30 minutes. An admin can record a day two groups hold the same time; the fields screen warns ahead of it with the borough permit office's number, and an admin logs a problem on the day as an incident under the park rule "Sharing the space".
- Give each field a layout: a photo or PDF of where the permitted area ends and where each diamond and spectator area goes, with a short note such as "cones at the four corners", or confirm that the field needs none. A schedule can't be published while a field it uses has neither. The layout shows on the game-day command center, on a set-up shift for the crew on it, and on the permit page of the game's ref and captains, which is saved on the phone for offline use.
- Generate a schedule, read its fairness metrics, adjust it by hand with constraint checks, and publish it.
- See the weather risk for the next game day, call a rain-out with one click, and let the system notify everyone and place makeups.
- See registration, payment and waiver status for every team and player.
- Place free agents on teams with suggestions from the matcher, and approve new-team requests.
- Make promo codes for a season: a percentage or an amount off, with an optional limit on uses and a last day, and turn one off at any time.
- Correct scores, record forfeits, suspend players, and issue refunds (all or part of a payment) or league credit.
- Run events, manage sponsors, and send announcements.
- Ask whether there is enough interest in a new night, park or format before booking a permit: open a form, watch each option's totals against a target number of teams, and tell everyone who picked an option when it goes ahead. When an option has enough interest, open it as a new league with a draft season in one step (the operator, ADR 0087).
- See who changed what in an audit log.

### League owner
- Everything an admin can do, plus: manage admins, connect Stripe, set prices, decide refund and credit policy, export data, and approve pending features (referee marketplace).

### Sponsor
- See my sponsor page as players see it and update my deals.
- See a report of impressions, check-ins and deal redemptions by week.
- Print or display my check-in QR code.

## 5. Permissions matrix

Legend: ✓ allowed. **own** = only their own record, team or sponsor. **assigned** = only games they are assigned to. — not allowed. Captain rights apply to the team and season they captain; a co-captain has the same rights except removing the captain, handing the team over and changing co-captains.

| Action | Visitor | Player | Captain | Referee | Sponsor | Admin | Owner |
|---|---|---|---|---|---|---|---|
| View schedule, standings, teams, rules, events, sponsors | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Create account, edit own profile and notification settings | ✓ | own | own | own | own | own | own |
| Sign the season waiver, and accept the code of conduct with it | — | own | own | own | — | own | own |
| Register as a free agent or join a team by invite | — | ✓ | ✓ | ✓ | — | ✓ | ✓ |
| Register a team | — | ✓ (becomes captain) | ✓ | ✓ | — | ✓ | ✓ |
| Pay own share or fee | — | own | own | own | — | own | own |
| Invite, remove and promote roster members | — | — | own | — | — | ✓ | ✓ |
| See roster names | ✓ (first name, last initial) | ✓ | ✓ | ✓ | — | ✓ | ✓ |
| See roster phone and email | — | own team, if the member opted in | own team | captains of assigned games | — | ✓ | ✓ |
| See opposing captain's contact details | — | — | ✓ | assigned | — | ✓ | ✓ |
| See roster payment and waiver status | — | own | own team | — | — | ✓ | ✓ |
| RSVP for a game | — | own | own | — | — | — | — |
| See team RSVPs | — | own team | own team | — | — | ✓ | ✓ |
| Hand the team to a teammate, who must accept; make or unmake co-captains ([ADR 0042](adr/0042-captain-handoff-and-co-captains.md)) | — | — | own (captain only, not co-captains) | — | — | ✓ | ✓ |
| Accept or decline the captaincy offered to you; step down as a co-captain | — | own | own | — | — | own | own |
| Check in privately and vote secretly in the team's season-end leadership check-in ([ADR 0091](adr/0091-leadership-check-in-with-a-secret-ballot.md)) | — | own team | own team | — | — | own team | own team |
| Hear the ballot's result first and choose how to hand over | — | — | own (captain only, not co-captains) | — | — | — | — |
| Open, pause, resume and close leadership check-ins; set the league's quorum (never sees a choice) | — | — | — | — | — | ✓ | ✓ |
| Post a sub request | — | — | own | — | — | ✓ | ✓ |
| Claim a sub request | — | ✓ (registered, waiver signed, not suspended) | ✓ | ✓ if also a player | — | — | — |
| Approve or decline sub claims; take a request down | — | — | own | — | — | ✓ | ✓ |
| See a game's pickups (approved subs) | — | — | own team's games | assigned | — | ✓ | ✓ |
| See a game's emergency contacts and first-aid notes, on game day only | — | — | own team's games | assigned | — | — | — |
| Enter a score | — | — | own team's games | assigned | — | ✓ | ✓ |
| Check in at the field on game day | — | — | — | assigned, on the game's day | — | ✓ (for the ref) | ✓ (for the ref) |
| Check in as a player by scanning the game's code ([ADR 0063](adr/0063-field-check-in.md)) | — | ✓ (on either roster, or an approved sub, on game day) | ✓ | ✓ if also a player | — | ✓ if also a player | ✓ if also a player |
| Show a game's check-in code; tick players in or out, with their waiver status | — | — | own team's games | assigned | — | ✓ | ✓ |
| See a team's attendance and games played | — | — | own team | — | — | ✓ (every team) | ✓ (every team) |
| Enter runs inning by inning during a game | — | — | own team's games without a ref | assigned | — | ✓ | ✓ |
| Confirm or dispute a score | — | — | own team's games | — | — | ✓ | ✓ |
| Override a final score, record a forfeit | — | — | — | — | — | ✓ | ✓ |
| Submit scheduling conflicts | — | — | own | — | — | ✓ | ✓ |
| Create and edit seasons, divisions, fields, permits | — | — | — | — | — | ✓ | ✓ |
| Generate, edit and publish schedules | — | — | — | — | — | ✓ | ✓ |
| Record a cash or Venmo payment for a team member | — | — | own team | — | — | ✓ | ✓ |
| Save a card that guarantees the team's balance | — | — | own team | — | — | — | — |
| Download roster and payment CSV files | — | — | own team | — | — | ✓ (whole season) | ✓ (whole season) |
| Track shirt sizes and mark shirts received | — | — | — | — | — | ✓ | ✓ |
| Preview a rain-out with the weather card and send it to the owners to confirm | — | — | — | — | — | ✓ | ✓ |
| Confirm a rain-out ([ADR 0057](adr/0057-owner-confirmed-rainouts.md); the operator too) | — | — | — | — | — | when the owners allow it | ✓ |
| Let admins confirm rain-outs | — | — | — | — | — | — | ✓ |
| Set a game day's status: On, Watching with a decision time, Delayed or Off | — | — | — | — | — | ✓ | ✓ |
| Write a season's game-day checklist and the script for asking park users to move | — | — | — | — | — | ✓ | ✓ |
| Tick the game-day checklist for a game | — | — | own team | — | — | — | — |
| Note park users asked to move (only whoever claimed that day's "Set-up lead" shift) | — | set-up lead | set-up lead | set-up lead | — | — | — |
| Confirm a field's set-up | — | set-up lead | set-up lead | set-up lead | — | ✓ | ✓ |
| Confirm a field was left clean after its last game, with an optional photo (or the day's set-up lead) | — | — | own game | assigned | — | ✓ | ✓ |
| See past players who haven't signed up and email them to come back (while registration is open) | — | — | — | — | — | ✓ | ✓ |
| Place free agents; approve new-team requests | — | — | — | — | — | ✓ | ✓ |
| Request to start a new team | — | ✓ | ✓ | — | — | — | — |
| Send an announcement | — | — | own team | — | — | league-wide | league-wide |
| Create and edit events | — | — | — | — | — | ✓ | ✓ |
| RSVP or buy a ticket for an event | — | ✓ | ✓ | ✓ | — | ✓ | ✓ |
| Check in at a sponsor bar, redeem a deal | — | ✓ | ✓ | ✓ | — | ✓ | ✓ |
| Order merch or a replacement jersey for themselves | — | ✓ | ✓ | ✓ | — | ✓ | ✓ |
| Manage the merch catalog; see, export, fulfill and refund orders | — | — | — | — | — | ✓ | ✓ |
| Edit sponsor page and deals | — | — | — | — | own | ✓ | ✓ |
| View sponsor report | — | — | — | — | own | ✓ | ✓ |
| Set referee availability; accept or decline assignments | — | — | — | own | — | — | — |
| Approve referees, assign games, record payouts | — | — | — | — | — | ✓ | ✓ |
| View own referee earnings | — | — | — | own | — | — | — |
| Vote in awards | — | ✓ (rostered) | ✓ | — | — | — | — |
| Open, close and remove awards polls | — | — | — | — | — | ✓ | ✓ |
| Vote in a captains' poll for your team | — | — | ✓ | ✓ (when included) | — | — | — |
| Open, close, remind and remove captains' polls | — | — | — | — | — | ✓ | ✓ |
| Make pick'em picks (bragging rights only) | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Choose whether players may pick their own team's games | — | — | — | — | — | ✓ | ✓ |
| Pick up, hand on, confirm, return or report missing items from a kit of league gear they have, are handed or bring to a game | — | ✓ | ✓ | ✓ | — | ✓ | ✓ |
| Add and retire kits, assign them to games, correct where one is, sort missing-items reports | — | — | — | — | — | ✓ | ✓ |
| Log an incident | — | — | own team's games | assigned | — | ✓ | ✓ |
| Eject a player during a game (from the live game screen) | — | — | — | assigned | — | ✓ | ✓ |
| Give a yellow or red card to a player in a game | — | — | — | assigned | — | ✓ | ✓ |
| Give a card for a game that ended more than two days ago | — | — | — | — | — | ✓ | ✓ |
| Read cards in a player's conduct record, with a gentle pattern note after several cards across different games | — | — | — | — | — | ✓ | ✓ |
| See the cards they were given | own | own | own | own | own | — | — |
| Review incidents, suspend a player or lift a suspension | — | — | — | — | — | ✓ | ✓ |
| Read, export or delete an injury report (filing one is "Log an incident") | — | — | — | — | — | ✓ | ✓ |
| Keep a person off the team with a private "not on my team" list ([ADR 0036](adr/0036-not-on-my-team-list.md)) | — | — | own team | — | — | ✓ (any team) | ✓ (any team) |
| See every team's "not on my team" list and reasons | — | — | — | — | — | ✓ | ✓ |
| Quietly say they're open to a new team next season, answer team invites, withdraw it ([ADR 0089](adr/0089-looking-for-a-change.md)) | — | own | own | own | — | own | own |
| See how many players are open to a move and invite them; see names only of those who accept | — | — | own team, if recruiting for next season and never their own players | — | — | — | — |
| See who is looking for a change, with notes, when they let admins see it | — | — | — | — | — | ✓ | ✓ |
| Choose whether a person's own data export lists entries about them | — | — | — | — | — | — | ✓ |
| Rate the other team's sportsmanship after a final score | — | — | own team's games | — | — | — | — |
| See sportsmanship averages | — | — | own team, in blocks of 3 ratings | — | — | ✓ (every team, with notes) | ✓ (every team, with notes) |
| Issue a refund or league credit | — | — | — | — | — | ✓ | ✓ |
| Merge duplicate player accounts | — | — | — | — | — | ✓ | ✓ |
| Set prices, connect Stripe, change refund policy | — | — | — | — | — | — | ✓ |
| Add or remove admins | — | — | — | — | — | — | ✓ |
| Hand chosen admin powers to a player for set dates (acting admin), and end it early | — | — | — | — | — | — | ✓ |
| Keep the books: expenses and receipts, permit costs and documents, insurance, request sheet | — | — | — | — | — | — | ✓ |
| See the owner dashboard and download its numbers | — | — | — | — | — | — | ✓ |
| See a season report card, its CSV and its version for sponsors | — | — | — | — | — | — | ✓ |
| Publish or take down a season money summary | — | — | — | — | — | — | ✓ |
| Read a published season money summary | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| See a game's park permit at the field | — | — | own team's games | assigned | — | — | ✓ |
| Read the audit log | — | — | — | — | — | ✓ | ✓ |
| Export or delete personal data | — | own | own | own | own | — | ✓ |

Above every role in the matrix is the **platform operator**, who runs the software and its hosting rather than the league. The operator isn't a role anyone can be given in the app. They can set who the owners and admins are, make the whole site read-only or pause it, switch features off, and download all of the league's data. Owners see each of those actions in the audit log and can download the same data themselves. See [ADR 0009](adr/0009-platform-operator.md).

**Acting admin** ([ADR 0076](adr/0076-acting-admin-handover.md)). An owner can name a player acting admin for a date range with some of these powers: game day, scores, rain-outs, schedule, teams and rosters, announcements, discipline. For those dates the player has an admin's rights for the actions in the chosen powers and nothing else: never money (refunds, payments, exports), roles, merging accounts, the audit log, the books or private lists. It starts and ends on its dates, an owner can end it early, and deleting the account ends it. Each action is in the audit log under the acting admin's name, and the acting admin and every owner are notified when it starts and ends.

One person can hold several roles at once: a captain who also refs and is a league admin is common. Permissions are the union of global role (player, admin, owner) and scoped memberships (captain of a team, referee for a season, member of a sponsor).

## 6. Feature list

Tags: **MVP** (weeks 1–6, enough to run a season), **P2** (weeks 7–12, the "wow pack" built before the owner pitch and spring launch), **P3** (after launch), **Pending** (needs an owner decision before any build).

The goal is as many extras as possible in the first pass. A season cannot run without the MVP column, so that is built first; nearly every extra lands in P2, before the owners see it. See [roadmap.md](roadmap.md).

### Accounts and profile
| Feature | Tag |
|---|---|
| Sign-in with Google or an email link; no passwords; sessions last 90 days and renew on use | MVP |
| Passkeys (Face ID, Touch ID, device PIN) and a list of signed-in devices | P2 |
| Profile: name, phone, gender, shirt size, birth date (18+ check), emergency contact | MVP |
| Roles and scoped permissions as in the matrix | MVP |
| Account deletion and data export on request | P2 |

### Registration, waivers and payment
| Feature | Tag |
|---|---|
| Season setup: price per team or per player, early-bird window, roster limits, deadlines | MVP |
| Per-season e-signed liability waiver, versioned, required before roster activation | MVP |
| Team registration; captain pays in full | MVP |
| Split pay: each invited player pays a fixed share through their own link; captain sees who has paid | MVP |
| Free-agent registration with individual payment | MVP |
| Promo codes for a season: a percentage or an amount off, an optional limit on uses and a last day, entered when paying; the app applies them and Stripe charges the lower price ([ADR 0010](adr/0010-promo-codes-applied-in-app.md)) | MVP |
| Automatic payment reminders at 7, 3 and 1 days before the deadline | MVP |
| Admin refunds, full or partial: Stripe payments go back through Stripe and count once Stripe confirms; cash and Venmo handed back are marked refunded with a note; every refund is in the audit log | MVP |
| Waitlist for full seasons, with timed offers when a spot opens | P2 |
| Captain guarantee: saved card charged for any unpaid balance at the deadline | P2 |
| League credit ledger (rain-out rebates, referral credit, goodwill), usable at checkout | P2 |
| Season rebate tool: pro-rata credit or refund when too many games are lost | P2 |
| Referral credits | P2 |
| Shirt tracking: sizes by team, "received" flag, late-joiner order list | P2 |
| Shirts for late joiners: a league-wide waiting list by team and size, spare stock to hand out, and a batch reorder once enough have built up | P3 |
| A captain can choose "our own shirts or jerseys", which skips the league's shirt order and is noted on the roster | P3 |
| Shirt makers directory: local custom jersey and t-shirt makers, curated by admins, free to list, shown to captains who opt out | P3 |
| Shirt archive: each team's shirt by season on the league history page | P3 |
| Merch and replacement jersey orders | P3 |

### Scheduling
| Feature | Tag |
|---|---|
| Fields, permit windows, blackout dates, slot generation from a game format | MVP |
| Schedule generator with fairness metrics, seeded and repeatable | MVP |
| Draft and published schedule versions with a diff | MVP |
| Manual swap or move of a game, re-checked against every constraint | MVP |
| Byes for odd team counts; makeup slots held in reserve | MVP |
| Doubleheader days (summer format) | MVP |
| Team conflicts and time preferences as inputs | P2 |
| Drag-and-drop schedule board with a keyboard alternative | P2 |
| Playoff bracket seeded from standings and placed on fields | P2 |
| Playoff formats: single or double elimination, a third-place game, innings per round, and tiers of the standings | P2 |
| Divisions with crossover games | P3 |
| Multiple parks | P3 |

### Game day
| Feature | Tag |
|---|---|
| Public schedule, team pages and standings with tiebreakers | MVP |
| Final score entry by ref or captain; the other captain confirms, or it auto-confirms after 24 hours | MVP |
| A ref who plays for one of the game's teams reports for that team, so only the other team can confirm or dispute the score. Assigning such a ref, by email or with "Take it", warns first and needs an explicit override; the assigner never proposes one. A ref on both rosters, or neither, is neutral (either team answers), and an admin's report stays final at once. The assign and score screens say which rule applies | MVP |
| Forfeits, and games called after 4 innings | MVP |
| Daylight and field-time clock: each game's end of play is the earlier of the time its field must be clear and sunset at its park less a margin (fields with lights have no daylight end). The ref's and captains' screens count down to first pitch and to that end; the ref records first pitch with one tap and says who held up a late start; captains and the ref of a game with no time to spare get a reminder two hours before; admins see start times by team, and the scheduler warns about slots that run past daylight (#467) | P2 |
| Other sports: each league plays one sport with its own scoring rules; dodgeball is played in best-of-N sets (ADR 0087) | P2 |
| Missing-score reminders to the ref, then captains, then an admin list | MVP |
| Game-day RSVPs with a fielding-rule warning for captains | MVP |
| Inning-by-inning live scoring | P2 |
| Live playoff bracket | P2 |
| Sub finder: captains post, eligible players claim, captain approves | P2 |
| Fun with scores: power rankings, streaks, rivalry history, game of the week, records | P2 |
| Awards voting (weekly MVP, season awards) | P2 |
| Pick'em: predict each game day's winners, for bragging rights only | P3 |
| Offline score entry that syncs when signal returns | P3 |
| Lineup and kicking-order builder that enforces the two-in-a-row rule | P3 |
| Game clock on the live scorer: time left, and no new inning near the time limit | P3 |
| Sportsmanship ratings, incident reports and suspensions | P3 |
| Ref ejections from the live game screen; earlier ejections shown to admins on a report | P3 |
| Yellow and red cards for refs: a calm-down tool on the score screen that never suspends anyone; admins see them in the conduct record, players see their own, never public | P3 |

### Free agents and teams
| Feature | Tag |
|---|---|
| Free-agent pool visible to admins | MVP |
| Skill and vibe quiz; "sign up with a friend" groups | P2 |
| Matcher that suggests placements with reasons; admin confirms | P2 |
| Build a new team from free agents with volunteer captains | P2 |
| "Start a new team" request with league approval and captain notice | P2 |
| "Looking for a change": a player quietly open to a new team next season, never visible to their current team; recruiting captains see a count and invite, and a name is revealed only on the player's yes ([ADR 0089](adr/0089-looking-for-a-change.md)) | P2 |
| Season-end leadership check-in: each player privately volunteers, suggests a teammate or says things are good; a secret ballot only with the league's quorum and a teammate standing; over half the votes for a change; the captain hears first and hands over now or keeps the new captain-elect as co-captain until next season; admins can pause or close one; once per team per season ([ADR 0091](adr/0091-leadership-check-in-with-a-secret-ballot.md)) | P3 |

### Weather and rain-outs
| Feature | Tag |
|---|---|
| One-click rain-out: cancel a date or selected fields, notify by email, place makeups | MVP |
| Forecast on game pages and the admin dashboard | P2 |
| Automatic "likely rain-out" flag about 24 hours ahead | P2 |
| Squeeze day: re-cut a date into shorter games to fit makeups | P2 |

### Notifications
| Feature | Tag |
|---|---|
| Email for every transactional message; per-topic preferences | MVP |
| Admin and captain announcements | MVP |
| "Copy for WhatsApp" and share links on results, sub requests and rain-outs | P2 |
| Web push for installed app users | P2 |
| One-click unsubscribe for each topic in every email, as quick as replying STOP to a text | MVP |

### Community, events and content
| Feature | Tag |
|---|---|
| Searchable HTML rulebook, stored in the app: an owner pastes the text, reviews it split into numbered sections and rules, and saves it as a dated change. Players search it on a phone and a result jumps to the rule and highlights the words. Owners choose who can read it (owners only by default, members only, or public), and the text never goes in the repository ([ADR 0086](adr/0086-searchable-rulebook-stored-in-the-app.md)). PDF upload follows once a text-extraction library is approved | MVP |
| ICS calendar feed per team | MVP |
| Events calendar with RSVPs (bar nights, BBQ, tournament, theme weeks) | P2 |
| Share images for game results and teams | P2 |
| Past seasons: champions, final standings, records | P2 |
| Season recaps and news posts | P2 |
| Your season in kickball: a shareable end-of-season card for each rostered player. It has the games they made, their team's record and finish, awards and votes, best streak and game, playful league-wide marks (highest-scoring team, the league's biggest inning, never missed a game, wins by a single run, filling in as a sub) and a sportsmanship shout-out when other captains rated the team well. A player with no games gets a calm card with nothing claimed; a player who switched teams gets the card of the team they finished on; a sub with no roster spot gets no card. Private until the player makes its link public; a share image and "Copy for WhatsApp" either way. Computed once per season from one parallel read and stored | P2 |
| Instagram connection: an admin connects the league's Instagram once; new posts sync in, and admins pick which appear on the home page, team pages and event pages, or use one as a page's cover photo | P2 |
| Paid event tickets | P3 |
| Photo galleries uploaded by players and captains | P3 |
| Lost and found board: found items and lost notes for members, with private conversations between the two people and no contact details shown; posts close when handed over or after 30 days, and admins can take any down | P2 |
| "Friends of the league" directory (softball, soccer, pool, and other local leagues) | P3 |
| Corporate and private-event leagues | P3 |
| Charity tie-in (round-up at checkout, charity game) | P3 |

### Sponsors
| Feature | Tag |
|---|---|
| Sponsor logo slots and a sponsors page | MVP |
| Home-bar page with after-game deals | P2 |
| QR check-in at the bar and deal redemption | P2 |
| Team of the week with a bar tab | P2 |
| Sponsor portal and weekly report | P3 |
| Sponsorship tiers and pricing | Pending |

### Referees
| Feature | Tag |
|---|---|
| Referee role with score entry tied to assigned games | MVP |
| Admin assigns refs to games by hand | MVP |
| Availability, accept and decline, open-game board | Pending |
| Compensation tracking and incentives | Pending |
| Payouts through Stripe Connect | Pending |

### Admin and platform
| Feature | Tag |
|---|---|
| Admin dashboard: registrations, payments, waivers, missing scores | MVP |
| Audit log of every admin and captain change | MVP |
| Configurable league name, colors, logo slots, contact details, social links | MVP |
| Interest sign-ups: a public form for a new night, park or format, totals per option with an "enough to run" marker, and one email to everyone who picked an option when it goes ahead ([ADR 0075](adr/0075-interest-sign-ups.md)) | P2 |
| Demo deployment with seed data and one-tap role switching | MVP |
| Installable app (PWA) for captains, refs and admins | P2 |
| CSV export of rosters, payments and shirt sizes | P2 |
| Second league or sport on the same deployment (for example the affiliated football league) | P3 |

## 7. Decisions worth calling out

| Decision | Why |
|---|---|
| Support both per-team and per-player pricing with one model | The league uses a team fee today, the old site sold per player, and nobody has confirmed which they want |
| Split pay uses a fixed per-player share set when the team registers | A share that changes as people join means refunds and confusion; a fixed share is predictable |
| Money owed back goes to league credit by default, not card refunds | The league's history is "avoid refunds, make up the games"; credit is cheap to issue and keeps players for next season |
| A refund does not cancel a registration | A partial refund (a missed week, a shirt not needed) keeps the player on the team; an admin removes someone separately when they leave |
| A promo code never leaves a charge under 50 cents | Stripe will not take a smaller card payment; such a code charges 50 cents, and one that covers the whole price needs no payment at all |
| Subs must be registered players with a signed waiver, and sub requests are disabled for playoff games | This is what the rulebook already says |
| When time runs out, the game ends at the last full inning. Play must end at the earlier of the time the field must be clear and sunset less the rule set's margin (15 minutes unless the rule set says otherwise; none on a field with lights). The ref calls the game with a reason, daylight or field time, and the score stands as of the last complete inning, as for any called game (rulebook 3.1.5). The division's rule set says whether the game is called as soon as time is up or no new inning starts after it ([ADR 0083](adr/0083-daylight-and-field-time-clock.md)) | Late starts used to eat the light in spring and fall, and games cut short ended in arguments about the score. One rule, shown on both teams' screens before first pitch, settles it in advance |
| The site warns about fielding-rule problems but never blocks a game | Forfeits are a referee's call under the rulebook |
| WhatsApp is supported by sharing, not replaced | The league already lives there; fighting it would lose |
| One league per deployment, with a `league` record on every season | Cheap now, and it keeps the door open for the football league later |
| Free services only: no feature may need a paid plan, a paid API key or a monthly bill. A feature with no free option is left out ([ADR 0021](adr/0021-free-services-only.md)) | The league is run by volunteers and the site must cost nothing to run. This rules out AI features, text messages, WhatsApp business alerts, Sign in with Apple and app-store listings. Stripe has no monthly fee; its per-payment fees come out of the league's own payments. Each free limit, and what the site does near it, is in [architecture.md](architecture.md), section 15 |

### The game rules the app checks

These are the league's game rules as the app applies them. Each number is a setting, with the league's own value as the default; the ref still has the final say at the field, and the app warns rather than blocks.

| Rule | How the app applies it | Where it is set |
|---|---|---|
| Fielders | At most 11 on defense and at most 6 of one gender. A team can play short with 9 (5 and 4) or 7 (4 and 3); fewer than 7 fielders is a forfeit | Season fielding settings |
| Own players | A game counts only if at least 6 of the team's own players are there. Pickups don't count toward the 6, so below it the RSVP check calls the game a forfeit (the teams can still play a pickup game) | Season fielding settings |
| Pickups | A team short of fielders but with enough of its own players can pick up registered players with a signed waiver; the RSVP check says how many it needs. No pickups in playoff games. Pickups kick after the team's own players | Sub finder |
| Kicking order | Everyone coming kicks, latecomers join at the end, and no more than 2 of one gender kick in a row, counting from the last kicker back to the first. When one gender outnumbers the other by more than two to one, the builder stops flagging runs and tells the captain the team may keep a separate order for each | Lineup builder |
| Game length | 7 innings or 90 minutes, whichever comes first, unless the division's rule set says otherwise. No new inning starts in the last 10 minutes of the time limit (a rule-set setting); an inning under way is finished. The live scorer counts down from the scheduled start and says when the inning under way is the last, or when the game is over | Rule sets |
| Called games | A game stopped after at least 4 complete innings counts, with the score at the end of the last complete inning. Fewer is a rain-out | Score entry |
| Ties | Regular-season games can end tied; playoff games can't | Score entry |
| Home and away | Decided at the field; the scorer records who kicks first | Live scorer |

## 8. Out of scope

- Native mobile apps built separately from the web app (see the PWA decision in [architecture.md](architecture.md)), and store listings that wrap the same app, because both app stores charge developers a fee (section 7).
- Anything that needs a paid service (section 7): AI features such as Ask the rulebook or an AI helper, text messages, alerts by WhatsApp's business messaging, and Sign in with Apple.
- Posting into WhatsApp groups automatically. WhatsApp's business API messages individuals, not existing group chats, so sharing stays a tap by a person.
- Play-by-play or individual player statistics.
- A multi-tenant product for leagues we do not know.

## 9. Goals added 2026-11-12

New goals from the owner of this project. Each row says what it means for the product, its tag, and how it changes the plan above. Where a goal was already planned, the row says so and adds only what is new. The guiding rule for all of them: **useful features without overloading people**. Anything that sends a message is opt-in or easy to turn off, and nobody sees a feature their role does not need.

### Members and sign-up
| Goal | What we will build | Tag |
|---|---|---|
| Signing up is as easy as possible, on any device | Sign-up to paid in under two minutes on a phone: email link or Google, a profile only when registering, Apple Pay or Google Pay at checkout. Measured in the end-to-end tests on a phone viewport | MVP (a target for work already planned) |
| One account in the browser and in an app for Android and Apple | The installable app (PWA) shares the browser's sign-in and works on both platforms. Store listings are not planned, because both app stores charge developers a fee (section 7) | PWA moves from P2 to MVP |
| Opt out of texts and news | Every email has a one-click unsubscribe for its topic, as quick as replying STOP; news and promotions are off until a member turns them on (a new account starts with league announcements off; accounts that already existed keep what they had). The site sends no text messages (section 7). Game-critical notices (rain-outs, schedule changes) stay on by default but can be switched to push or to the site only | MVP |
| Alerts that fit each role, without too many | Default topics per role (owner, admin, ref, captain, player, sponsor). A daily cap per person, a digest for non-urgent news, and quiet hours. Each message says why the person got it and how to change it | MVP defaults; caps and digest P2 |
| More transparency, without oversharing | Team members see their own team's payment and waiver progress (already planned). New: an optional season summary of where the money goes, by category totals only, which the owners choose to publish. Never another person's amounts, birth date or contact details unless the privacy rules in data-model.md section 4 allow it | P2 |

### Payments
| Goal | What we will build | Tag |
|---|---|---|
| Flexible, easy payment: Apple Pay, cards, PayPal and others | Stripe Checkout with cards, Apple Pay, Google Pay and Link turned on, plus any wallet Stripe offers in the US (PayPal, Cash App Pay) where available. One payment provider keeps refunds, credit and webhooks in one place | MVP |
| The league fee splits automatically between signed-up players | Already planned as split pay with a fixed share. New: an "off-app payment" a captain or admin records for a member who pays cash or Venmo, with a note and who recorded it, so the team still reaches its total and nobody is chased twice | MVP |

### Events, content and community
| Goal | What we will build | Tag |
|---|---|---|
| An events page for prom, parties and more, with Partiful invites | Events with a date, place, description and an optional external invite link (Partiful or any URL; Partiful has no public API, so the link is shown and shared, not synced). The admin picks who sees and is told about it: all members, or chosen teams from the active season, any season or all seasons | P2 (extends the planned events calendar) |
| Tournaments with other kickball leagues in the city, and charity events (#470) | A tournament event can take guest teams. A guest captain signs up on the public event page with a team name, an email and a head count: no account. The captain shares a link and each guest player signs the league's newest waiver there by typing their name; the app keeps the name, the time and a hash of the text, nothing else about them. Captains' names and emails and the signatures are deleted a set number of days (1 to 90, default 30) after the event ends. An admin can set a cap on guest teams, close sign-ups, remove a team (until it is in the bracket), draw a single-elimination bracket from the guest teams (in sign-up order or at random; sign-ups close then), and enter scores, fields and times; results move teams on as in the playoffs. Optional charity mode shows the charity's name, an https donation link and a goal: the app never takes, holds or counts donated money. A partner-league card on the Friends page links an upcoming tournament to the league it is with. The public tournament page is static and shows team names only | P2 |
| WhatsApp | Already planned: share buttons and "Copy for WhatsApp" text. Alerts to individuals through WhatsApp's business messaging are not planned, because WhatsApp charges for them (section 7). Posting into existing group chats is not possible with WhatsApp's API, so that stays a tap by a person | P2 |
| Members upload photos and videos that could go on the league's socials | Uploads from players and teams with a checkbox that the league may repost them. An admin review queue approves, rejects, or downloads a file for Instagram. Size limits are set before launch so uploads stay inside the free storage (architecture.md, section 15) | P2 (moves up from P3 photo galleries) |
| Drink specials from the sponsor bars stay current | The bar updates its specials on its sponsor page. Before each game day it gets a one-tap "same as last week?" email, and the game-day page shows the current specials with the date they were confirmed | P2 (with the home-bar page) |

### Running the league
| Goal | What we will build | Tag |
|---|---|---|
| Owners track money in and money out | Income comes from Stripe automatically. Expenses are entered with a category and a photo of the receipt, taken on a phone. A ledger by season, with a CSV export for taxes | P2 |
| A dashboard for owners | Membership (new, returning, retention by season), revenue and expenses by season, payment completion, waiver completion, event turnout and sponsor check-ins | P2 (extends the MVP admin dashboard) |
| More league revenue, and a link to park permits | Revenue features already planned (early bird, sponsorship tiers, events, merch) are grouped on the dashboard with their results. New: permits are tracked with their cost, document and renewal date, with a reminder before renewals. NYC Parks has no public permit API, so permits are entered by hand | P2 |
| Better design: sleek, fun, easy, responsive, good colors | A redesign from a chosen direction and references, applied through the design tokens in design-system.md so every screen changes together | MVP (waiting on the design direction) |
| Use the league as a base for more | Already designed for: one league per deployment with a `league` record on every season, so a second sport or league can run on the same code | P3 |
