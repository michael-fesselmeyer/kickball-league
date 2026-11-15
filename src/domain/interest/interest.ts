import { err, ok, type Result } from "@/domain/result";

/**
 * Interest sign-ups (docs/data-model.md, section 2.8): before the league
 * books a permit for a new night, park or format, it asks who would come.
 * These rules read the admin's form and the public answer, and work out
 * whether an option has enough interest. Nothing here touches the database.
 */

export const NIGHTS = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
} as const;
export type Night = keyof typeof NIGHTS;

export const FORMATS = {
  social: "Social",
  competitive: "Competitive",
} as const;
export type Format = keyof typeof FORMATS;

/** A player's answer for one option. "No" is the absence of a choice. */
export const RESPONSES = { yes: "Yes", unsure: "Not sure" } as const;
export type Response = keyof typeof RESPONSES;

/** What an admin sets when opening a form. */
export const DEFAULT_TEAMS_NEEDED = 8;
export const MAX_TEAMS_NEEDED = 40;
export const DEFAULT_PLAYERS_PER_TEAM = 12;
export const MIN_PLAYERS_PER_TEAM = 6;
export const MAX_PLAYERS_PER_TEAM = 25;
export const MAX_TITLE = 80;
export const MAX_INTRO = 600;
export const MAX_PARK = 80;
export const MAX_NOTE = 500;
export const MAX_OPTIONS = 12;
export const MAX_EMAIL = 254;
/** The most friends one answer counts; the form's menu ends at this. */
export const MAX_FRIENDS = 10;

/** Months after a form closes that answerers' email addresses are kept. */
export const KEEP_EMAIL_MONTHS = 6;

/** The public form's limits: it sends no email, so these only stop floods. */
export const PUBLIC_LIMITS = {
  perEmail: { windowSeconds: 24 * 60 * 60, max: 5 },
  perNetwork: { windowSeconds: 24 * 60 * 60, max: 20 },
  everyone: { windowSeconds: 60 * 60, max: 300 },
} as const;

const isKey = <T extends object>(
  o: T,
  k: string,
): k is Extract<keyof T, string> => Object.hasOwn(o, k);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** An address as stored and compared: trimmed and lower case. */
export const normalizeEmail = (raw: string): string => raw.trim().toLowerCase();

// ---------------------------------------------------------------- the form

export type FormInput = {
  title: string;
  intro: string;
  teamsNeeded: number;
  playersPerTeam: number;
};

export type FormError = "title" | "intro" | "teams" | "players";

export const FORM_ERRORS: Record<FormError, string> = {
  title: `Give the form a title of up to ${MAX_TITLE} characters.`,
  intro: `Keep the introduction to ${MAX_INTRO} characters.`,
  teams: `Teams needed is a whole number from 1 to ${MAX_TEAMS_NEEDED}.`,
  players: `Players per team is a whole number from ${MIN_PLAYERS_PER_TEAM} to ${MAX_PLAYERS_PER_TEAM}.`,
};

/** A whole number inside [min, max]; anything else (blank, 3.5, "1e2") is null. */
function whole(raw: string, min: number, max: number): number | null {
  const text = raw.trim();
  if (!/^\d{1,3}$/.test(text)) return null;
  const n = Number(text);
  return n >= min && n <= max ? n : null;
}

/** Reads the admin's form. Blank numbers take the defaults. */
export function parseForm(
  raw: Record<"title" | "intro" | "teamsNeeded" | "playersPerTeam", string>,
): Result<FormInput, FormError> {
  const title = raw.title.trim();
  if (title.length < 1 || title.length > MAX_TITLE) return err("title");
  const intro = raw.intro.trim();
  if (intro.length > MAX_INTRO) return err("intro");
  const teamsNeeded =
    raw.teamsNeeded.trim() === ""
      ? DEFAULT_TEAMS_NEEDED
      : whole(raw.teamsNeeded, 1, MAX_TEAMS_NEEDED);
  if (teamsNeeded === null) return err("teams");
  const playersPerTeam =
    raw.playersPerTeam.trim() === ""
      ? DEFAULT_PLAYERS_PER_TEAM
      : whole(raw.playersPerTeam, MIN_PLAYERS_PER_TEAM, MAX_PLAYERS_PER_TEAM);
  if (playersPerTeam === null) return err("players");
  return ok({ title, intro, teamsNeeded, playersPerTeam });
}

// -------------------------------------------------------------- the options

export type OptionInput = {
  park: string | null;
  night: Night | null;
  format: Format | null;
};

export type OptionError = "park" | "night" | "format" | "empty";

export const OPTION_ERRORS: Record<OptionError, string> = {
  park: `Keep the park to ${MAX_PARK} characters.`,
  night: "Pick one of the seven nights, or leave it blank.",
  format: "Pick social or competitive, or leave it blank.",
  empty: "An option needs at least a night, a park or a format.",
};

/**
 * One option row. A blank row is not an error here: the caller skips rows
 * with nothing in them (`isBlankOption`) and reads the rest.
 */
export const isBlankOption = (
  raw: Record<"park" | "night" | "format", string>,
): boolean => raw.park.trim() === "" && raw.night === "" && raw.format === "";

