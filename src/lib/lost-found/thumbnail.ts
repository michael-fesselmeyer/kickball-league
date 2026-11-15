import { THUMB_LONG_EDGE } from "@/domain/lost-found/rules";
import type { ProcessedPhoto } from "@/lib/member-photos/process-photo";
import type { BoardPhoto } from "@/db/queries/lost-found";

/**
 * Adds the board's small thumbnail to a processed photo (server only; sharp
 * loads on first use). The board is a list read on phones, so it shows this
 * copy of a few kilobytes, never the full photo.
 */
export async function withThumbnail(
  photo: ProcessedPhoto,
): Promise<BoardPhoto> {
  const { default: sharp } = await import("sharp");
  const thumb = await sharp(photo.bytes)
    .resize({
      width: THUMB_LONG_EDGE,
      height: THUMB_LONG_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 70, mozjpeg: true })
    .toBuffer();
  return { ...photo, thumb };
}
