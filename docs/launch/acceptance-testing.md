# Acceptance testing on the demo

A checklist for league volunteers to work through before launch, one section per role. Everything happens on the **demo site**, where every person, team and payment is made up and the whole league resets every night. Nothing you do there reaches a real player or moves real money.

## Before you start

**The maintainer sets up the demo:**

- [ ] The demo is reset (`npm run demo:reset`) on the morning of the session, and its address is shared with the volunteers.
- [ ] The demo has Stripe **test-mode** keys and a test webhook endpoint, so test payments show as paid.
- [ ] `OPERATOR_USER_IDS` on the demo names the Admin persona's account, so the owner checks below can be set up ([environment.md](environment.md)).

**Each volunteer:**

- Use your **phone** for the player, captain and ref sections; that's how players use the site. Use a laptop for the admin and owner sections, and try at least one admin screen on a phone too.
- The yellow banner at the top of every page says **Demo league** and has four buttons: **Player**, **Captain**, **Ref** and **Admin**. Tap one to become that person, with no password. Tap another to switch.
- To pay on the demo, use Stripe's public test card: number `4242 4242 4242 4242`, any future expiry date, any 3-digit code and any ZIP. No real card works there, and none should be tried.
- Tick each box when the result matches **Expect**. When it doesn't, write down the section and number, what you did, what you saw, and the phone and browser. A screenshot helps; it's all made-up data. Send it to the maintainer.

## Everyone: the public site (signed out)

Open the demo address in a private window, without tapping a banner button.

1. [ ] **Home page.** Expect: the league's name, the next game day, how to join, and links to the schedule, teams and FAQ. It loads in a couple of seconds on mobile data.
2. [ ] **Schedule.** Open the schedule and filter to one team. Expect: only that team's games, each with a date, time, field and, for played games, a score.
3. [ ] **A team.** Open any team. Expect: its record, next game, results and roster with first names and last initials only. No email addresses or phone numbers anywhere.
4. [ ] **Standings.** Expect: a table of teams ordered by record, with a table per division if the season has divisions.
5. [ ] **A game.** Open a finished game. Expect: the score, the field, and share buttons. "Share to WhatsApp" opens WhatsApp with a message and a link.
6. [ ] **Events.** Open Events and one public event. Expect: the date, the place, and a way to RSVP or a note that you need to sign in.
7. [ ] **Install.** On your phone's browser menu, choose "Add to Home Screen" (iPhone: Share → Add to Home Screen). Expect: an icon with the league's logo, and the site opens full screen from it.
8. [ ] **Dark mode.** Switch your phone to dark mode. Expect: the site follows, and all text stays readable.

## Player

Tap **Player** in the banner.

