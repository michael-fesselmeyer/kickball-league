import { err, ok, type Result } from "@/domain/result";

/**
 * Logo storage limits for the friends directory. Logos are kept in Postgres
 * beside the Instagram photos (ADR 0023), so they must stay small on the
 * free database tier: one WebP copy each, and a cap on all of them.
 */

/** The largest upload accepted: a logo needs no more, and it uploads fast on a phone. */
export const MAX_LOGO_UPLOAD_BYTES = 800 * 1024;
/** The stored copy fits inside this square. The page shows it at 64 px. */
export const LOGO_BOX = 192;
/** A stored copy may not be larger than this (checked in the database too). */
export const MAX_STORED_LOGO_BYTES = 100 * 1024;
/** Every stored logo together. */
export const MAX_TOTAL_LOGO_BYTES = 5 * 1024 * 1024;

export const LOGO_UPLOAD_TYPES = ["image/png", "image/jpeg", "image/webp"];

export type LogoError =
  "logo_too_large" | "logo_wrong_type" | "logo_unreadable" | "logo_store_full";

/** Checks an upload before it is read: its size and declared type. */
export function checkLogoUpload(file: {
  size: number;
  type: string;
}): Result<null, LogoError> {
  if (file.size > MAX_LOGO_UPLOAD_BYTES) return err("logo_too_large");
  if (!LOGO_UPLOAD_TYPES.includes(file.type)) return err("logo_wrong_type");
  return ok(null);
}

/**
 * Whether a new copy fits: everything stored now, minus the copy it
 * replaces, plus the new one, stays within the total cap.
 */
export function logoFits(options: {
  storedBytes: number;
  replacedBytes: number;
  newBytes: number;
}): boolean {
  return (
    options.newBytes <= MAX_STORED_LOGO_BYTES &&
    options.storedBytes - options.replacedBytes + options.newBytes <=
      MAX_TOTAL_LOGO_BYTES
  );
}

export const LOGO_ERRORS: Record<LogoError, string> = {
  logo_too_large: "Use a logo file under 800 KB.",
  logo_wrong_type: "Use a PNG, JPEG or WebP image for the logo.",
  logo_unreadable: "That file couldn't be read as an image. Try another.",
  logo_store_full:
    "There's no room for another logo. Remove a logo you no longer need, then try again.",
};
