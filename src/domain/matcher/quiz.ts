import { isOneOf } from "../guards";
import { err, ok, type Result } from "../result";

/**
 * The free-agent quiz (roadmap section 4, milestone 5; product-spec.md,
 * "Free agent"): five one-tap questions and an optional note, so it takes
 * well under two minutes. The answers feed the matcher; the scores are kept
 * beside them so admins can sort and compare at a glance.
 */

export const EXPERIENCE = [
  "new",
  "a_little",
  "some",
  "regular",
  "competitive",
] as const;
export const POSITIONS = ["pitcher", "catcher", "infield", "outfield"] as const;
export const AVAILABILITY = ["every_week", "most_weeks", "some_weeks"] as const;
export const VIBES = ["social", "both", "competitive"] as const;
export const CAPTAIN = ["yes", "help", "no"] as const;

export type Experience = (typeof EXPERIENCE)[number];
export type Position = (typeof POSITIONS)[number];
export type Availability = (typeof AVAILABILITY)[number];
export type Vibe = (typeof VIBES)[number];
export type CaptainAnswer = (typeof CAPTAIN)[number];

export type QuizAnswers = {
  version: 1;
  experience: Experience;
  /** Empty means "anywhere". */
  positions: Position[];
  availability: Availability;
  vibe: Vibe;
  captain: CaptainAnswer;
};

type Choice<T extends string> = { value: T; label: string };

/** The questions in order, with the words players see. */
export const QUESTIONS = {
  experience: {
    title: "How much kickball have you played?",
    choices: [
      { value: "new", label: "Not since recess" },
      { value: "a_little", label: "A game or two" },
      { value: "some", label: "A season or two" },
      { value: "regular", label: "I play most seasons" },
      { value: "competitive", label: "I've played competitively" },
    ],
  },
  positions: {
    title: "Where do you like to play?",
    hint: "Pick any. Skip it if you'll play anywhere.",
    choices: [
      { value: "pitcher", label: "Pitcher" },
      { value: "catcher", label: "Catcher" },
      { value: "infield", label: "Infield" },
      { value: "outfield", label: "Outfield" },
    ],
  },
  availability: {
    title: "How many game nights can you make?",
    choices: [
      { value: "every_week", label: "Every week" },
      { value: "most_weeks", label: "Most weeks" },
      { value: "some_weeks", label: "About half" },
    ],
  },
  vibe: {
    title: "What are you here for?",
    choices: [
      { value: "social", label: "New friends and a good time" },
      { value: "both", label: "Fun first, but I'd like to win some" },
      { value: "competitive", label: "Here to win it all" },
    ],
  },
  captain: {
    title: "Would you captain a team made of free agents?",
    choices: [
      { value: "yes", label: "Sure, I'll captain" },
      { value: "help", label: "I'd help a captain" },
      { value: "no", label: "I just want to play" },
    ],
  },
} as const satisfies {
  experience: { title: string; choices: readonly Choice<Experience>[] };
  positions: {
    title: string;
    hint: string;
    choices: readonly Choice<Position>[];
  };
  availability: { title: string; choices: readonly Choice<Availability>[] };
  vibe: { title: string; choices: readonly Choice<Vibe>[] };
  captain: { title: string; choices: readonly Choice<CaptainAnswer>[] };
};

export const NOTES_MAX = 200;

/** 1 (new) to 5 (has played competitively). */
export const SKILL_SCORE: Record<Experience, number> = {
  new: 1,
  a_little: 2,
  some: 3,
  regular: 4,
  competitive: 5,
};

/** 1 (social) to 5 (competitive), as data-model.md describes vibe_score. */
export const VIBE_SCORE: Record<Vibe, number> = {
  social: 1,
  both: 3,
  competitive: 5,
};

/** How many game nights each answer means, as a share of the season. */
export const TURNOUT: Record<Availability, number> = {
  every_week: 1,
  most_weeks: 0.75,
  some_weeks: 0.5,
};

export function vibeLabel(score: number): string {
  if (score <= 2) return "mostly social";
  if (score < 4) return "fun with a little competition";
  return "here to win";
}

export function labelOf<K extends keyof typeof QUESTIONS>(
  question: K,
  value: string,
): string {
  const found = (QUESTIONS[question].choices as readonly Choice<string>[]).find(
    (c) => c.value === value,
  );
  return found?.label ?? value;
}

export type QuizError =
  | "missing_experience"
  | "missing_availability"
  | "missing_vibe"
  | "missing_captain"
  | "notes_too_long";

export type ParsedQuiz = {
  answers: QuizAnswers;
  skillScore: number;
  vibeScore: number;
  wouldCaptain: boolean;
  notes: string | null;
};

/**
 * Reads the quiz from submitted fields. `positions` may repeat; unknown
 * values are dropped rather than refused, so a stale form still saves.
 */
export function parseQuiz(fields: {
  experience?: unknown;
  positions?: readonly unknown[];
  availability?: unknown;
  vibe?: unknown;
  captain?: unknown;
  notes?: unknown;
}): Result<ParsedQuiz, QuizError> {
  const pick = <const O extends readonly string[]>(v: unknown, options: O) =>
    isOneOf(options, v) ? v : null;
  const experience = pick(fields.experience, EXPERIENCE);
  if (!experience) return err("missing_experience");
  const availability = pick(fields.availability, AVAILABILITY);
  if (!availability) return err("missing_availability");
  const vibe = pick(fields.vibe, VIBES);
  if (!vibe) return err("missing_vibe");
  const captain = pick(fields.captain, CAPTAIN);
  if (!captain) return err("missing_captain");
  const notes =
    typeof fields.notes === "string"
      ? fields.notes.trim().replace(/\s+/g, " ")
      : "";
  if (notes.length > NOTES_MAX) return err("notes_too_long");
  const positions = POSITIONS.filter((p) =>
    (fields.positions ?? []).includes(p),
  );
  return ok({
    answers: { version: 1, experience, positions, availability, vibe, captain },
    skillScore: SKILL_SCORE[experience],
    vibeScore: VIBE_SCORE[vibe],
    wouldCaptain: captain === "yes",
    notes: notes || null,
  });
}

/** Reads stored answers back, tolerating rows written by older versions. */
export function readAnswers(raw: unknown): QuizAnswers | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const parsed = parseQuiz({
    experience: r.experience,
    positions: Array.isArray(r.positions) ? r.positions : [],
    availability: r.availability,
    vibe: r.vibe,
    captain: r.captain,
  });
  return parsed.ok ? parsed.value.answers : null;
}
