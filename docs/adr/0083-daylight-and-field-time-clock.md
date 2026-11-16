# ADR 0083: Daylight and field-time clock, worked out on read

- Status: accepted
- Date: 2026-11-15

## Context

Games start late, and in spring and fall a late start runs a game out of light, or into the time the league must hand the field back. The game is then cut short and the teams argue about the score. The permit-end watch (#406) already counted down to the end of the permit on the live-scoring screen, but it knew nothing about sunset, nothing about when the game actually started, and only the ref saw it.

The league can't pay for a weather or astronomy service ([ADR 0021](0021-free-services-only.md)), and its email provider allows 100 messages a day.

## Decision

**Sunset is computed on the server.** NOAA's solar position formulas (`src/domain/permits/sun.ts`, already used for the permit fee's lights estimate) give sunset within about three minutes for the park's coordinates, or City Hall when a park has none. The day is the game's local day in the league's time zone, so a 7 pm game, past midnight in UTC, gets its own evening's sunset. Daylight saving changes need no special case: the formula works in UTC and the clock time is formatted in the league's time zone.

**When play must end is worked out on each read, not stored.** It is the earlier of the time the field must be clear (the permit window's end, carried through touching windows, as in #406) and sunset less a margin. The margin is the division's rule set's `daylightMarginMinutes`, 15 minutes when unset. A field marked `has_lights` has no daylight end. Nothing is stored that could drift when a permit, a field or a rule set changes. The screens send the end time down with the page, and the countdown runs on the phone's own clock, so it keeps going with no signal.

**Only what happens at the field is stored.** `game_start` holds first pitch, tapped once by the ref (or a captain or admin, whoever may score the game live), and who held up a late start. A start more than five minutes after the slot's time, or a Delayed game day's new start (#383), is late. `score_report.call_reason` says whether a called game ran out of daylight or field time. The score of a called game stands at the last complete inning, as before, under the rule set's `permitEndRule`. The tapped first pitch does not restart anything: the time limit and the permit watch count from the slot's start, or a Delayed day's new start, as the live screen's time-limit clock does, so every minute late comes off the game.

**The nudge goes only where a late start costs innings.** Two hours before first pitch, the captains and ref of a game whose end of play falls no later than 15 minutes after its slot ends get one non-urgent `start_on_time` message. The evening job queues it with a `send_after`, and the outbox sweep through the day sends it. Messaging every game every week would use up the email allowance for messages that don't change anything.

**Fields default to no lights.** Existing fields are marked unlit by the migration. A league that plays after dark on unlit fields sees its games' clocks end at dusk, and the schedule screen lists every slot that runs past daylight, which prompts an admin to mark the lit fields. The demo seed's home park, which plays 8 to 10 pm, is lit.

## Alternatives considered

- **A sunrise and sunset API.** Free ones exist, but each adds a provider, a free-tier limit and a failure mode on game day for a number a formula gives offline.
- **Storing each game's end time.** Faster to read, but it goes stale when an admin moves a permit, marks a field lit or changes a rule set. The calculation is a few microseconds per game.
- **Treating unknown lighting as lit.** It would hide the problem the feature exists to show. Defaulting to dark is safe, because the scheduler's warning names every affected slot.
- **Recording the first pitch automatically from the first half-inning entered.** That time comes after the first half is over, and many games are scored only at the end. One tap at first pitch is exact and works for games nobody scores live.
- **A reminder for every game.** Simple, but on a busy game day it would spend much of the daily email allowance on games with time to spare.
