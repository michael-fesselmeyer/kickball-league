# ADR 0013: A rotating check-in code, drawn as a QR code on the server

- Status: accepted
- Date: 2026-11-13

## Context

The home bar wants proof that the league brings people in after games (product-spec.md, the bar owner persona). Players check in at the bar and may use a deal. A check-in only means something if the player was actually there, but the league can't put hardware in the bar, and players won't install anything. Players mostly use phones on bar Wi-Fi or cell signal, and the public pages have a strict JavaScript budget ([design-system.md](../design-system.md#performance-budgets)).

## Decision

**The code rotates.** The bar shows a QR code on a screen (a tablet or a spare phone) from the sponsor portal. It links to `/app/check-in/<sponsor>/<code>`, where the code is an HMAC-SHA256 of the 5-minute window's number under the sponsor's own secret (`sponsor.checkin_secret`), cut to 10 characters from an alphabet without look-alikes (`src/domain/sponsors/checkin-code.ts`). The server accepts the current window and the one before, so a scan made as the code turns over still works. The screen fetches the page again just after each turnover and asks the device to keep the screen on.

**Checking in is a tap, not a page view.** The link opens a page with a Check in button; the Server Action checks the code again before it writes. A link preview, a prefetch or a crawler never checks anyone in. One check-in per player per sponsor per day is a unique constraint, and one use of each deal per check-in is another, so a double tap or a second scan changes nothing.

**The QR code is drawn on the server.** A small encoder (`src/domain/qr/encode.ts`: byte mode, error correction level M, versions 1 to 10) turns the link into an SVG path in the server component. The page gets plain SVG and no client code for the QR code at all, and the project takes on no new dependency for it. Its Reed-Solomon output matches the standard's worked example, and codes of versions 2 to 10 were decoded by a browser's built-in barcode detector.

## Alternatives considered

- **A printed, fixed code.** Easy for the bar, but a photo of it shared in the league's group chat checks anyone in from anywhere, and the numbers would prove nothing. The portal says the code is shown, not printed.
- **Location (geofencing).** Needs the player to grant location, drains battery, and is unreliable indoors and between neighboring bars.
- **The bartender confirms each check-in.** The most certain, but it costs staff time on the busiest hour of the night, which the bar will not keep doing.
- **A QR library in the browser, or as a server dependency.** A few dozen kilobytes in the browser for something the server can draw once; or a dependency to keep up to date for a few hundred lines of well-specified code.

## Consequences

- A copied code works for 5 to 10 minutes, long enough to check in a friend who is on the way, not long enough to farm check-ins from home.
- The bar needs a screen it leaves open on the code page. If the screen sleeps, the code is stale until it wakes and refreshes.
- Each sponsor has its own secret, so one sponsor's code says nothing about another's. The secret is never selected by a public query.
- The encoder stops at version 10 (213 bytes), far above a check-in link, and throws past it rather than drawing an unreadable code.
