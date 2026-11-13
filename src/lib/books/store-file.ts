import { createHash } from "node:crypto";
import {
  FILE_MAX_BYTES,
  type FileProblem,
  STORED_EDGE,
  STORED_QUALITY,
  sniffUpload,
  UPLOAD_MAX_BYTES,
} from "@/domain/books/files";
import { err, ok, type Result } from "@/domain/result";

/**
 * Turns an uploaded receipt photo or permit document into the one copy the
 * books keep (ADR 0034). Server only; sharp is loaded on first use.
 *
 * - A photo is turned to match the camera, shrunk to fit STORED_EDGE on its
 *   longer side and saved as WebP. sharp drops EXIF, so a phone's location
 *   never reaches the database. A photo still over 1 MB is tried once more
 *   at a lower quality before it is refused.
 * - A PDF (recognized by its first bytes, not its name) is kept as it is,
 *   and must be 1 MB or less.
 */

export type PreparedFile = {
  contentType: "image/webp" | "application/pdf";
  bytes: Buffer;
  sha256: string;
};

const LOWER_QUALITY = 50;

export async function prepareUpload(
  file: Blob,
): Promise<Result<PreparedFile, FileProblem>> {
  if (file.size > UPLOAD_MAX_BYTES) return err("too_large");
  const input = Buffer.from(await file.arrayBuffer());
  if (sniffUpload(input.subarray(0, 5)) === "pdf") {
    if (input.length > FILE_MAX_BYTES) return err("too_large");
    return ok(withHash("application/pdf", input));
  }
  const { default: sharp } = await import("sharp");
  const encode = (quality: number) =>
    sharp(input, { failOn: "error" })
      .rotate()
      .resize({
        width: STORED_EDGE,
        height: STORED_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality })
      .toBuffer();
  try {
    let bytes = await encode(STORED_QUALITY);
    if (bytes.length > FILE_MAX_BYTES) bytes = await encode(LOWER_QUALITY);
    if (bytes.length > FILE_MAX_BYTES) return err("too_large");
    return ok(withHash("image/webp", bytes));
  } catch {
    return err(file.type.startsWith("image/") ? "unreadable" : "not_supported");
  }
}

function withHash(
  contentType: PreparedFile["contentType"],
  bytes: Buffer,
): PreparedFile {
  return {
    contentType,
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

/** A stored file as a private response: never cached by a CDN or proxy. */
export function privateFileResponse(file: {
  contentType: string;
  bytes: Buffer;
  sha256: string;
  name: string;
}): Response {
  const pdf = file.contentType === "application/pdf";
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.bytes.length),
      "Cache-Control": "private, no-store",
      ETag: `"${file.sha256}"`,
      // A PDF downloads and opens in the phone's own viewer; a photo shows.
      "Content-Disposition": `${pdf ? "attachment" : "inline"}; filename="${file.name}.${pdf ? "pdf" : "webp"}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
