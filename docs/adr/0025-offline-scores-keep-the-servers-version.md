# ADR 0025: Offline score entries are taken once and never overwrite a newer score

- Status: accepted
- Date: 2026-11-13

## Context

Fields often have no signal. A ref or captain must be able to enter a final score, and the runs of each half-inning when the game is scored live, with no connection, and have each entry reach the server when the signal comes back (product spec, section 6, "Offline score entry that syncs when signal returns"). By then the server may have moved on: the other captain may have reported a score, confirmed one, or saved the same half from another phone. A phone may also send the same entry more than once, because a request can reach the server while its answer is lost. The app must cost nothing to run, so the only tools are the browser's storage and the service worker the installable app already has (architecture section 14).

## Decision

**The service worker keeps the outbox.** A score screen hands a new entry to the worker, which saves it in IndexedDB (`kb-outbox`) and sends it to `POST /api/games/[game]/offline`. It sends when the entry is saved, on Background Sync where the browser has it (Android and desktop Chrome, even with the app closed), and whenever a page asks: on opening a score screen or the home screen, and on the browser's `online` event. iPhones have no Background Sync, so there an entry goes out the next time the app is opened with signal. Entries go one at a time, oldest first, and sending stops at the first one that can't go yet, so live halves arrive in the order they were made.

**Each entry has a key made on the phone, and the server takes each key once.** The route writes an `offline_receipt` row for the key before it does anything else, in the same transaction as the change. A second copy of the entry, even one arriving at the same moment, waits on that row and then gets the answer stored with it, and changes nothing. A final score also uses the key as its report's `client_id`, so an ordinary submit that went through before the phone fell back to saving the entry is recognized too.

**A late entry never overwrites a score that changed after it was made.** The server's version stands and the person is told what it is:

- A final score carries the version of the score the screen showed: its latest report and how many answers that report had (`scoreVersion`). If anyone reported, confirmed or disputed a score since, the entry is not used, and the answer names the score that stands and what to do (confirm or dispute it, or nothing if it is final).
- A half-inning carries the runs the phone showed for that half (none for a new half). If the server has the same runs, nothing changes. If it has what the phone showed, the new runs go in. Otherwise someone else saved that half first, and their runs stand.

Offline entries get the same checks as the score screens: the person must be signed in as the one who made the entry, may score the game, and the site must not be paused (`permissionToChange`, the answering form of `requirePermissionToChange`). A new report queues the other captain's confirmation request through the outbox in the same transaction, so it goes out once.

## Alternatives considered

- **Last write wins.** Simplest, but a captain's phone coming back into range an hour later would replace the score the other captain had already confirmed, and nobody would notice.
- **Merge the two scores, or ask the person to choose on the phone.** There is nothing sensible to merge in a final score, and asking means a second round trip from a phone that just found signal. Showing what stands, with a link to confirm or dispute it, uses the flow the league already has for disagreements.
- **Store the outbox in Cache Storage.** The worker's tests already fake it, but it is a store for responses, and the worker drops old `kb-` caches when it updates. IndexedDB is the browser's store for records like these.
- **A sync service or library (Workbox Background Sync, a hosted sync backend).** Workbox would replace about a hundred lines of the worker but adds a build step to a worker that is hand-written on purpose, and a hosted service costs money and sees the league's data.
- **Remember keys without a table**, by comparing runs alone. A resend would then put back a half that someone had taken back on the server, because the half looks new again. The receipt is what makes a resend harmless.

## Consequences

- One small row per offline entry. Receipts go with their game or their person when either is deleted.
- An entry saved on a phone stays there until it is sent or the person signs out. Signing out drops entries not yet sent, because they are that person's, and the server refuses an entry from anyone but the person who saved it.
- On an iPhone, a score entered offline reaches the server only when the app is opened again with signal. The home screen sends anything waiting and shows what happened to it.
- Taking back a half and switching who kicks first still need a signal; with none, the screen says so and points to changing a half's runs instead, which works offline.
- Entering a score needs the score screen to be open already. A screen that was never opened has nothing saved to open with no signal; saving the score screen for the person's next game is a possible next step.
