// Read by next.config.ts, so this file imports nothing.

/** Seconds: Vercel keeps an optimized image at most 31 days. */
export const LONG_PHOTO_LIFETIME = 31 * 24 * 60 * 60;

/** Seconds: a photo's own address is kept five minutes (`photoCacheHeaders`). */
export const SHORT_PHOTO_LIFETIME = 5 * 60;

/**
 * How long the image optimizer keeps a resized photo (ADR 0064). On Vercel a
 * takedown purges a photo's copies at once, so they can live the full 31
 * days and each photo costs a transformation per width about once a month.
 * Anywhere else nothing purges them, so they keep the photo's own five
 * minutes and a takedown still reaches them in time.
 */
export function optimizedPhotoLifetime(env: { VERCEL?: string }): number {
  return env.VERCEL === "1" ? LONG_PHOTO_LIFETIME : SHORT_PHOTO_LIFETIME;
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
