# ADR 0063: A versioned code of conduct, accepted at the waiver step

- Status: accepted
- Date: 2026-11-15

## Context

Players agreed to a liability waiver but not to how the league expects them to behave on the field, at the park and online. Captains and refs had nothing to point to when they asked someone to stop. The league's own wording must be written in the app and stored in the database, never committed.

Registering a team, joining with a team link and joining as a free agent all create a registration that waits on the season waiver (`pending_waiver`) and send the player to the same waiver page before they can pay.

## Decision

**A versioned `conduct_code`, like a waiver.** An admin writes the text in the app; publishing makes the next version for the league, and versions are never edited. The editor starts from default sections (play, sharing the park, alcohol, glass and sound, leaving no trace, online) held in code as a starting point only; nothing is stored until an admin publishes. The text and its SHA-256 are stored the way a waiver's are, and the waiver helpers (normalizing, hashing, the small Markdown subset) are reused.

**Accepted at the waiver step, once per version.** The waiver page shows the current code with a tick box beside the waiver's own. All three ways of joining pass through that step, so one check covers them. `signWaiver` records a `conduct_acceptance` in the same transaction as the signature, and refuses to sign when the box is not ticked or the version shown has since been replaced. Someone who already accepted the current version is not asked again; a new version is asked at the next registration, not mid-season. A league with no code asks for nothing.

**Not a separate gate.** We did not add a second gate to registration or team joining: the waiver already blocks payment, and a second screen would add a step to each of the three paths. The trade-off is that a player is asked at the waiver step, not at the click that creates the registration.

**Shown in public.** The current text is on the league's public rules page, read inside the page's existing `use cache` and expired with the same tag when a version is published. The help center explains where to read it and when players accept it.

**Visible to admins.** Each season shows, per team, who accepted the current version. Acceptances are in the player's own data export, and account merges keep one acceptance per version.

## Consequences

- Players who registered before a code existed are asked at their next registration, and show as "not yet" meanwhile.
- A new version asks every returning player once more.
- Acceptances name the season whose registration asked for them and keep the hash of the text shown.
