import { type LinkError, parseWebsite } from "@/domain/friends/friend-form";
import { err, ok, type Result } from "@/domain/result";

/**
 * The shirt makers directory: local custom jersey and t-shirt makers an
 * admin curates, shown to captains whose team wears its own shirts. Links
 * are checked like the friends directory's (https only, a public host).
 */

export const MAX_MAKER_NAME = 80;
export const MAX_MAKES = 200;
export const MAX_MINIMUM = 1000;

export type MakerFields = {
  name: string;
  url: string;
  makes: string;
  minimumOrder: number | null;
};

/** The form as typed, so a refused form comes back filled in. */
export type MakerForm = {
  name: string;
  url: string;
  makes: string;
  minimumOrder: string;
};

export const BLANK_MAKER_FORM: MakerForm = {
  name: "",
  url: "",
  makes: "",
  minimumOrder: "",
};

export type MakerFormError =
  | "name_missing"
  | "name_too_long"
  | "makes_missing"
  | "makes_too_long"
  | "bad_minimum"
  | LinkError;

export function parseMakerForm(
  form: MakerForm,
): Result<MakerFields, MakerFormError> {
  const name = form.name.trim();
  if (!name) return err("name_missing");
  if (name.length > MAX_MAKER_NAME) return err("name_too_long");
  const makes = form.makes.trim();
  if (!makes) return err("makes_missing");
  if (makes.length > MAX_MAKES) return err("makes_too_long");
  const rawMin = form.minimumOrder.trim();
  let minimumOrder: number | null = null;
  if (rawMin) {
    if (!/^\d{1,4}$/.test(rawMin)) return err("bad_minimum");
    minimumOrder = Number(rawMin);
    if (minimumOrder < 1 || minimumOrder > MAX_MINIMUM)
      return err("bad_minimum");
  }
  const url = parseWebsite(form.url);
  if (!url.ok) return url;
  return ok({ name, url: url.value, makes, minimumOrder });
}

export const MAKER_FORM_ERRORS: Record<MakerFormError, string> = {
  name_missing: "Give the maker a name.",
  name_too_long: `Keep the name to ${MAX_MAKER_NAME} characters.`,
  makes_missing: "Say what they make.",
  makes_too_long: `Keep that to ${MAX_MAKES} characters.`,
  bad_minimum: `Enter the fewest pieces they print, from 1 to ${MAX_MINIMUM}, or leave it empty.`,
  url_missing: "Add the maker's website.",
  url_not_https:
    "Use the site's https:// address. Links to plain http sites aren't allowed.",
  url_invalid:
    "That doesn't look like a public website address. Copy it from the browser's address bar.",
  url_too_long: "Keep the website address to 300 characters.",
};

/** "No minimum order" or "Minimum 12 pieces". */
export const minimumLine = (min: number | null) =>
  min === null
    ? "No minimum order"
    : `Minimum ${min} ${min === 1 ? "piece" : "pieces"}`;
