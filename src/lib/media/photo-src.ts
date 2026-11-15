import type { MemberPhotoId, MerchImageId, SocialImageId } from "@/domain/ids";

/**
 * The public addresses of the stored photos that go through the image
 * optimizer (ADR 0064). The pages render these, and a takedown purges the
 * optimizer's copies by the very same string, so the two can never drift
 * apart: the host matches a purge to a source image exactly.
 *
 * An ID's bytes never change (a new upload or sync gets a new ID), so the ID
 * itself is a lasting cache key and the address needs no content hash.
 */
export const photoSrc = {
  instagram: (id: SocialImageId | string) => `/media/instagram/${id}`,
  member: (id: MemberPhotoId | string) => `/media/photos/${id}`,
  merch: (id: MerchImageId | string) => `/media/merch/${id}`,
} as const;

/**
 * The cache headers of a public photo's own address. Browsers and the CDN
 * keep it five minutes, so a direct visit stops working soon after a
 * takedown even off this host. The optimizer keeps its resized copies far
 * longer (`next.config.ts`), and a takedown purges both the CDN copy (by
 * this tag) and the optimizer's copies (by the address).
 */
export function photoCacheHeaders(src: string): Record<string, string> {
  return {
    "Cache-Control": "public, max-age=300, s-maxage=300",
    "Vercel-Cache-Tag": src,
  };
}
