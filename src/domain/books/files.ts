/**
 * Limits for the owners' stored files: receipt photos, permit documents and
 * the insurance certificate (ADR 0034). They live in Postgres, which every
 * other table shares on the free tier, so each file is small and the whole
 * set is capped.
 *
 * - A photo is resized on the server to at most STORED_EDGE pixels on its
 *   longer side and stored once as WebP, without its metadata. A receipt
 *   photo from a phone ends up around 150 to 400 KB.
 * - A PDF is stored as uploaded, so it must already be 1 MB or less.
 * - At most TOTAL_CAP_BYTES in all. At the cap an upload is refused with a
 *   message that says how to make room; nothing is deleted on its own.
 */

export const FILE_MAX_BYTES = 1024 * 1024;
export const TOTAL_CAP_BYTES = 50 * 1024 * 1024;
/** The largest upload the server reads (next.config.ts allows 4 MB a form). */
export const UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
export const STORED_EDGE = 1600;
export const STORED_QUALITY = 72;

export type FileProblem =
  "too_large" | "not_supported" | "storage_full" | "unreadable";

export const FILE_MESSAGES: Readonly<Record<FileProblem, string>> = {
  too_large:
    "That file is over 1 MB. Take a photo of it instead, or save the PDF smaller.",
  not_supported: "Upload a photo (JPEG, PNG or WebP) or a PDF.",
  storage_full:
    "File storage is full (50 MB), so the file wasn't saved. Download the books, then remove receipts from old seasons to make room.",
  unreadable: "That photo couldn't be read. Try taking it again.",
};

export type UploadKind = "image" | "pdf";

/**
 * What an upload is, from its first bytes rather than the name or type the
 * browser sent: a PDF starts with "%PDF-"; anything else is offered to the
 * image decoder, which refuses what it can't read.
 */
export function sniffUpload(head: Uint8Array): UploadKind {
  const pdf = [0x25, 0x50, 0x44, 0x46, 0x2d];
  return pdf.every((byte, i) => head[i] === byte) ? "pdf" : "image";
}

/** Whether a file of `size` bytes fits beside `usedBytes` already stored. */
export function checkFits(
  size: number,
  usedBytes: number,
  cap = TOTAL_CAP_BYTES,
): FileProblem | null {
  if (size > FILE_MAX_BYTES) return "too_large";
  if (usedBytes + size > cap) return "storage_full";
  return null;
}

/** "12.4 MB of 50 MB", for the owners' screens. */
export function storageLine(usedBytes: number, cap = TOTAL_CAP_BYTES): string {
  const mb = (bytes: number) =>
    (bytes / (1024 * 1024)).toLocaleString("en-US", {
      maximumFractionDigits: 1,
    });
  return `${mb(usedBytes)} MB of ${mb(cap)} MB`;
}
