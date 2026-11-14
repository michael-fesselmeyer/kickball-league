import { createHash } from "node:crypto";
import {
  checkFile,
  MAX_INPUT_PIXELS,
  MAX_STORED_BYTES,
  STORED_LONG_EDGE,
  STORED_QUALITIES,
  type UploadProblem,
} from "@/domain/member-photos/limits";
import { err, ok, type Result } from "@/domain/result";

/**
 * Turns an uploaded file into the one copy the league stores (ADR 0039).
 * Server only, and sharp is loaded on first use, so no page imports it.
 *
 * - The file must really be a JPEG, PNG or WebP: its first bytes are
 *   checked, then sharp must decode it as that same format.
 * - At most STORED_LONG_EDGE pixels on its longest side, never enlarged,
 *   after turning it the way the camera held it.
 * - One JPEG: what Instagram and every phone take, so admins can repost
 *   the download as it is. Pages get smaller WebP or AVIF copies from the
 *   image optimizer.
 * - No metadata: sharp writes none unless asked, so a phone's location
 *   (EXIF GPS), its serial number and the time never reach the database.
 * - Lower qualities are tried until the copy is under MAX_STORED_BYTES.
 */
export type ProcessedPhoto = {
  bytes: Buffer;
  width: number;
  height: number;
  sha256: string;
};

const FORMAT = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export async function processPhoto(
  input: Buffer,
): Promise<Result<ProcessedPhoto, UploadProblem>> {
  const checked = checkFile(input);
  if (!checked.ok) return checked;
  const { default: sharp } = await import("sharp");
  try {
    const source = sharp(input, {
      failOn: "error",
      limitInputPixels: MAX_INPUT_PIXELS,
    });
    const meta = await source.metadata();
    // Sharp reads by content too; a mismatch means a disguised file.
    if (meta.format !== FORMAT[checked.value]) return err("not_image");
    for (const quality of STORED_QUALITIES) {
      const { data, info } = await sharp(input, {
        failOn: "error",
        limitInputPixels: MAX_INPUT_PIXELS,
      })
        .rotate()
        .resize({
          width: STORED_LONG_EDGE,
          height: STORED_LONG_EDGE,
          fit: "inside",
          withoutEnlargement: true,
        })
        // A transparent PNG gets a white background, not black.
        .flatten({ background: "#ffffff" })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
      if (data.length <= MAX_STORED_BYTES)
        return ok({
          bytes: data,
          width: info.width,
          height: info.height,
          sha256: createHash("sha256").update(data).digest("hex"),
        });
    }
    return err("too_big_after_resize");
  } catch {
    return err("unreadable");
  }
}
