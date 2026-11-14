# ADR 0041: Seal emergency contacts and show them only on game day, to the game's captains and ref

- Status: accepted
- Date: 2026-11-14

## Context

Players gave an emergency contact (name and phone) on their profile before registering. It sat in plain columns on `profile`, and nobody but the player could read it. That helped nobody at the field: when a player is hurt at a game, the people there are the two captains and the ref, and they had no way to reach anyone.

An emergency contact, and above all a note about allergies or conditions, is sensitive. Showing it widely, or keeping it readable in a database copy or on a phone after the game, would cost more trust than it buys.

## Decision

**One sealed record per player.** The profile's emergency contact moves to `emergency_contact`: the player's id and one sealed value holding the name, an optional relationship, the phone and an optional first-aid note of up to 300 characters. It is sealed with AES-256-GCM under a key derived (HKDF) from the server's auth secret and the purpose `emergency-contact`, and bound to the player's id, so a database copy alone reads nothing and a value copied onto another player does not open. The sealing in `src/lib/crypto/sealed.ts` is the Instagram token's (ADR 0023), now shared with a purpose argument; the token derives exactly the key it did before, which a fixed test vector checks. The old plain columns are dropped: the site has not launched, so no saved contacts are lost.

**Seen by the game's captains and ref, on game day, and nobody else.** `cardsVisible` (`src/domain/emergency/emergency.ts`) allows a game's captains and co-captains and its accepted ref, from midnight to midnight of the game's date in the league's time zone, for a game that is placed and not called off. Admins and owners, other players and other teams' captains never see a contact; the permission `emergency_contact.view` leaves admins out on purpose. The page lists both rosters and the subs approved for that game, with a call link for each contact.

**Every read is audited.** Each render of `/app/games/[game]/emergency` writes an `emergency_contact.view` audit row in the same transaction, with the reader and the game and counts only, never a contact.

**Kept offline until midnight, then gone.** The home screen names the page to the service worker with an expiry, as it does the permit (ADR 0034). The worker deletes the saved copy once that time passes, checking when the page is opened, with or without signal; when the home screen next names a game without it; and on sign-out.

**Consent at entry.** The emergency section of the profile says who can see the contact, when, that reads are recorded and that admins can't see it, before the player saves it. Registration still needs a saved contact (`readyToRegister`).

## Alternatives considered

- **Keep plain columns and restrict reads in code.** Simplest, but a database copy or a stray query exposes every contact.
- **Show contacts to captains all season, or to admins.** More convenient, but far more exposure than an emergency at a game needs; admins can still reach a player through the league's own channels.
- **A separate contact store for game day next to the profile's.** Two contacts per player that could disagree; one sealed record is simpler and safer.
- **A key from a separate environment variable.** Cleaner key separation, but another secret to manage; a purpose-specific HKDF key from the auth secret gives separation without a new setting.

## Consequences

- Rotating the auth secret makes every saved contact unreadable; players are asked to enter it again (the profile shows the section empty). The same is already true of the Instagram token.
- The contacts can't be searched or filtered in SQL, and the league can't send them anywhere in bulk, by design.
- A captain whose phone stays offline past midnight sees the offline page instead of the contacts.
- The data export opens the contact for its owner; a deleted account's contact is deleted, not kept.
