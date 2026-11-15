// Read by next.config.ts, so this file imports nothing.

/** Seconds: Vercel keeps an optimized image at most 31 days. */
export const LONG_PHOTO_LIFETIME = 31 * 24 * 60 * 60;

/** Seconds: a photo's own address is kept five minutes (`photoCacheHeaders`). */
export const SHORT_PHOTO_LIFETIME = 5 * 60;

/**
 * Whether the host's purge is wired in (`hostPurger`, ADR 0069). The long
 * lifetime depends on it: without a purge a takedown could only wait for
 * the optimizer's copies to expire, so they keep five minutes.
 */
export const HOST_PURGE_READY: boolean = true;

/**
 * How long the image optimizer keeps a resized photo (ADR 0069). On Vercel,
 * once its purge is wired in, a takedown purges a photo's copies at once, so
 * they can live the full 31 days and each photo costs a transformation per
 * width about once a month. Anywhere else, or without the purge, they keep
 * the photo's own five minutes, so a takedown still reaches them in time.
 */
export function optimizedPhotoLifetime(
  env: Readonly<Record<string, string | undefined>>,
  purgeReady: boolean = HOST_PURGE_READY,
): number {
  return purgeReady && env.VERCEL === "1"
    ? LONG_PHOTO_LIFETIME
    : SHORT_PHOTO_LIFETIME;
}

/**
 * The widths the optimizer may make (`deviceSizes` then `imageSizes`). Each
 * width is its own transformation, and a width not listed is refused, so
 * nobody can run up the count by asking for others. The grids want 256 to
 * 640 px, the covers up to 1,000 px on a desktop at twice its density, and
 * stored photos are at most 1,440 px wide, so nothing above 1,920 helps.
 */
export const PHOTO_DEVICE_SIZES = [640, 750, 828, 1080, 1200, 1920] as const;
export const PHOTO_IMAGE_SIZES = [256, 384] as const;
