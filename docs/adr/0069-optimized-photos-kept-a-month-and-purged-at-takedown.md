# ADR 0069: Optimized photos kept a month and purged at takedown

- Status: accepted
- Date: 2026-11-15

## Context

The stored photos (Instagram copies, members' approved photos and merch photos) are served from `/media/...` and shown through the image optimizer at the width each cell needs. Their routes sent `max-age=300` and `images.minimumCacheTTL` was 300, so an optimized copy was fresh for five minutes. That kept the promise in [ADR 0023](0023-instagram-photos-stored-in-postgres.md) and [ADR 0039](0039-member-photos-in-postgres.md): a photo that is hidden or taken down stops answering at its address within five minutes.

Vercel bills an image transformation and a cache write for every optimizer cache MISS and STALE ([limits and pricing](https://vercel.com/docs/image-optimization/limits-and-pricing)). The Hobby plan includes 5,000 transformations, 100,000 image cache writes and 300,000 image cache reads a month. Over the limit, new images fail with a 402 and show their `alt` text until 30 days pass; nothing is billed, but photos break.

With five minutes, the home page alone (a cover and 8 photos, about 2 widths each across the phones that visit, asked for in about 100 of the day's 288 five-minute windows) makes about 1,800 transformations a day: the month's 5,000 in three days. Each transformation also fetches the photo from its route, which reads its bytes from Postgres: about 54,000 reads of about 200 KB, or 11 GB a month against Neon's 5 GB of free network transfer.

## Decision

**On Vercel, the optimizer keeps a copy for 31 days, the longest it keeps one** (`images.minimumCacheTTL`, from `optimizedPhotoLifetime` in `src/lib/media/optimizer-cache.ts`). A photo's ID never changes its bytes (a new upload or sync gets a new ID), so the address is already a lasting cache key and needs no content hash.

**Every takedown purges the photo's copies at once.** The actions that can take a photo down (hide, unfeature or stop showing the newest Instagram posts, a sync, disconnect or reconnection to another account that deletes posts, deleting or taking down a member's photo, deleting an account, hiding a merch item or removing its photo) run inside `purgingPhotoChanges`. It reads the addresses of every public photo before and after the change and purges each address that left the list, and each that joined it (a cached 404 from while it was hidden). The purge goes through `@vercel/functions`, which is free on every plan:

1. `dangerouslyDeleteByTag` clears the CDN's copy of the photo's own address, which the route tags with that address (`Vercel-Cache-Tag`, `photoCacheHeaders` in `src/lib/media/photo-src.ts`). This comes first, so the optimizer cannot fetch the photo from the CDN again.
2. `dangerouslyDeleteBySrcImage` clears every resized copy made from that address.

Both delete rather than invalidate, with no grace period. An invalidated copy is served once more while the host revalidates in the background; a deleted one makes the next request wait for the address, which already answers 404. The pages already drop the photo at once by cache tag and path, as before.

Pages and purges build the address with the same function (`photoSrc`), because the host matches a purge to the source exactly.

**Only the widths the pages use are allowed.** Every width, format and quality is its own transformation, and the optimizer refuses any width not listed, so the list bounds what anyone can make it produce: widths 256, 384, 640, 750, 828, 1080, 1200 and 1920 (stored photos are at most 1,440 px wide, and a desktop cover asks for at most 2,000), one format (WebP) and one quality (75). The grids and covers on a phone use the same widths as before.

**Anywhere else, the five minutes stay.** Off Vercel nothing can purge an optimized copy, so `minimumCacheTTL` stays 300 and the purge does nothing. The photo routes keep `max-age=300, s-maxage=300` everywhere, so a direct visit to an address stops working within five minutes even where nothing is purged.

### Numbers for a busy month

The photo caps bound how many photos can be public at once, at any league size: about 40 Instagram photos (the 30 newest plus featured ones), about 330 members' photos (100 MB at about 300 KB) and about 40 merch photos (10 MB), so about 410.

| | Five minutes (before) | 31 days and purge (this decision) | Free limit |
|---|---|---|---|
| Image transformations | About 54,000 from the home page alone | Each public photo at about 3 widths once a month: about 1,300, plus one for each width of a photo shown again after a takedown | 5,000 |
| Image cache writes | The same 54,000 | The same 1,300 | 100,000 |
| Function invocations of the photo routes | About 54,000 | About 1,300, plus direct visits | 1,000,000 |
| Postgres network transfer for photos | About 11 GB | About 260 MB | 5 GB |
| Purge calls | None | Two for each takedown (16 photos a call) | 50 a second |

Image cache reads are charged only when a region has no copy of its own, so most image requests cost none. At 12 teams all image requests together stay well under the 300,000 a month; at 50 teams they could approach it only if most came from regions with no copy.

The worst case is every public photo asked for at every allowed width in both WebP and its stored format: about 6,500 transformations. Only a deliberate crawler would do that. If the month's limit is reached anyway, photos already optimized keep working and new ones show their `alt` text in a box that keeps its shape until the 30 days pass. An admin sees the count on the usage page in Vercel's dashboard, as for the other limits (docs/architecture.md, section 15).

### When a takedown takes effect

- On Vercel: at the takedown. The page drops the photo on its next request, the CDN's copy of the address and every optimized copy are deleted before the action returns, and the next request for either gets a 404. A browser that already loaded the photo keeps its own copy, as it could save the photo anyway.
- If the host refuses a purge twice (more than 50 calls a second, or an outage), the action still succeeds, the server logs `photo cache purge failed` with the addresses, and each address is recorded in its league's audit log as `photo_cache.purge_failed`, with no actor, so admins see it. A daily job (`/api/jobs/photo-purges`) tries every recorded failure again and records `photo_cache.purged` for each one that gets through. A failure stays due until then, or for 31 days, after which the optimizer's copies have expired on their own. So a failed purge leaves the photo answering until the next daily run at most, unless the host stays down; an admin who can't wait purges it by hand in Vercel's dashboard (the project's CDN settings, Caches, Purge, by source image `/media/...`) or with `vercel cache dangerously-delete --srcimg`. The failures live in the audit log rather than a table of their own, which needs no migration and puts them where admins already look; the cost is one lookup on the audit log's entity index per run.
- Anywhere else: within five minutes, as before.

## Alternatives considered

- **Keep five minutes and cap the photos and widths on public pages.** Fewer photos and widths only divide the 54,000; the month's limit would still be reached, and pages would show fewer photos.
- **Store each photo at the sizes the pages use and serve them without the optimizer** (`unoptimized`). It needs the same purge for a CDN lifetime long enough to keep the routes from reading Postgres on every view, plus a migration for the variants and more stored bytes under the photo caps, and it gives up WebP and AVIF chosen per browser. The optimizer with a long lifetime does the same job with the copies on the host.
- **Vercel's REST purge endpoint instead of the package.** It works from anywhere but needs a Vercel API token in the hosting settings, a broad credential the app otherwise has no use for. The package uses the deployment's own access.
- **Invalidate instead of delete.** Cheaper for a busy page, but the taken-down photo is served once more from the stale copy.

## Consequences

- The host's purge lives in one file, `src/lib/media/host-purger.ts`, behind `HOST_PURGE_READY` in `src/lib/media/optimizer-cache.ts`. The 31-day lifetime turns on only together with it, so turning the purge off (or replacing the package) also brings back the five minutes, and the optimizer never keeps a copy longer than a takedown can reach.
- A new action that can take a photo down must run inside `purgingPhotoChanges`; a takedown that skips it leaves the optimized copies up to 31 days.
- Each takedown reads three short lists of IDs twice, a few kilobytes.
- Moving to another host keeps the five minutes and needs no change, at the cost of that host's own image optimization limits.
- The ADR 0023 and ADR 0039 promise becomes stronger on Vercel: at once instead of within five minutes.