export function parseOption(
  raw: Record<"park" | "night" | "format", string>,
): Result<OptionInput, OptionError> {
  const park = raw.park.trim().replace(/\s+/g, " ");
  if (park.length > MAX_PARK) return err("park");
  if (raw.night !== "" && !isKey(NIGHTS, raw.night)) return err("night");
  if (raw.format !== "" && !isKey(FORMATS, raw.format)) return err("format");
  const night = raw.night === "" ? null : raw.night;
  const format = raw.format === "" ? null : raw.format;
  if (park === "" && !night && !format) return err("empty");
  return ok({ park: park || null, night, format });
}

/** "Thursday nights · Social · Prospect Park": what the option is, in words. */
export function optionLabel(o: OptionInput): string {
  return [
    o.night ? `${NIGHTS[o.night]} nights` : null,
    o.format ? FORMATS[o.format] : null,
    o.park,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
}

/** Two options are the same when their parts match, ignoring case. */
export const optionKey = (o: OptionInput): string =>
  [o.night ?? "", o.format ?? "", (o.park ?? "").toLowerCase()].join("|");

// ----------------------------------------------------------- the public answer

export type AnswerInput = {
  email: string;
  /** Friends who might join besides the answerer; null means "not sure". */
  friends: number | null;
  /** Options marked yes or not sure; an option left out is a no. */
  choices: { optionId: string; response: Response }[];
};

export type AnswerError = "email" | "friends" | "choice";

export const ANSWER_ERRORS: Record<AnswerError, string> = {
  email: "Add the email address we should tell when an option goes ahead.",
  friends: "Pick how many friends might join, or Not sure.",
  choice: "One of those answers wasn't one we asked. Reload the page.",
};

/**
 * Reads a public answer. `optionIds` are the form's options; an answer for
 * any other id is refused, never ignored. Every field allows "Not sure":
 * `friends` is "" for it, and an option marked "unsure" is kept as such.
 * An answer with no options picked is valid.
 */
export function parseAnswer(
  raw: { email: string; friends: string; answers: Map<string, string> },
  optionIds: readonly string[],
): Result<AnswerInput, AnswerError> {
  const email = normalizeEmail(raw.email);
  if (email.length > MAX_EMAIL || !EMAIL.test(email)) return err("email");
  let friends: number | null = null;
  const f = raw.friends.trim();
  if (f !== "" && f !== "unsure") {
    friends = whole(f, 0, MAX_FRIENDS);
    if (friends === null) return err("friends");
  }
  const known = new Set(optionIds);
  const choices: AnswerInput["choices"] = [];
  for (const [optionId, response] of raw.answers) {
    if (!known.has(optionId)) return err("choice");
    if (response === "" || response === "no") continue;
    if (response !== "yes" && response !== "unsure") return err("choice");
    choices.push({ optionId, response });
  }
  return ok({ email, friends, choices });
}

// --------------------------------------------------------------- the totals

/** What the answers add up to for one option. */
export type OptionCounts = {
  /** Answers that said yes, and the people they stand for (themselves and friends). */
  yesAnswers: number;
  yesPeople: number;
  unsureAnswers: number;
  unsurePeople: number;
};

export const NO_COUNTS: OptionCounts = {
  yesAnswers: 0,
  yesPeople: 0,
  unsureAnswers: 0,
  unsurePeople: 0,
};

/** Whole teams a number of players fill. */
export const teamsFor = (people: number, playersPerTeam: number): number =>
  Math.floor(people / playersPerTeam);

export type Readiness = {
  /** Teams the "yes" answers fill. */
  teams: number;
  /** Teams if everyone who said "not sure" joined too. */
  teamsWithMaybes: number;
  /** The "enough to run" marker: the yes answers alone reach the target. */
  enough: boolean;
  /** Not enough yes answers, but the maybes would reach the target. */
  closeWithMaybes: boolean;
};

/**
 * Whether an option has enough interest at the form's current target. It is
 * worked out when it is read and never stored, so changing the target or
 * the team size after answers come in changes the marker at once.
 */
export function readiness(
  counts: OptionCounts,
  form: Pick<FormInput, "teamsNeeded" | "playersPerTeam">,
): Readiness {
  const teams = teamsFor(counts.yesPeople, form.playersPerTeam);
  const teamsWithMaybes = teamsFor(
    counts.yesPeople + counts.unsurePeople,
    form.playersPerTeam,
  );
  const enough = teams >= form.teamsNeeded;
  return {
    teams,
    teamsWithMaybes,
    enough,
    closeWithMaybes: !enough && teamsWithMaybes >= form.teamsNeeded,
  };
}

/** "4 of 8 teams" for the admin's table. */
export const progressLine = (r: Readiness, teamsNeeded: number): string =>
  `${r.teams} of ${teamsNeeded} ${teamsNeeded === 1 ? "team" : "teams"}`;

// -------------------------------------------------------- going ahead

/** The admin's note with the "going ahead" message. */
export function parseNote(raw: string): Result<string, "note"> {
  const note = raw.trim();
  return note.length <= MAX_NOTE ? ok(note) : err("note");
}
