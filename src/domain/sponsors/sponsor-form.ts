import { err, ok, type Result } from "@/domain/result";
import { slugify } from "@/domain/slug";

/** Reads the sponsor details form, for adding a sponsor or editing one. */

export const SPONSOR_KINDS = ["bar", "restaurant", "brand", "other"] as const;
export type SponsorKindValue = (typeof SPONSOR_KINDS)[number];

export const SPONSOR_KIND_LABELS: Record<SponsorKindValue, string> = {
  bar: "Bar",
  restaurant: "Restaurant",
  brand: "Brand",
  other: "Other",
};

export type SponsorFields = {
  name: string;
  slug: string;
  kind: SponsorKindValue;
  isHomeBar: boolean;
  blurb: string | null;
  address: string | null;
  url: string | null;
};

export type SponsorFormError =
  | "name_missing"
  | "name_too_long"
  | "bad_slug"
  | "blurb_too_long"
  | "address_too_long"
  | "bad_url";

const isKind = (value: string): value is SponsorKindValue =>
  (SPONSOR_KINDS as readonly string[]).includes(value);

/**
 * A website without a scheme gets https://; one on plain http is refused,
 * since the page links it.
 */
function website(raw: string): string | null | undefined {
  const text = raw.trim();
  if (!text) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text)
    ? text
    : `https://${text}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "https:" || !url.hostname.includes("."))
      return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export function parseSponsorForm(fields: {
  name: string;
  slug: string;
  kind: string;
  homeBar: boolean;
  blurb: string;
  address: string;
  url: string;
}): Result<SponsorFields, SponsorFormError> {
  const name = fields.name.trim();
  if (!name) return err("name_missing");
  if (name.length > 80) return err("name_too_long");
  const slug = slugify(fields.slug.trim() || name);
  if (!slug || slug.length > 60) return err("bad_slug");
  const blurb = fields.blurb.trim();
  if (blurb.length > 500) return err("blurb_too_long");
  const address = fields.address.trim();
  if (address.length > 200) return err("address_too_long");
  const url = website(fields.url);
  if (url === undefined) return err("bad_url");
  return ok({
    name,
    slug,
    kind: isKind(fields.kind) ? fields.kind : "bar",
    isHomeBar: fields.homeBar,
    blurb: blurb || null,
    address: address || null,
    url,
  });
}

export const SPONSOR_FORM_ERRORS: Record<SponsorFormError, string> = {
  name_missing: "Give the sponsor a name.",
  name_too_long: "Keep the name to 80 characters.",
  bad_slug: "Use letters or numbers in the page address.",
  blurb_too_long: "Keep the description to 500 characters.",
  address_too_long: "Keep the address to 200 characters.",
  bad_url: "Use the full website address, starting with https://.",
};
