import { isOneOf } from "@/domain/guards";
import { err, ok, type Result } from "@/domain/result";

/**
 * The "friends of the league" directory (docs/product-spec.md, section 6):
 * other local leagues our players also play in, linked from a public page,
 * with a link back to us from theirs. This reads the admin's form.
 */

/** What a friend league plays, in the order the public page groups them. */
export const ACTIVITIES = [
  "softball",
  "soccer",
  "volleyball",
  "basketball",
  "dodgeball",
  "flag_football",
  "ultimate",
  "bowling",
  "pool",
  "darts",
  "cornhole",
  "tabletop",
  "trivia",
  "running",
  "other",
] as const;
export type Activity = (typeof ACTIVITIES)[number];

export const ACTIVITY_LABELS: Record<Activity, string> = {
  softball: "Softball",
  soccer: "Soccer",
  volleyball: "Volleyball",
  basketball: "Basketball",
  dodgeball: "Dodgeball",
  flag_football: "Flag football",
  ultimate: "Ultimate",
  bowling: "Bowling",
  pool: "Pool",
  darts: "Darts",
  cornhole: "Cornhole",
  tabletop: "Tabletop games",
  trivia: "Trivia",
  running: "Running",
  other: "Other leagues",
};

/** The schema.org sport for each activity; games and quizzes have none. */
export const ACTIVITY_SPORT: Record<Activity, string | null> = {
  softball: "Softball",
  soccer: "Soccer",
  volleyball: "Volleyball",
  basketball: "Basketball",
  dodgeball: "Dodgeball",
  flag_football: "Flag football",
  ultimate: "Ultimate",
  bowling: "Bowling",
  pool: "Pool",
  darts: "Darts",
  cornhole: "Cornhole",
  tabletop: null,
  trivia: null,
  running: "Running",
  other: null,
};

export const MAX_NAME_LENGTH = 80;
export const MAX_AREA_LENGTH = 80;
export const MAX_DESCRIPTION_LENGTH = 280;
export const MAX_URL_LENGTH = 300;

export type FriendFields = {
  name: string;
  activity: Activity;
  area: string | null;
  description: string | null;
  url: string;
  linksBack: boolean;
};

/** The form as typed, so a refused form comes back filled in. */
export type FriendForm = {
  name: string;
  activity: string;
  area: string;
  description: string;
  url: string;
  linksBack: boolean;
};

export const BLANK_FRIEND_FORM: FriendForm = {
  name: "",
  activity: "softball",
  area: "",
  description: "",
  url: "",
  linksBack: false,
};

export type LinkError =
  "url_missing" | "url_not_https" | "url_invalid" | "url_too_long";

export type FriendFormError =
  | "name_missing"
  | "name_too_long"
  | "bad_activity"
  | "area_too_long"
  | "description_too_long"
  | LinkError;

export const isActivity = (value: string): value is Activity =>
  isOneOf(ACTIVITIES, value);

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * A partner league's website, as the public page will link it: https only,
 * on a public host name, with no user name, password or port. Text typed
 * without a scheme gets https://. Plain http is refused rather than
 * upgraded, since nobody has checked the site answers on https.
 */
export function parseWebsite(raw: string): Result<string, LinkError> {
  const text = raw.trim();
  if (!text) return err("url_missing");
  if (text.length > MAX_URL_LENGTH) return err("url_too_long");
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(text);
  if (hasScheme && !/^https:\/\//i.test(text)) {
    return /^http:/i.test(text) ? err("url_not_https") : err("url_invalid");
  }
  let url: URL;
  try {
    url = new URL(hasScheme ? text : `https://${text}`);
  } catch {
    return err("url_invalid");
  }
  const host = url.hostname;
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !host.includes(".") ||
    host.endsWith(".") ||
    host.startsWith("[") ||
    IPV4.test(host) ||
    /\s/.test(text)
  )
    return err("url_invalid");
  const normalized = url.toString();
  if (normalized.length > MAX_URL_LENGTH) return err("url_too_long");
  return ok(normalized);
}

export function parseFriendForm(
  form: FriendForm,
): Result<FriendFields, FriendFormError> {
  const name = form.name.trim();
  if (!name) return err("name_missing");
  if (name.length > MAX_NAME_LENGTH) return err("name_too_long");
  if (!isActivity(form.activity)) return err("bad_activity");
  const area = form.area.trim();
  if (area.length > MAX_AREA_LENGTH) return err("area_too_long");
  const description = form.description.trim();
  if (description.length > MAX_DESCRIPTION_LENGTH)
    return err("description_too_long");
  const url = parseWebsite(form.url);
  if (!url.ok) return url;
  return ok({
    name,
    activity: form.activity,
    area: area || null,
    description: description || null,
    url: url.value,
    linksBack: form.linksBack,
  });
}

export const FRIEND_FORM_ERRORS: Record<FriendFormError, string> = {
  name_missing: "Give the league a name.",
  name_too_long: `Keep the name to ${MAX_NAME_LENGTH} characters.`,
  bad_activity: "Pick what the league plays.",
  area_too_long: `Keep the neighborhood or park to ${MAX_AREA_LENGTH} characters.`,
  description_too_long: `Keep the description to ${MAX_DESCRIPTION_LENGTH} characters.`,
  url_missing: "Add the league's website.",
  url_not_https:
    "Use the site's https:// address. Links to plain http sites aren't allowed.",
  url_invalid:
    "That doesn't look like a public website address. Copy it from the browser's address bar.",
  url_too_long: `Keep the website address to ${MAX_URL_LENGTH} characters.`,
};

/** A link's host without "www.", to show beside it: "example.test". */
export function displayHost(url: string): string {
  return new URL(url).hostname.replace(/^www\./, "");
}

/** Groups entries by activity, in ACTIVITIES order, each group by name. */
export function groupByActivity<T extends { activity: Activity; name: string }>(
  entries: readonly T[],
): { activity: Activity; label: string; entries: T[] }[] {
  return ACTIVITIES.flatMap((activity) => {
    const inGroup = entries
      .filter((e) => e.activity === activity)
      .sort((a, b) => a.name.localeCompare(b.name));
    return inGroup.length
      ? [{ activity, label: ACTIVITY_LABELS[activity], entries: inGroup }]
      : [];
  });
}
