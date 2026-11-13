import { err, ok, type Result } from "../result";

/**
 * Photos members upload for the league's socials (ADR 0035). Every limit
 * here keeps the stored copies inside the free database tier, which every
 * other table shares (docs/architecture.md, section 15).
 */

/**
 * The largest file the server takes. The upload page shrinks a phone photo
 * before sending it, so this only matters without JavaScript; it stays under
 * the host's 4.5 MB request limit and the Server Action limit in
 * next.config.ts.
 */
export const MAX_UPLOAD_BYTES = 4_000_000;
/** A decoded image larger than this is refused before it is resized. */
export const MAX_INPUT_PIXELS = 50_000_000;
/** The stored copy's longest edge: Instagram's largest photo is 1440 px. */
export const STORED_LONG_EDGE = 1440;
/** JPEG qualities tried in turn until the copy fits MAX_STORED_BYTES. */
export const STORED_QUALITIES = [82, 72, 62] as const;
/** The largest stored copy, after resizing. */
export const MAX_STORED_BYTES = 1024 * 1024;
/** Uploads one person may make in any 24 hours. */
export const DAILY_UPLOADS = 10;
/** Stored bytes for the whole league; rejected photos' bytes are deleted. */
export const LEAGUE_CAP_BYTES = 100 * 1024 * 1024;
export const CAPTION_MAX = 200;
export const NOTE_MAX = 500;

export type ImageType = "image/jpeg" | "image/png" | "image/webp";

export type UploadProblem =
  | "empty"
  | "too_large"
  | "video"
  | "heic"
  | "not_image"
  | "unreadable"
  | "too_big_after_resize"
  | "daily_cap"
  | "league_full"
  | "no_target"
  | "bad_target"
  | "no_consent"
  | "caption_too_long";

const startsWith = (bytes: Uint8Array, at: number, sig: readonly number[]) =>
  bytes.length >= at + sig.length && sig.every((b, i) => bytes[at + i] === b);

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** The ISO base media brands that hold a still HEIF photo, not a video. */
const HEIF_BRANDS = new Set([
  "heic",
  "heix",
  "heim",
  "heis",
  "hevc",
  "hevx",
  "mif1",
  "msf1",
]);

/**
 * What a file really is, from its first bytes; the name and the type the
 * browser sent are never trusted.
 */
export function sniff(
  bytes: Uint8Array,
): ImageType | "heic" | "video" | "other" {
  if (startsWith(bytes, 0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return "image/png";
  if (
    startsWith(bytes, 0, ascii("RIFF")) &&
    startsWith(bytes, 8, ascii("WEBP"))
  )
    return "image/webp";
  // MP4, MOV, 3GP and HEIF all start with an `ftyp` box naming a brand.
  if (startsWith(bytes, 4, ascii("ftyp")) && bytes.length >= 12) {
    const brand = String.fromCharCode(...bytes.subarray(8, 12));
    if (HEIF_BRANDS.has(brand)) return "heic";
    if (brand === "avif" || brand === "avis") return "other";
    return "video";
  }
  // WebM and Matroska (EBML), and AVI.
  if (startsWith(bytes, 0, [0x1a, 0x45, 0xdf, 0xa3])) return "video";
  if (
    startsWith(bytes, 0, ascii("RIFF")) &&
    startsWith(bytes, 8, ascii("AVI "))
  )
    return "video";
  return "other";
}

/** The checks made on the raw file, before it is decoded. */
export function checkFile(bytes: Uint8Array): Result<ImageType, UploadProblem> {
  if (bytes.length === 0) return err("empty");
  if (bytes.length > MAX_UPLOAD_BYTES) return err("too_large");
  const kind = sniff(bytes);
  if (kind === "video") return err("video");
  if (kind === "heic") return err("heic");
  if (kind === "other") return err("not_image");
  return ok(kind);
}

/** Whether one more upload stays within the person's daily limit. */
export const underDailyLimit = (uploadsInLastDay: number) =>
  uploadsInLastDay < DAILY_UPLOADS;

/** Whether a stored copy of `size` bytes fits in what the league has left. */
export const fitsLeagueCap = (
  usedBytes: number,
  size: number,
  cap = LEAGUE_CAP_BYTES,
) => usedBytes + size <= cap;

/**
 * Uploads close once the league's storage is this full, so a photo already
 * on its way can never push it over and the page can say so up front.
 */
export const leagueStorageFull = (usedBytes: number) =>
  usedBytes + MAX_STORED_BYTES > LEAGUE_CAP_BYTES;

const mb = (bytes: number) => Math.round(bytes / (1024 * 1024));

/** What the uploader is told, in words they can act on. */
export const UPLOAD_MESSAGES: Readonly<Record<UploadProblem, string>> = {
  empty: "Choose a photo to upload.",
  too_large: `That file is over ${MAX_UPLOAD_BYTES / 1_000_000} MB. Try a smaller photo, or a screenshot of it.`,
  video:
    "Videos can't be uploaded here, only photos. Send the league a still from it instead.",
  heic: "That photo is in the iPhone's HEIC format. Upload it from your phone's browser, which converts it, or save it as a JPEG first.",
  not_image: "That file isn't a photo. Upload a JPEG, PNG or WebP image.",
  unreadable: "That photo couldn't be read. Try taking a screenshot of it.",
  too_big_after_resize:
    "That photo is too detailed to store even after shrinking. Try another one.",
  daily_cap: `You've uploaded ${DAILY_UPLOADS} photos in the last day, the most the league takes. Try again tomorrow.`,
  league_full: `The league's photo storage is full (${mb(LEAGUE_CAP_BYTES)} MB). Uploads open again once the league clears out older photos.`,
  no_target: "Choose a game day, an event or a team for the photo.",
  bad_target:
    "That game day, event or team isn't one you can add photos to. Pick another.",
  no_consent:
    "Tick the box to say the league may repost the photo on its socials.",
  caption_too_long: `Keep the caption to ${CAPTION_MAX} characters.`,
};
