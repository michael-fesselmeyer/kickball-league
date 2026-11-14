/**
 * Shrinks a copied Instagram photo before it is stored (ADR 0023), so the
 * copies stay small on the free database tier. Server only: the sync job,
 * the "Sync now" action and the sign-in callback call it; no page imports
 * it, and sharp is loaded on first use.
 *
 * - At most STORED_WIDTH pixels wide: the widest a page shows a photo is
 *   the home page's full-width cover, inside the 1024px page (about 976 CSS
 *   pixels). Narrower photos are never enlarged.
 * - One WebP copy at quality 80. The image optimizer makes the smaller
 *   sizes from it when a page asks.
 * - No metadata: sharp drops EXIF, so a phone's location never reaches the
 *   database.
 */

export const STORED_WIDTH = 1000;
/**
 * A decoded image larger than this is refused before it is resized, so a
 * small file that claims huge dimensions can't take the server's memory.
 * Instagram serves at most 1440 pixels wide; merch photos come from a phone.
 */
export const MAX_INPUT_PIXELS = 50_000_000;
export const STORED_QUALITY = 80;

export type StoredPhoto = { contentType: "image/webp"; bytes: Buffer };

/** The stored copy, or null when the bytes are not an image sharp can read. */
export async function compressPhoto(
  input: Buffer,
): Promise<StoredPhoto | null> {
  const { default: sharp } = await import("sharp");
  try {
    const bytes = await sharp(input, {
      failOn: "error",
      limitInputPixels: MAX_INPUT_PIXELS,
    })
      .rotate() // Apply the camera's orientation before the metadata goes.
      .resize({ width: STORED_WIDTH, withoutEnlargement: true })
      .webp({ quality: STORED_QUALITY })
      .toBuffer();
    return { contentType: "image/webp", bytes };
  } catch {
    return null;
  }
}
