# ADR 0035: Member photos, photos only, stored in Postgres with hard limits

- Status: accepted
- Date: 2026-11-13

## Context

The product spec (section 9, P2) asks for members to upload "photos and videos that could go on the league's socials", with a checkbox that the league may repost them and an admin review queue that approves, rejects or downloads a file for Instagram. The site must cost nothing to run ([ADR 0021](0021-free-services-only.md)), so whatever stores the files has to fit a free tier shared with everything else.

What we have:

- Neon's free tier gives 1 GB of storage per project, shared by every table. Synced Instagram photos already live in Postgres under a 25 MB cap ([ADR 0023](0023-instagram-photos-stored-in-postgres.md)), and the owners' receipts and permits under a 50 MB cap ([ADR 0034](0034-owners-books-and-permits-in-postgres.md)).
- There is no Blob store yet. Vercel Blob's free allowance is 1 GB stored and 10 GB of transfer a month, and adding it means a new package and a store to set up at launch.
- Vercel limits a function's request body to 4.5 MB, and Next.js Server Actions to 1 MB unless configured. A phone photo is 2 to 10 MB; a minute of phone video is 100 MB or more.
- Players mostly use the site on phones, often on a weak signal at the park.

## Decision

**Photos only, no videos.** A single phone video is larger than the whole photo budget and larger than any request the host accepts, and keeping several would pass the free storage and transfer of any provider we use. Re-encoding video on the server is far beyond a free function's CPU time. The upload page says "Videos can't be uploaded", the server recognizes MP4, MOV, WebM and AVI by their bytes and answers with a message that suggests sending a still instead, and the spec's video half waits until there is a free option.

**One small JPEG per photo, in Postgres** (`member_photo.bytes`), the same approach as the Instagram copies:

- The phone shrinks a photo over 1.5 MB to 2048 px on a canvas before sending it, so it goes up as a few hundred kilobytes. Without JavaScript the original goes, up to 4 MB.
- The server never trusts the file name or type: the first bytes must be JPEG, PNG or WebP, and sharp must decode the file as that same format, with a 50-megapixel limit against decompression bombs. HEIC is refused with its own message; iPhone browsers convert to JPEG on upload when the page asks only for JPEG, PNG or WebP.
- It is turned the way the camera held it, shrunk to at most 1440 px on its longest side (Instagram's largest size) and stored as one JPEG, the format Instagram and every phone accept, so admins repost the download as it is. Quality 82, then 72, then 62, whichever first fits 1 MB. Sharp writes no metadata, so the phone's location, model and serial number are never stored. Pages get WebP or AVIF copies at the size they need from the image optimizer, as for Instagram photos (`getImageProps`, no image component JavaScript).

**Hard limits**, enforced when a photo is stored and checked by database constraints where they can be:

| Limit | Value | What happens |
|---|---|---|
| One upload | 4 MB before shrinking, 50 megapixels | "That file is over 4 MB" or "couldn't be read" |
| One stored photo | 1 MB, 1440 px | Shrunk to fit; a photo that still doesn't fit is refused |
| Per person | 10 uploads in any 24 hours | "Try again tomorrow" |
| The league | 100 MB stored | Uploads close with a clear message on the upload page and the review queue until admins delete older photos |

Uploads for a league take turns under a transaction lock, so two at once cannot both fit the last space. Rejecting a photo deletes its bytes at once and keeps a row without them, so the uploader still sees it wasn't used. 100 MB is about 300 photos at a typical 300 KB, a season or two of the best shots, and 10% of the free storage; with Instagram's 25 MB, the owners' 50 MB of files ([ADR 0034](0034-owners-books-and-permits-in-postgres.md)) and 10 MB of merch photos ([ADR 0037](0037-merch-orders-hold-stock-at-checkout.md)), stored files use under a fifth of it.

**Consent and review.** The upload form requires "The league may repost this on its socials", stored as `repost_consent_at`. Nothing shows publicly until an admin approves it. Admins reject with an optional note only admins see; the uploader hears the decision through a non-urgent `photo_review` message under a new `photos` topic they can turn off, never with the note. The uploader can delete their photo at any time, admins can take any photo down, and deleting an account deletes every photo the person uploaded. Approve, reject and delete are audited.

**The upload is a Server Action**, checked by `requirePermissionToChange` like every other change, using the 4 MB body limit the owners' books already set (`experimental.serverActions.bodySizeLimit`), under the host's 4.5 MB request limit.

## Alternatives considered

- **Vercel Blob, uploaded straight from the browser.** Better for larger and more files, and served from the CDN without a function. Not chosen now: it needs a new package and a store set up at launch, its free allowance is another limit to watch, and the files would still need resizing and metadata stripping on the server, which a direct upload skips. The photos sit behind one table and two routes, so moving them later changes the upload action and the routes, not the pages.
- **Videos with a short length limit.** Even 15 seconds of phone video is 20 to 40 MB, and the host's request limit would need direct uploads to a store; out until a free store can hold them.
- **Keeping the original file** for the best repost. Several megabytes each would fill the free tier in a few dozen photos and keep the metadata; 1440 px is the largest Instagram shows.
- **WebP for the stored copy**, as Instagram photos are. Smaller, but Instagram and some phones' galleries handle a downloaded WebP poorly, and admins download these to repost.
- **Resizing only in the browser.** Saves server CPU, but a modified or scripted request could store anything; the server's check is the one that counts.
- **A separate uploads table and a thumbnail column.** Twice the rows or bytes for little gain: the queue shows a few dozen photos, lazily.

## Consequences

- Admins must clear older photos when the 100 MB fills up; the review queue shows storage used against the cap and says what to do.
- A photo taken down leaves every page on its next request, and its address keeps answering from caches for up to five minutes, as for Instagram photos.
- Videos are not supported. The spec's "photos and videos" stays half done until there is a free way to store and serve them.
- Tests cover the byte checks and limits as unit tests, processing with generated images (orientation, metadata removal, disguised files, a decompression bomb), the database rules (who may tag what, the daily and league limits, review, deletion and account deletion), and an end-to-end flow at phone width.
