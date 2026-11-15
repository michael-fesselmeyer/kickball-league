import { err, ok, type Result } from "@/domain/result";

/** Categories the public contact form offers. */
export const PUBLIC_CATEGORIES = {
  question: "A question",
  field_problem: "A problem at the field",
  park_rules: "Something about how the park is used",
  other: "Something else",
} as const;

/** Categories a signed-in player can raise. */
export const PLAYER_CATEGORIES = {
  play: "How a game was played",
  safety: "Safety",
  treatment: "How I was treated",
  park_rules: "How the park is used",
  other: "Something else",
} as const;

export const CATEGORY_LABELS = {
  ...PUBLIC_CATEGORIES,
  ...PLAYER_CATEGORIES,
} as const;

export type ConcernCategory = keyof typeof CATEGORY_LABELS;

/** What a park-rules concern is about. */
export const PARK_RULES = {
  outside_hours: "Play outside permit hours",
  alcohol_glass: "Alcohol or glass at the park",
  amplified_sound: "Amplified sound",
  litter: "Litter",
  field_damage: "Field damage",
  shared_space: "Sharing the space",
} as const;

export type ParkRule = keyof typeof PARK_RULES;

export const MAX_BODY = 2000;
export const MAX_PLACE = 80;
export const MAX_EMAIL = 254;

/** The public form: at most this many messages per address in a day, and per network. */
export const PUBLIC_LIMITS = {
  perEmail: { windowSeconds: 24 * 60 * 60, max: 3 },
  perNetwork: { windowSeconds: 24 * 60 * 60, max: 10 },
  /** Everyone together, so a flood cannot use the day's free email quota. */
  everyone: { windowSeconds: 60 * 60, max: 60 },
} as const;

const isKey = <T extends object>(
  o: T,
  k: string,
): k is Extract<keyof T, string> => Object.hasOwn(o, k);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ConcernInput = {
  category: ConcernCategory;
  parkRule: ParkRule | null;
  body: string;
  occurredOn: string | null;
  place: string | null;
  replyEmail: string | null;
};

export type ConcernError =
  "category" | "park_rule" | "body" | "date" | "place" | "email";

/** Reads the public form. The honeypot field is checked by the caller. */
export function parseConcern(
  raw: Record<
    "category" | "parkRule" | "body" | "occurredOn" | "place" | "replyEmail",
    string
  >,
  allowed: readonly string[],
  today: string,
): Result<ConcernInput, ConcernError> {
  const category = raw.category.trim();
  if (!isKey(CATEGORY_LABELS, category) || !allowed.includes(category))
    return err("category");
  const rule = raw.parkRule.trim();
  if (category === "park_rules" && rule !== "" && !isKey(PARK_RULES, rule))
    return err("park_rule");
  const body = raw.body.trim();
  if (body.length < 1 || body.length > MAX_BODY) return err("body");
  const occurredOn = raw.occurredOn.trim();
  if (
    occurredOn !== "" &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(occurredOn) ||
      Number.isNaN(Date.parse(`${occurredOn}T00:00:00Z`)) ||
      occurredOn > today)
  )
    return err("date");
  const place = raw.place.trim();
  if (place.length > MAX_PLACE) return err("place");
  const email = raw.replyEmail.trim().toLowerCase();
  if (email !== "" && (email.length > MAX_EMAIL || !EMAIL.test(email)))
    return err("email");
  return ok({
    category,
    parkRule:
      category === "park_rules" && rule !== "" && isKey(PARK_RULES, rule)
        ? rule
        : null,
    body,
    occurredOn: occurredOn || null,
    place: place || null,
    replyEmail: email || null,
  });
}

export const CONCERN_ERRORS: Record<ConcernError, string> = {
  category: "Pick what this is about.",
  park_rule: "Pick one of the park rules, or leave it blank.",
  body: `Tell us what happened, in up to ${MAX_BODY} characters.`,
  date: "Use a date that is today or earlier.",
  place: `Keep the place to ${MAX_PLACE} characters.`,
  email: "That email address doesn't look right.",
};

/** Reads a reply, note or closing note. */
export function parseText(raw: string, max: number): Result<string, "text"> {
  const text = raw.trim();
  return text.length >= 1 && text.length <= max ? ok(text) : err("text");
}

/** The months after closing that a sender's address is kept. */
export const KEEP_EMAIL_MONTHS = 12;
