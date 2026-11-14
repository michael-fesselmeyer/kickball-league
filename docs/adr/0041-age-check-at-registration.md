# ADR 0041: An age check at registration and on the waiver, stored as a confirmation

- Status: accepted
- Date: 2026-11-14

## Context

The league's players must be 21 or older: it is a social league whose games end at a bar, and its sponsors are bars. The rulebook's floor is 18 (product-spec.md, section 2), and the profile already refuses anyone under 18. Another league on the same software, or a family season, may want a different age, so the minimum can't be fixed in code.

The waiver only protects the league if the person signing meets its age rule, and the league needs to show that each player said so. At the same time, a birth date is personal data the league should hold as little of as it can (data-model.md, section 4).

## Decision

**The minimum age is a setting.** `league.minimum_age` is 21 by default (18 to 99, a check constraint). A season can set its own in its settings (`season.minimum_age`); empty uses the league's.

**Every way onto a roster asks.** Registering a team, joining as a free agent and joining a team by a captain's invite each show a required "I'm 21 or older" box with the season's minimum; so does signing the waiver. The server checks it again in the same transaction as the registration or signature, through one query (`confirmAge`) that reads the season's minimum, the league's time zone and the profile's birth date.

**The confirmation is checked against the birth date on file.** Registration already requires a complete profile, which includes a birth date, so the app knows it. A player the birth date shows as too young is refused even if they tick the box, and sees a friendly message ("Players in this league must be 21 or older…") instead of the form. The waiver does the same.

**Only the confirmation is stored.** A registration or signature keeps `age_confirmed_min` (the age the player confirmed) and `age_confirmed_at`, set together. No new birth date is collected or copied. The player's data export lists both.

## Alternatives considered

- **Compare the profile's birth date and store nothing.** Works today, but leaves no record that the player said they met the rule, which is what the waiver relies on, and breaks silently if the profile's birth date is ever made optional.
- **Ask for a birth date at registration.** Collects the same personal data twice.
- **A tick box with no check against the birth date.** A player the league already knows is 19 could tick it.
- **Raise the profile's 18+ check to 21.** Ties a league setting to the profile, and would refuse an 18-year-old's account even for a season that allows them.
- **Identity or age verification by a provider.** Paid, and far more than a social league needs. Out under the free-services rule (ADR 0021).

## Consequences

- Registrations and signatures from before this change have no confirmation. A player signs each season's waiver, so next season's records have one.
- A registration an admin makes for someone (approving a new-team request) has no confirmation of its own; the waiver that player signs before paying still asks.
- Age is self-reported, as it is everywhere a league can't check ID: a player can enter a false birth date or tick the box falsely. The stored confirmation is the league's record that they said they met the rule. A player whose birth date is wrong is told to fix it on their profile.
- Raising a season's minimum after people registered doesn't remove them; it applies to new registrations and signatures.
