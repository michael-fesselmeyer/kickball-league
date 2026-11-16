import { z } from "zod";
import { isBestOf } from "@/domain/sports/dodgeball";
import { DEFAULT_LEAGUE_SEGMENT, isLeagueSlug } from "./paths";

/** A person's role in one league (ADR 0048). */
export type LeagueRole = "player" | "admin" | "owner";

export const LEAGUE_ROLES: readonly LeagueRole[] = ["player", "admin", "owner"];

/** Sports the operator can pick; the label is what pages say. */
export const SPORTS = [
  { value: "kickball", label: "Kickball" },
  { value: "football", label: "Flag football" },
  { value: "softball", label: "Softball" },
  { value: "soccer", label: "Soccer" },
  { value: "volleyball", label: "Volleyball" },
  { value: "dodgeball", label: "Dodgeball" },
  { value: "other", label: "Other" },
] as const;

export type Sport = (typeof SPORTS)[number]["value"];

export const sportLabel = (sport: string): string =>
  SPORTS.find((s) => s.value === sport)?.label ?? "Other";

/** Paths under the site that a league slug must not shadow. */
const RESERVED_SLUGS = new Set([DEFAULT_LEAGUE_SEGMENT, "app", "api", "l"]);

/** Whether the site itself uses this address, so no league may. */
export const isReservedLeagueSlug = (slug: string): boolean =>
  RESERVED_SLUGS.has(slug);

const COLOR = /^#[0-9A-Fa-f]{6}$/;

const isTimeZone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

const optionalNumber = (min: number, max: number, message: string) =>
  z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .refine(
      (n) => n === null || (Number.isInteger(n) && n >= min && n <= max),
      { error: message },
    );

export const newLeagueSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, { error: "Give the league a name." })
    .max(80, { error: "Keep the name under 80 characters." }),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .refine(isLeagueSlug, {
      error:
        "Use lowercase letters, digits and single hyphens, up to 40 characters.",
    })
    .refine((s) => !RESERVED_SLUGS.has(s), {
      error: "That address is taken by the site itself.",
    }),
  sport: z.enum(SPORTS.map((s) => s.value) as [Sport, ...Sport[]], {
    error: "Pick a sport.",
  }),
  timeZone: z.string().trim().refine(isTimeZone, {
    error: "Use a time zone like America/New_York.",
  }),
  minimumAge: z.coerce
    .number({ error: "Enter an age." })
    .int({ error: "Enter a whole number." })
    .min(18, { error: "The minimum age is 18 or more." })
    .max(99, { error: "The minimum age is 99 or less." }),
  primaryColor: z
    .string()
    .trim()
    .regex(COLOR, { error: "Use a color like #1F3A8A." }),
  secondaryColor: z
    .string()
    .trim()
    .regex(COLOR, { error: "Use a color like #F5B301." }),
  ruleSetName: z
    .string()
    .trim()
    .min(2, { error: "Name the rule set, for example Standard." })
    .max(60, { error: "Keep the rule set's name under 60 characters." }),
  innings: optionalNumber(1, 15, "Innings are 1 to 15, or leave it empty."),
  /** Sets in a match, for a sport played in sets (ADR 0087). */
  bestOf: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === undefined || v === "" ? null : Number(v)))
    .refine((n) => n === null || isBestOf(n), {
      error:
        "Sets in a match are an odd number from 1 to 9, or leave it empty.",
    }),
  timeLimitMinutes: optionalNumber(
    10,
    240,
    "A time limit is 10 to 240 minutes, or leave it empty.",
  ),
});

export type NewLeagueInput = {
  name: string;
  slug: string;
  sport: Sport;
  timeZone: string;
  minimumAge: number;
  primaryColor: string;
  secondaryColor: string;
  ruleSet: {
    name: string;
    innings: number | null;
    /** Sets in a match; set only when given (ADR 0087). */
    bestOf?: number;
    timeLimitMinutes: number | null;
  };
};

export type NewLeagueFields = keyof z.infer<typeof newLeagueSchema>;

/** The operator's new-league form, checked; errors are per field. */
export function parseNewLeague(
  form: Readonly<Record<string, string>>,
):
  | { ok: true; value: NewLeagueInput }
  | { ok: false; errors: Partial<Record<NewLeagueFields, string>> } {
  const parsed = newLeagueSchema.safeParse(form);
  if (!parsed.success) {
    const errors: Partial<Record<NewLeagueFields, string>> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as NewLeagueFields;
      errors[field] ??= issue.message;
    }
    return { ok: false, errors };
  }
  const v = parsed.data;
  return {
    ok: true,
    value: {
      name: v.name,
      slug: v.slug,
      sport: v.sport,
      timeZone: v.timeZone,
      minimumAge: v.minimumAge,
      primaryColor: v.primaryColor.toUpperCase(),
      secondaryColor: v.secondaryColor.toUpperCase(),
      ruleSet: {
        name: v.ruleSetName,
        innings: v.innings,
        ...(v.bestOf !== null ? { bestOf: v.bestOf } : {}),
        timeLimitMinutes: v.timeLimitMinutes,
      },
    },
  };
}
