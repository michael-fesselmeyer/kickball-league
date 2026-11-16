# ADR 0077: Signing in inside the iOS and Android apps

- Status: accepted
- Date: 2026-11-15

## Context

The iOS and Android apps are a native shell whose web view opens the site (ADR 0090). None of the site's sign-in methods finished there:

- **Google** refuses sign-in inside an embedded web view.
- **A magic link** opens in the phone's browser or mail app, not the app, so the session lands in the wrong place.
- **Passkeys** in a web view need the site and app tied together: Associated Domains on iOS, which needs the paid Apple developer account, and Digital Asset Links plus web view support on Android.

Sign-in should be as easy as possible, and everything must stay free ([ADR 0021](0021-free-services-only.md)).

## Decision

**1. Stay signed in.** Sessions already last 90 days and renew each day they're used ([architecture, section 4](../architecture.md#4-authentication-and-authorization)), and the apps' web views keep their cookies, so anyone who opens the app once a season never signs in again. Signing in in the app makes the same session, with the same freshness rules for sensitive actions. Nothing changes here; the point is that sign-in is rare.

**2. A code next to every sign-in link.** The sign-in email now carries a six-digit code, in its subject and at the top of its body, as well as the link. Typing the code where the email was asked for signs in there: in the app, or on a laptop when the email is read on a phone. The field asks for `autocomplete="one-time-code"`, so iOS offers the code from Mail and Android from its notification. The link still works on its own, on the web as before.

- Link and code are one sign-in: using either uses up both (`POST /api/auth/sign-in/code`, `leagueSignIn` in `src/lib/auth/sign-in-plugin.ts`).
- A code expires with its link (15 minutes), and a newer email replaces the address's code; older links still work.
- Guesses are capped at 5 per address per link lifetime and 10 per address per day, from any IP, plus 10 attempts per IP every 10 minutes. A stranger has about a 1 in 100,000 chance a day of guessing an address's code; past the limit, the link still works.
- The database holds only an HMAC of each code (keyed with the auth secret and bound to the address) and the hashed link token it stands for, so a copy of the database can't be searched for a code.
- No new table: pending codes are rows in Better Auth's `verification` table, and guess counts in `rate_limit`.

**3. Google through the system browser sheet.** In the apps, "Continue with Google" opens Google in the system's sign-in sheet, never the web view: ASWebAuthenticationSession on iOS (a small native plugin, `mobile/native/ios/WebAuthSessionPlugin.swift`) and a Custom Tab on Android (the Browser plugin). Both are free. The sheet returns to the app through its own URL scheme, the app id (`MOBILE_APP_ID`, default `com.example.kickball`), with a one-time code:

1. The app makes a random verifier, keeps it in memory, and opens `/api/app-sign-in/google?challenge=<SHA-256 of the verifier>` in the sheet.
2. That route sets a short-lived, HttpOnly start cookie with the challenge and the time, and sends the sheet to Google through Better Auth, as the web does.
3. Google returns to Better Auth's callback, which signs the sheet in and continues to `/api/auth/app-sign-in/handoff`. That route checks the start cookie matches the challenge and that the sheet's sign-in is newer than the start, stores a one-time code (hashed, two minutes) for the person and the challenge, signs the sheet out again, and redirects to `<scheme>:/sign-in?code=…`.
4. The app takes the code from that address and posts it with its verifier to `/api/auth/app-sign-in/redeem`, which checks SHA-256(verifier) against the challenge, uses the code up whether or not it matches, and sets the session cookie in the app's web view.

This is the PKCE pattern OAuth uses for apps: another app that catches the redirect has the code but not the verifier, and a code planted on someone's phone can't sign their app into another account. On iOS, ASWebAuthenticationSession returns only to the app that opened it.

**4. Passkeys stay on the web for now.** The sign-in page doesn't offer passkeys inside the apps, and the email field doesn't ask for them. Android can support them for free later: serve the app's signing-key fingerprint at `/.well-known/assetlinks.json` (Digital Asset Links), declare it in the app, and turn on WebAuthn in the web view. That needs a stable release signing key, which also enables Android App Links. iOS needs Associated Domains (`webcredentials:`), which needs the paid developer account, so it waits with store publishing.

**5. For later: Sign in with Apple.** An iOS app offered on the App Store with Google sign-in must also offer Sign in with Apple (App Store Review Guideline 4.8). It needs the paid developer account, as publishing does, so it is added if and when the apps are published. Local builds don't need it.

## Native setup

Once the projects exist (`docs/mobile.md` on the apps' branch):

- **Both:** `npm run mobile:sign-in` registers the scheme: an intent filter on Android's main activity, and a URL type in iOS's Info.plist (`scripts/mobile-sign-in-native.ts`). Run it again after changing `MOBILE_APP_ID`.
- **iOS:** add `mobile/native/ios/WebAuthSessionPlugin.swift` and `MainViewController.swift` to the App target in Xcode, and set the view controller's class in `Main.storyboard` to `MainViewController`. Without them the iOS app falls back to the Browser plugin and the URL type, which works but asks "Open in Kickball?".
- **Server:** set `MOBILE_APP_ID` to the same value as the apps when it isn't the default.

## Consequences

- Signing in inside the apps works with an emailed code on both platforms, and with Google on both. Passkeys there wait as described above.
- On the web nothing is lost: the link works as before, and the code helps anyone who reads email on a different device.
- The email subject now starts with the code, which shows on a lock screen. It is the same secret the link already carried in the body, good for 15 minutes and one use.
- Six digits are weaker than a 32-character link, which is why codes have their own per-address limits. If guessing ever shows up, the limits can be tightened without changing the email.
- Android's custom scheme can be claimed by another app on the same phone. The verifier makes a stolen code useless; Android App Links would remove even that once a release key exists.

## Alternatives considered

- **Better Auth's email OTP plugin.** It sends its own email and keeps its own codes, so a person would get two emails, or the site would juggle two limits for one sign-in.
- **Opening the magic link inside the app** through App Links or universal links. Free on Android with a release key, paid on iOS, and it still fails when the email is read on another device.
- **A Google sign-in SDK in each app.** Native buttons, but a second set of OAuth clients and tokens to keep, and Google's tokens would have to reach the server, which the site avoids (security review, L3).
- **Embedding Google in the web view with a changed user agent.** Against Google's policy, and blocked when detected.
