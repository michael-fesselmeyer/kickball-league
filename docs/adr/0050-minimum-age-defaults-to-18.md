# ADR 0050: The league's minimum age defaults to 18

- Status: accepted; replaces the default in [ADR 0041](0041-age-check-at-registration.md)
- Date: 2026-11-14

## Context

ADR 0041 set the league's minimum age to 21 by default, because the games end at a bar and the sponsors are bars. Drinking happens around the league, but it isn't part of being in it: playing kickball is. A 21+ default turned away adults the league wants, and its wording ("I'm 21 or older") on every way onto a roster made the bar sound like the point.

The profile already refuses anyone under 18, and the waiver needs adults, so 18 is the floor either way. Social events at bars can still say 21 and over on their own pages, as the FAQ already explains.

## Decision

**The default is 18, the profile's floor.** `DEFAULT_MINIMUM_AGE` and the `league.minimum_age` column default are 18. A migration moves a league still on the old default of 21 to 18; a season that set its own minimum keeps it.

**The setting stays.** A season can still set a higher minimum (18 to 99) in its settings, and a league can raise its own. Everything else in ADR 0041 holds: every way onto a roster and the waiver ask for the confirmation, which shows the season's minimum ("I'm 18 or older" by default), checked against the birth date on the profile, and only the confirmation is stored.

## Alternatives considered

- **Drop the confirmation box when the minimum is 18.** The profile check already refuses anyone under 18, but the stored confirmation is the record the waiver relies on (ADR 0041), and a person with no birth date on file still needs it. Kept.
- **Remove the setting.** A family season or another league may want a different age, and the setting costs nothing to keep.
- **Keep 21 and let each season lower it.** Leaves the bar as the default framing, and an admin would have to remember to change it every season.

## Consequences

- Players aged 18 to 20 can register, join as free agents, join by invite and sign the waiver unless a season sets a higher minimum.
- The migration rewrites a league's stored 21 to 18. A league that chose 21 on purpose sets it again in its settings.
- The migration's data update is written by hand after the generated `ALTER`: if the migration is generated again, the update has to be added back.
