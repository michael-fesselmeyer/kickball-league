# ADR 0015: Passkeys and signed-in devices

- Status: accepted
- Date: 2026-11-13

## Context

Players sign in with an emailed link or Google, and stay signed in on each device for 90 days ([architecture.md](../architecture.md#4-authentication-and-authorization)). Waiting for an email at the field is slow, and a long session on a lost or borrowed phone needs a way to end it. Sensitive actions already need a sign-in from the last 15 minutes, and the only way to get one was a new email link (roadmap section 4, Phase 2 item 19).

## Decision

**Better Auth's passkey plugin for the WebAuthn ceremonies.** `@better-auth/passkey`, the plugin from the same project and version as the auth library, stores passkeys in its own `passkey` table and serves registration and sign-in at `/api/auth/passkey/*`. The relying party is the site's own host from `BETTER_AUTH_URL`.

**Gate registration on the server; manage passkeys through Server Actions.** Adding a passkey gives a new way into the account, so it needs a fresh session (the plugin's own check, with our 15-minute `freshAge`) and a writable site (a `hooks.before` guard). Listing, renaming and removing happen on the account page through Server Actions that use `requireSelfToChange` like every other change, scoped to the signed-in person in the query. The plugin's routes for those three are switched off with `disabledPaths`, so there is one path to each change.

**Devices are sessions.** The device list is the person's live `session` rows, named from the User-Agent header. The page signs a device out by deleting its row by id and user id; it never reads or sends a session token.

**Confirming again replaces the browser's session.** A passkey or an email link is a new sign-in, which Better Auth records as a new session. A `session.create.after` hook reads the browser's previous session cookie and, when it belongs to the same account, ends that session. Without it, every confirmation would leave the same phone in the list twice.

**One prompt for fresh confirmation.** `ConfirmItsYou` offers "Confirm with a passkey" (when the person has one) and "Email me a sign-in link" that returns to the page. Account deletion, passkey changes and the operator console use it.

**Passkeys work in the demo; signing other devices out does not.** Demo personas are shared and recreated by the nightly reset, which removes their passkeys with them, so a visitor can try Face ID sign-in safely. Signing other sessions out would sign out other visitors, so the demo lists only the current device.

**Load the browser code on demand.** The passkey client loads with `import()` when a passkey button is tapped or the sign-in email field is focused, so the sign-in page's first load and its Lighthouse budget are unchanged.

## Alternatives considered

- **Hand-written WebAuthn with `@simplewebauthn/server`.** Full control, but the challenge storage, counter checks and session creation would duplicate what the auth library already does and tests, and would be ours to keep secure.
- **The plugin's own list, rename and delete routes from the browser.** Less code, but they bypass the read-only site check and the demo rules that every other change goes through, and they hand passkey ids to client code that does not need them.
- **Better Auth's `listSessions` and `revokeSession`.** They work with session tokens, which would have to reach the page to name the session to revoke. Deleting by id keeps tokens out of the HTML.
- **Passkey autofill on page load.** Starts the browser's conditional request immediately, but loads the WebAuthn code on every visit to the sign-in page, which counts against its JavaScript budget. Starting on focus loses nothing a person would notice.

## Consequences

- A passkey sign-in is a normal 90-day session, like an email link.
- A device's name is only as good as its User-Agent header; an unrecognised browser shows "Unknown device", and the sign-in and last-used times still identify it.
- Upgrading Better Auth means checking the passkey table's shape against the plugin's schema, as for its other tables.
- Refunds still ask an admin to sign out and back in; moving them to `ConfirmItsYou` is a small follow-up.
