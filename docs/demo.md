# Show the league the app

A 10-minute walkthrough of the app for the league's owners, run from one laptop. Everything runs on this computer: no accounts, no keys, nothing to pay for, and nothing leaves the laptop. Every person, team and payment in it is made up.

## Start it

```bash
npm run demo
```

The first run needs the internet once, to install the packages, download Postgres and stripe-mock into Docker and fetch the fonts. It takes about five minutes. After that it starts in seconds on the same day and works offline. The command:

1. Finds Postgres: Docker if it is running (the demo keeps its own container, `kb-demo-postgres`), or a local Homebrew Postgres. With neither, it says how to install one.
2. Creates the `kb_demo` database, migrates it and fills it with the demo league (`npm run demo:reset`). The season is current: tonight's first games are being played right now, the ref is at the field, and the next game day has a rain watch.
3. Builds the app, or reuses today's build when nothing changed.
4. Starts [stripe-mock](https://github.com/stripe/stripe-mock) when it can (the `stripe-mock` binary, or Docker), so paying goes through a demo checkout page. Without it, the payment screen says it is a demo payment.
5. Starts the app in demo mode on a free port, prints the address and opens the browser.

`npm run demo -- --fresh` starts over with new data and a new build; `--no-open` leaves the browser closed. Press Ctrl+C to stop. It never reads `.env.local`: the demo's throwaway secrets are made on the first run and kept in `.demo/`, which git ignores.

Mid-demo, **Reset demo** in the yellow banner (as Admin) puts everything back the way it started and signs everyone out. From a terminal, `npm run demo:reset` does the same.

## Before the meeting

- Run `npm run demo` once that morning, so the first start and its downloads are out of the way.
- Use a browser window at laptop size; everything also works on a phone-sized window, which is how players see it.
- Keep a second tab on **Demo mail** (Admin) to show the messages as they go out.

## The walkthrough

The yellow banner at the top switches who you are: **Player**, **Captain**, **Ref** or **Admin**, in one tap. In the demo, Admin also has the owners' screens (the books and the owner dashboard), which on the league's site belong to the owners alone.

### 1. The public site (1 minute)

Open the home page, then **Schedule** and **Standings** for Fall 2026.

_Why it matters:_ players and new people find the schedule, standings and how to join without logging in or asking in the group chat.

### 2. A player's game night (1 minute): Player

The home screen shows tonight's game, the RSVP buttons and anything owed. Tap **Going**.

_Why it matters:_ captains know who is coming before game day, without chasing anyone by text.

### 3. Signing up and paying (1 minute): Player

Open **Spring 2027**, register, and pay on the demo checkout page. Then open **Demo mail** as Admin: the receipt is there.

_Why it matters:_ nobody collects cash or Venmo; the app knows who has paid and sends the receipt.

### 4. Live scoring from the field (1 minute): Ref

The ref's home lists tonight's games; the first ones are already in the fourth inning. Open one and enter the runs for the next half-inning.

_Why it matters:_ scores and standings are right the moment a game ends, with no texts or spreadsheets.

### 5. The game-day command center (1 minute): Admin

Open **Game day** (`/app/admin/today`): every game tonight, its field, its ref and whether they checked in, the live score with the inning, and the weather. It refreshes by itself.

_Why it matters:_ one screen answers "is everything on track tonight?" from a phone at the park.

### 6. Rain-outs (1 minute): Admin

The next game day shows a **rain watch**, and the admins' rain alert is already in **Demo mail**. Open the season's **Rain-out** screen, call off that day, and look at the proposed makeups. Back in **Demo mail**, every player has the notice.

_Why it matters:_ a rain-out is one decision, not an evening of messages; makeups are found, and everyone hears at once.

### 7. The scheduler and the board (1 minute): Admin

Open **Spring 2027 → Schedule**, generate a schedule, look at its fairness numbers, then move a game on the board.

_Why it matters:_ a season's schedule takes minutes instead of a weekend, and it is fair: early and late games, fields and opponents are spread evenly.

### 8. The free-agent matcher (1 minute): Admin

Open **Spring 2027 → Free agents**: suggested placements with the reasons, friend groups kept together. Apply one.

_Why it matters:_ solo players get placed fast and well, so they sign up again.

### 9. The books, permits and capacity (1 minute): Admin

Open **Books**: money in and out by category for the season, and the receipts. Then **Permits → Capacity**: how many teams the permitted field time fits, how short it is of the teams that want in, and what to request from NYC Parks.

_Why it matters:_ taxes and permit requests stop being a scramble, and the league knows how far it can grow before it asks for more field time.

### 10. The owner dashboard (1 minute): Admin

Open **Owner**: membership (new, returning, retention), money in and out, completed games and turnout, season by season.

_Why it matters:_ the owners see how the league is doing at a glance, with the numbers to decide what to change.

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