1. [ ] **Home.** Expect: your next game with time and field, your team, and anything you still need to do (waiver, payment).
2. [ ] **RSVP.** On your next game, answer **In**, then change it to **Maybe**. Expect: the answer saves straight away and stays after a reload.
3. [ ] **Profile.** Change your shirt size and save. Expect: a "saved" message, and the new size after a reload.
4. [ ] **Age check.** In your profile, set a birth date that makes you 17 and save. Expect: it's refused with a plain message. Put it back.
5. [ ] **Emergency contact.** Add an emergency contact. Expect: a note that explains who can see it and when (your game's captains and ref, on game day only), then it saves.
6. [ ] **Away weeks.** Tick a week you'll miss. Expect: it saves, and the captain's view (Captain section, item 3) shows you as away that week.
7. [ ] **Push.** On the installed app, turn on push for scores. Expect: the phone asks permission, and the setting shows as on. (iPhone: only from the home-screen app.)
8. [ ] **Join as a free agent.** If a season is open for registration, register as a free agent: take the short quiz, sign the waiver, and pay with the test card. Expect: you can't reach payment without signing; Stripe's page opens; after paying you come back to "confirming your payment", and within seconds it shows **Paid**.
9. [ ] **League credit.** Open your account page. Expect: a credit balance and its history (it can be $0).
10. [ ] **Download my data.** In your profile, download your data. Expect: a file downloads with your own details only.
11. [ ] **Offline.** With the app installed, open your next game, then turn on airplane mode and open the app again. Expect: the game still shows, marked as a saved copy, and other pages show a friendly offline page.

## Captain

Tap **Captain** in the banner.

1. [ ] **Team page.** Expect: the roster board shows who has joined, signed the waiver and paid, and what the team still owes.
2. [ ] **Invite.** Copy the team's invite link. Open it in a private window. Expect: a page to join this team (it asks the visitor to sign in first).
3. [ ] **Availability.** Open the next game. Expect: who's in, out and maybe, who's away that week, and a warning if the team can't field enough women or men under the league's rule.
4. [ ] **Kicking order.** Build the kicking order by dragging names (or with the up and down buttons). Put three players of the same gender in a row. Expect: a warning that says which rule is broken and where. Fix it and save.
5. [ ] **Ask for a sub.** From a game where the team is short, ask for a sub. Expect: a confirmation, and the request shows on the subs page with its spots.
6. [ ] **Report a score.** On a finished game with no score, enter one. Expect: it shows as reported, waiting for the other captain to confirm.
7. [ ] **Rate sportsmanship.** After a final score, rate the other team from 1 to 5. Expect: it saves, and you can't see who else gave which rating.
8. [ ] **Co-captain.** Make a teammate a co-captain. Expect: they're marked as co-captain on the roster.
9. [ ] **Download the roster.** Download the team's roster. Expect: a CSV with your team only, including shirt sizes.

## Ref

Tap **Ref** in the banner.

1. [ ] **My games.** Expect: your assigned games, with time, field and teams. On game day: the park permit number.
2. [ ] **Live scoring.** Open a game being played and tap in the runs after a half-inning. Open the same public game page on a second phone or laptop. Expect: the line score there updates within about 15 seconds without reloading.
3. [ ] **Final score.** Enter a final score. Expect: the captains are asked to confirm, and the game shows the score as reported.
4. [ ] **Offline score.** Turn on airplane mode on the score screen and enter a score. Expect: "Saved on this phone, will send when you're back online". Turn airplane mode off. Expect: it sends, and the message goes away.
5. [ ] **Emergency contacts.** If you ref a game today on the demo, open the players' emergency contacts. Expect: you see them for today's game only. On a game on another day you don't.

## Admin

Tap **Admin** in the banner. Use a laptop, then repeat item 1 on a phone.

1. [ ] **Game day dashboard.** Open Today. Expect: the next game day's games, refs, RSVP warnings, missing scores, and registrations and payments by team.
2. [ ] **Season setup.** Open the current season. Expect: its dates, prices, deadlines, fields and permit windows can all be viewed and changed.
3. [ ] **Schedule.** Open the schedule screen and generate a draft for the season that is ready to schedule. Expect: a draft with every game placed (or a reason for each one that couldn't be), and fairness numbers. Move one game. Publish. Expect: the public schedule shows the new version.
4. [ ] **Rain-out.** Start a rain-out for a game day. Expect: a preview of the affected games and their proposed makeups before anything is sent. Confirm it. Expect: those games show as moved on the public schedule.
5. [ ] **Score correction.** Change a disputed or wrong score. Expect: it is final at once, and the standings update.
6. [ ] **Free agents.** Open the free-agent pool. Expect: a suggested team for each free agent with a plain reason. Place one. Expect: they show on that team's roster.
7. [ ] **Registrations and refund.** Open registrations, pick a paid test registration and refund part of it. Expect: you're asked to sign in again if your sign-in is old; the payment shows as partly refunded once Stripe confirms.
8. [ ] **Announcement.** Send a league announcement. Expect: it's queued to every player (the demo sends no real email), and the copy-for-WhatsApp button copies the text.
9. [ ] **Events.** Create an event with a capacity of 2, then RSVP as Player and as Captain, and a third person. Expect: the third goes on a waitlist with their place shown.
10. [ ] **Audit log.** Open the audit log. Expect: what you just did, newest first, in plain words.
11. [ ] **Photos.** Open the member photo queue. Expect: you can approve or reject a photo, and rejecting asks for a note.

## Owner

The demo has no Owner button, so the operator makes the Admin persona an owner first:

- Tap **Admin**, open `/operator`, and under "Change a person's role" enter `addie.admin@example.test`, choose **Owner** and save. Expect: "Role saved." (Only the account named in `OPERATOR_USER_IDS` can open `/operator`; for everyone else it's a not-found page.) The nightly reset puts the role back.

Then, still as Admin (now an owner):

1. [ ] **The books.** Open the books for the current season. Expect: money in from payments, money out by category, and the net. Add an expense with a photo of a receipt from your phone. Expect: it shows in money out, and the total changes.
2. [ ] **Owner dashboard.** Expect: members by season (new and returning), money in and out by season, and each team's roster, waiver and payment completion.
3. [ ] **Command center.** On a phone, open the game-day command center. Expect: every game of the day, its field, its ref and whether they checked in, where each score stands, and the weather.
4. [ ] **Permits.** Open park permits. Expect: each permit's cost, dates and document, and the insurance certificate's expiry.
5. [ ] **Money summary.** Preview the public money summary. Expect: category totals only, never a person's name or payment. Don't publish it unless the owners want to.
6. [ ] **League export.** Download the league's data. Expect: a JSON file downloads, and the audit log records the download.
7. [ ] **Nobody else sees the money.** Copy the books' address, switch to **Captain**, and open it. Expect: a not-found page, and no link to the books anywhere in the Captain's menus.

## Sign-off

| Role | Tested by (first name only) | Date | Phone and browser | All ticked? | Problems sent |
|---|---|---|---|---|---|
| Public site | | | | | |
| Player | | | | | |
| Captain | | | | | |
| Ref | | | | | |
| Admin | | | | | |
| Owner | | | | | |

Launch waits until every row is ticked, or each problem has an issue the maintainer has agreed can wait until after launch.
