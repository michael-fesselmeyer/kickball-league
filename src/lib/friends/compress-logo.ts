import { createHash } from "node:crypto";
import type { StoredLogo } from "@/db/queries/friends";
import { LOGO_BOX } from "@/domain/friends/logo";

/**
 * Makes the stored copy of a friend league's logo: one WebP that fits in a
 * LOGO_BOX square (the page shows it at 64 CSS pixels, so this covers
 * 3x screens), never enlarged, with its metadata dropped. Server only, like
 * the Instagram photo copies (src/lib/social/compress-photo.ts); sharp is
 * loaded on first use. Null when the bytes are not an image sharp can read.
 */
export async function compressLogo(input: Buffer): Promise<StoredLogo | null> {
  const { default: sharp } = await import("sharp");
  try {
    const { data, info } = await sharp(input, {
      failOn: "error",
      // A small file can still claim enormous dimensions.
      limitInputPixels: 4096 * 4096,
    })
      .rotate()
      .resize({
        width: LOGO_BOX,
        height: LOGO_BOX,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 85, alphaQuality: 90 })
      .toBuffer({ resolveWithObject: true });
    return {
      contentType: "image/webp",
      bytes: data,
      width: info.width,
      height: info.height,
      sha256: createHash("sha256").update(data).digest("hex"),
    };
  } catch {
    return null;
  }
}
