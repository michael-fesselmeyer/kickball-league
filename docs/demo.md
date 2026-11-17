# Show the league the app

A 15-minute walkthrough of the app for the league's owners, run from one laptop. Everything runs on this computer: no accounts, no keys, nothing to pay for, and nothing leaves the laptop. Every person, team and payment in it is made up.

## Start it

```bash
npm run demo
```

The first run needs the internet once, to install the packages, download Postgres and stripe-mock into Docker and fetch the fonts. It takes about five minutes. After that it starts in seconds on the same day and works offline. The command:

1. Finds Postgres: Docker if it is running (the demo keeps its own container, `kb-demo-postgres`), or a local Homebrew Postgres. With neither, it says how to install one.
2. Creates the `kb_demo` database, migrates it and fills it with the demo league (`npm run demo:reset`). The season is current: tonight's first games are being played right now, the ref is at the field, and the next game day has a rain watch. The reset also adds demo-only data for the newer features (`src/seed/demo-showcase.ts`): an open captains' poll, a drafted playoff bracket, a soccer club that shares a field, an acting admin, ref cards, a leadership check-in, players open to a new team, late-joiner shirts and more interest sign-ups. It takes a few seconds.
3. Builds the app with `DEMO_MODE=true`, or reuses today's build when nothing changed. The banner's role picker and admin tools are compiled in only when a build has `DEMO_MODE=true` (`next.config.ts`), so the league's own site ships none of their code; a demo deployment needs the variable at build time as well as at run time.
4. Starts [stripe-mock](https://github.com/stripe/stripe-mock) when it can (the `stripe-mock` binary, or Docker), so paying goes through a demo checkout page. Without it, the payment screen says it is a demo payment.
5. Starts the app in demo mode on a free port, prints the address and opens the browser.

`npm run demo -- --fresh` starts over with new data and a new build; `--no-open` leaves the browser closed. Press Ctrl+C to stop. It never reads `.env.local` or any other `.env*` file: every process the demo starts has them hidden (`scripts/demo-hide-env.mjs`), because Next.js reloads env files during a build even when told not to. The demo's throwaway secrets are made on the first run and kept in `.demo/`, which git ignores.

Mid-demo, **Reset demo** in the yellow banner (as Admin) puts everything back the way it started and signs everyone out. From a terminal, `npm run demo:reset` does the same.

## Show a league's own name, logo and teams

The demo can wear the visiting league's own name, logo and team names. They stay on the laptop, never in the repository: put them in `private/brand/`, which git ignores, as a file named `demo-branding.json` with the logo beside it.

```json
{
  "leagueName": "The league's full name",
  "shortName": "A short form for phones (optional)",
  "logo": "logo-file-in-this-folder.png",
  "teams": ["First team", "Second team", "…"]
}
```

- `leagueName` (required, up to 80 characters) replaces the generic name in the header, page titles, share images, the installed app's name and the league's row in the database.
- `shortName` (optional, up to 24 characters) is shown in the header on a phone, where the full name would push the buttons onto a second line, and under the home-screen icon.
- `logo` (optional) is a `.png`, `.webp` or `.jpg` file name in `private/brand/`. A square-ish logo on a transparent background looks best. At build time the demo resizes it with sharp into `public/brand/` (also ignored by git): a 120-pixel-tall copy for the header and a larger one for share images and home-screen icons. Without a logo the kickball mark stays.
- `teams` (optional, up to 64 names) renames the seeded teams in order: Fall 2026's eight teams first (the first name goes to the team Pat Player and Casey Captain play on in the walkthrough below), then the two teams from past seasons. Extra names go unused; with fewer, the rest keep their invented names. Slugs, colors and every seeded game stay as they are.

The next `npm run demo` notices the file (or a change to it) and rebuilds. If the file can't be used (bad JSON, a missing logo, a blank name), the demo says what is wrong and runs with the generic league instead. Without the file, the demo is exactly as described here.

Outside the demo, the same name and logo come from the `SITE_NAME`, `SITE_SHORT_NAME`, `SITE_LOGO` (a path under `public/`) and `SITE_LOGO_SIZE` (`<width>x<height>`) variables (`src/lib/site.ts`); `demo:reset` also reads `DEMO_TEAM_NAMES`, a JSON list.

## Before the meeting

- Run `npm run demo` once that morning, so the first start and its downloads are out of the way.
- Use a browser window at laptop size; everything also works on a phone-sized window, which is how players see it.
- Keep a second tab on **Demo mail** (Admin) to show the messages as they go out.

## The walkthrough

About 15 minutes, grouped by who you're viewing as. The yellow banner at the top switches who you are: pick **Player**, **Captain**, **Ref** or **Admin** in its **Viewing as** picker and tap **Go**. It shows who you're viewing as, and takes one short row on a phone.

Inside the app, the tab bar at the bottom (Home, Schedule, Team, Menu; Ref has **Reffing** and Admin has **Admin** in place of Team) and the **Menu** groups change with the role: Captain adds a Captain group, Ref adds Referee, and Admin has League admin and Owner instead of the player's groups. In the demo, Admin also has the owners' screens (the books, the owner dashboard and processing fees) and the operator's page, which on the league's site belong to the owners and the operator alone. The whole app wears the league's retro rec look; the round button in the header switches between light and dark.

### Anyone: the public site (2 minutes)

**1. Schedule, standings and languages.** Open the home page, then **Schedule** and **Standings** for Fall 2026. On a phone-sized window, the header's menu button opens the same links as a sheet. At the bottom of any page, tap **Español** (or any of the ten languages): the public pages, and every email and push a player gets, come in their language.

_Why it matters:_ players and new people find the schedule, standings and how to join without logging in or asking in the group chat, in the language they read best.

**2. The rulebook.** In the footer, open **Rules** and search for _pitch_: every matching rule, with its number, as you type. The demo uses an invented sample rulebook; the league's own rules are typed in by the owners.

_Why it matters:_ an argument at the field ends with a search on a phone, not "I think the rule is...".

### Admin: growing the league (3 minutes)

**3. Is there interest in a new night?** As **Admin**, on the admin home open **All admin tools → Interest sign-ups**. "Where should we grow?" has 40 answers: Thursday nights at Sample Park is marked **Enough to run** (11 of the 8 teams it needs, counting friends), Sunday nights isn't there yet. The public form is at `/interest`; nobody needs an account to answer. **Open Thursday nights ... as a new league** turns the option into a new league with a draft first season, for the owners and admins to finish. (**Reset demo** removes a league opened this way.)

_Why it matters:_ the league books a permit for a new night only after people have said they'd play, and starting it takes one tap.

**4. A second sport.** Open `/l/dodgeball`: Thursday Dodgeball, a second league on the same site with its own courts, admin and teams. Its standings count sets, not runs, with power rankings and a game of the week. The operator's page (`/operator`) lists every league (kickball, dodgeball and flag football) and where its pages live; the demo player also plays flag football and switches leagues from the menu.

_Why it matters:_ one site, one account and the same tools can run more leagues and more sports without starting over.

**5. A partner tournament for charity.** Open **Events** in the site header, then **Harbor Cup charity tournament**: a one-day tournament with another city league, playing for a food pantry with a donation goal (donations go to the charity's own page, never through the league). Four guest teams have signed up; their players sign the waiver from their captain's link, without accounts.

_Why it matters:_ tournaments with other leagues bring in new players and goodwill, and the league never handles the money.

### Player: a game night (2 minutes)

**6. Tonight and next week.** As **Player**, Home shows tonight's game (live now) and the next one. Answer **In**, **Maybe** or **Out** for next week.

_Why it matters:_ captains know who is coming before game day, without chasing anyone by text.

**7. Alerts their way.** Open **Menu → Your profile** and scroll to **Fewer messages, not none**: only my team's news, league news as a weekly roundup, or snooze for two weeks. Rain-outs, game changes and payment deadlines still come right away. Just above, **Language** picks the language emails come in.

_Why it matters:_ players who feel spammed turn things down instead of unsubscribing, so the messages that matter still reach them.

### Captain: running a team (3 minutes)

**8. The captains' poll.** As **Captain**, Home shows **Captains' poll waiting for your vote**. Open it ("Where should the end-of-season party be?"), vote, and the totals appear: five of the eight teams are already in.

_Why it matters:_ a league decision gets one vote per team in a day, instead of a long group chat.

**9. Recruiting quietly.** Open the team's **Spring 2027** page (Home → Spring 2027, then **Roster and payments**): "2 players open to a new team haven't had an invite". The captain invites them with a short pitch and never sees who they are until one says yes; their current teams never know.

_Why it matters:_ players who aren't happy on a team move instead of quitting, and nobody's feelings get hurt in public.

**10. Acting admin.** The admins are away, so the owners made Casey acting admin for two weeks, with game day, scores and rain-outs (the notice is in **Demo mail**). Open the rain-out screen at `/app/admin/seasons/fall-2026/rainout` and preview calling off next Tuesday: Casey can do it while the admins are away. Everything else stays closed (the admin home says the page isn't there), and Casey can't keep score of their own team's game.

_Why it matters:_ the league runs on a vacation week without handing anyone the keys to the money or the members.

**11. Shirts.** Open the Fall 2026 team page's **Team settings → Team shirts**: the team is on the league's order. Choosing **Our own shirts or jerseys** lists local shirt makers the league trusts.

_Why it matters:_ teams that want their own look find a maker in one place, and late joiners still get a league shirt (step 16).

### Ref: at the field (2 minutes)

**12. Live scoring and the field clock.** As **Ref**, open one of tonight's games from Home. It shows when play must end so the field is clear by the end of the permit (or sunset on an unlit field), how many minutes are left, and the game clock: no new inning starts in the last 10 minutes. Enter the runs for the next half-inning.

_Why it matters:_ games start on time and end before the permit or the light runs out, so the league keeps its permits.

**13. A calm-down card.** On the game's **Enter score** page, **Cards**: give a yellow card to a player, with a note. Only admins see cards, and a card never suspends anyone.

_Why it matters:_ the ref has a calm, visible way to cool a game down before it becomes an incident.

**14. Leadership check-in.** Reese played on a team in Summer 2026, whose season-end check-in is open. Open **Summer 2026**'s team page from Home: put yourself forward or suggest a teammate, privately.

_Why it matters:_ captains who are tired get a graceful handover, and nobody has to say it out loud.

### Admin: the league office (3 minutes)

**15. Game day and the seasons.** As **Admin**, the admin home starts with the current season's card and its main tools, then tonight's games with RSVPs and refs. **Menu → Seasons** shows every season as a card with its status, current first; **Manage** opens a season's tools, grouped. Open **Game day screen**: every game tonight, its ref, the live score and the weather. Then **All admin tools → Incidents → Cards**: the cards refs gave, including the one from step 13.

_Why it matters:_ one screen answers "is everything on track tonight?" from a phone at the park.

**16. Playoffs.** Open Fall 2026's **Manage → Playoffs**: two draft brackets from today's standings. The top four play double elimination, with a grand final and an if-necessary game; the next four play single elimination with a third-place game. Tap **Publish the brackets**, then open the public **Bracket** page.

_Why it matters:_ every team gets meaningful playoff games, and the bracket, its fields and its times are done in a minute.

**17. Sharing the fields.** Open Fall 2026's **Fields and permits**: a soccer club that uses Field 1 just before the league has it later than usual next Tuesday, so the first game there starts late. The game-day crews see it in their handover. Then **Start times**: each team's starts, how many were late through their own doing and the minutes it cost, from the refs' first-pitch taps in step 12.

_Why it matters:_ a clash with another group is known a week ahead, not discovered at the field.

**18. Leadership and processing fees.** Open Summer 2026's **Manage → Leadership check-ins**: each team's check-in, how many took part and how many a vote needs, without anyone's answers. Then **Owner dashboard → Processing fees**: it's off, so the league pays card fees as it does today. Turned on, card payers cover the card fee and cash, Zelle and check stay at the lower price.

_Why it matters:_ the owners see the health of each team's leadership, and can stop losing about 3% of every card payment when they decide to.

### More to show, if there is time

- **Signing up and paying** (Ref): Reese doesn't play this fall, so they show a newcomer's sign-up. Open **Spring 2027: register**, join as a free agent at the early-bird price, sign the waiver, and pay on the demo checkout page. **Demo mail** (Admin) has the receipt. Nobody collects cash or Venmo.
- **Rain-outs** (Admin): the next game day has a **rain watch**, and the rain alert is in **Demo mail**. Open the admin home's **Rain-out**, call off that day and look at the proposed makeups. A rain-out is one decision, and everyone hears at once; a few players get it in Spanish, Chinese or Russian.
- **The scheduler and free agents** (Admin): **Spring 2027 → Schedule**, generate a schedule and look at its fairness numbers; **Spring 2027 → Free agents**, the suggested placements with their reasons.
- **The books, permits and the owner dashboard** (Admin): **Books** by category with receipts; **Permits → Capacity**, how many teams the field time fits; **Owner**, membership, money and turnout season by season.
- **Game-day check-in** (Captain, then Admin): open a game from round 1: the **before play** checklist is ticked for both teams. Its attendance lists who played; two players haven't signed this season's waiver and are flagged.
- **Late-joiner shirts** (Admin): **All admin tools → Late-joiner shirts**: three players joined after the shirt order. Hand one a spare from stock; the rest wait until a reorder is worth it.
- **Season cards and concerns**: **Summer 2026**'s season card for the player's team (Player); **Concerns**, two waiting, one with an admin-only note (Admin).

## What is real and what is pretend

Everything on screen is the real app, running the same code as the league's site. Only these differ:

- **Payments** go to stripe-mock and the demo's own checkout page, which confirms them with a signed test message, as Stripe does. No card is involved.
- **Email** stays on the laptop: **Demo mail** (Admin) shows what each person would get.
- **Weather** is a recorded pattern (dry tonight, showers on the next game day), and **Instagram** photos are recorded too.
- **The dates** follow today: the season is always half played when the demo starts.

## If something goes wrong

- **"The demo needs Postgres"**: start Docker Desktop, or install Postgres with Homebrew, as the message says, and run it again.
- **A page looks out of date**: Admin → **Reset demo**, or `npm run demo -- --fresh`.
- **Starting over from scratch**: stop the demo, then `docker rm -f kb-demo-postgres` and delete the `.demo` folder; the next `npm run demo` makes everything new.
