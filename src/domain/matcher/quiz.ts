import { isOneOf } from "../guards";
import { err, ok, type Result } from "../result";

/**
 * The free-agent quiz (roadmap section 4, milestone 5; product-spec.md,
 * "Free agent"): a quick self-assessment of five one-tap questions and an
 * optional note. Players rate their own kicking, fielding and running, say
 * how competitive they are and how many game nights they can make. The
 * answers feed the matcher; the scores are kept beside them so admins can
 * sort and compare at a glance.
 *
 * Answers saved by the first version of the quiz (experience, positions and
 * captaining) still read back, so a player who took it keeps their match.
 */

/** How a player rates one of their skills. */
export const RATINGS = ["learning", "solid", "strong"] as const;
/** The skills a player rates, in the order the quiz asks. */
export const SKILLS = ["kicking", "fielding", "running"] as const;
export const AVAILABILITY = ["every_week", "most_weeks", "some_weeks"] as const;
export const VIBES = ["social", "both", "competitive"] as const;

export type Rating = (typeof RATINGS)[number];
export type Skill = (typeof SKILLS)[number];
export type Availability = (typeof AVAILABILITY)[number];
export type Vibe = (typeof VIBES)[number];

/** The quiz's answers, as saved now. */
export type QuizAnswers = {
  version: 2;
  kicking: Rating;
  fielding: Rating;
  running: Rating;
  vibe: Vibe;
  availability: Availability;
};

/** The first version's answers, still stored for players who took it. */
export const EXPERIENCE = [
  "new",
  "a_little",
  "some",
  "regular",
  "competitive",
] as const;
export const POSITIONS = ["pitcher", "catcher", "infield", "outfield"] as const;
export const CAPTAIN = ["yes", "help", "no"] as const;
export type Experience = (typeof EXPERIENCE)[number];
export type Position = (typeof POSITIONS)[number];
export type CaptainAnswer = (typeof CAPTAIN)[number];

export type LegacyQuizAnswers = {
  version: 1;
  experience: Experience;
  /** Empty means "anywhere". */
  positions: Position[];
  availability: Availability;
  vibe: Vibe;
  captain: CaptainAnswer;
};

/** Whatever a stored row holds: this version's answers or the first's. */
export type StoredQuizAnswers = QuizAnswers | LegacyQuizAnswers;

type Choice<T extends string> = { value: T; label: string };

const RATING_CHOICES: readonly Choice<Rating>[] = [
  { value: "learning", label: "Still learning" },
  { value: "solid", label: "Solid" },
  { value: "strong", label: "A strength" },
];

/** The questions in order, with the words players see. */
export const QUESTIONS = {
  kicking: { title: "How's your kicking?", choices: RATING_CHOICES },
  fielding: { title: "How's your fielding?", choices: RATING_CHOICES },
  running: { title: "How's your running?", choices: RATING_CHOICES },
  vibe: {
    title: "Competitive, or here for fun?",
    choices: [
      { value: "social", label: "Here for fun" },
      { value: "both", label: "Fun, but I like to win" },
      { value: "competitive", label: "Competitive" },
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
} as const satisfies Record<
  Skill,
  { title: string; choices: readonly Choice<Rating>[] }
> & {
  vibe: { title: string; choices: readonly Choice<Vibe>[] };
  availability: { title: string; choices: readonly Choice<Availability>[] };
};

/** The first version's words, for answers saved before the self-rating. */
const LEGACY_LABELS: Record<
  "experience" | "positions" | "captain",
  Record<string, string>
> = {
  experience: {
    new: "Not since recess",
    a_little: "A game or two",
    some: "A season or two",
    regular: "Plays most seasons",
    competitive: "Has played competitively",
  },
  positions: {
    pitcher: "Pitcher",
    catcher: "Catcher",
    infield: "Infield",
    outfield: "Outfield",
  },
  captain: {
    yes: "Will captain",
    help: "Would help a captain",
    no: "Just wants to play",
  },
};

export const NOTES_MAX = 200;

/** A self-rating as a point on the 1 to 5 skill scale. */
export const RATING_SCORE: Record<Rating, number> = {
  learning: 1,
  solid: 3,
  strong: 5,
};

/** The first version's experience on the same 1 to 5 scale. */
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

/** The skill score: the three self-ratings averaged, 1 to 5. */
export function skillScore(answers: Pick<QuizAnswers, Skill>): number {
  const total = SKILLS.reduce((sum, s) => sum + RATING_SCORE[answers[s]], 0);
  return Math.round(total / SKILLS.length);
}

export function vibeLabel(score: number): string {
  if (score <= 2) return "mostly social";
  if (score < 4) return "fun with a little competition";
  return "here to win";
}

/** An answer in the words players see, this version's or the first's. */
export function labelOf(
  question: keyof typeof QUESTIONS | keyof typeof LEGACY_LABELS,
  value: string,
): string {
  if (question in LEGACY_LABELS)
    return (
      LEGACY_LABELS[question as keyof typeof LEGACY_LABELS][value] ?? value
    );
  const found = (
    QUESTIONS[question as keyof typeof QUESTIONS]
      .choices as readonly Choice<string>[]
  ).find((c) => c.value === value);
  return found?.label ?? value;
}

/** How a player rates themselves, in one line for admins. */
export function selfRating(answers: StoredQuizAnswers): string {
  if (answers.version === 1) {
    const played = labelOf("experience", answers.experience);
    const positions = answers.positions.map((p) => labelOf("positions", p));
    return positions.length > 0
      ? `${played} (${positions.join(", ")})`
      : played;
  }
  return SKILLS.map(
    (s) => `${s[0]?.toUpperCase()}${s.slice(1)}: ${labelOf(s, answers[s])}`,
  ).join(" · ");
}

export type QuizError =
  | "missing_kicking"
  | "missing_fielding"
  | "missing_running"
  | "missing_vibe"
  | "missing_availability"
  | "notes_too_long";

export type ParsedQuiz = {
  answers: QuizAnswers;
  skillScore: number;
  vibeScore: number;
  wouldCaptain: boolean;
  notes: string | null;
};

const pick = <const O extends readonly string[]>(v: unknown, options: O) =>
  isOneOf(options, v) ? v : null;

/** Reads the quiz from submitted fields. */
export function parseQuiz(fields: {
  kicking?: unknown;
  fielding?: unknown;
  running?: unknown;
  vibe?: unknown;
  availability?: unknown;
  notes?: unknown;
}): Result<ParsedQuiz, QuizError> {
  const kicking = pick(fields.kicking, RATINGS);
  if (!kicking) return err("missing_kicking");
  const fielding = pick(fields.fielding, RATINGS);
  if (!fielding) return err("missing_fielding");
  const running = pick(fields.running, RATINGS);
  if (!running) return err("missing_running");
  const vibe = pick(fields.vibe, VIBES);
  if (!vibe) return err("missing_vibe");
  const availability = pick(fields.availability, AVAILABILITY);
  if (!availability) return err("missing_availability");
  const notes =
    typeof fields.notes === "string"
      ? fields.notes.trim().replace(/\s+/g, " ")
      : "";
  if (notes.length > NOTES_MAX) return err("notes_too_long");
  const answers: QuizAnswers = {
    version: 2,
    kicking,
    fielding,
    running,
    vibe,
    availability,
  };
  return ok({
    answers,
    skillScore: skillScore(answers),
    vibeScore: VIBE_SCORE[vibe],
    // Captains come from the admin's pick now; the quiz no longer asks.
    wouldCaptain: false,
    notes: notes || null,
  });
}

/** The first version's answers, or null if they aren't whole. */
function readLegacy(r: Record<string, unknown>): LegacyQuizAnswers | null {
  const experience = pick(r.experience, EXPERIENCE);
  const availability = pick(r.availability, AVAILABILITY);
  const vibe = pick(r.vibe, VIBES);
  const captain = pick(r.captain, CAPTAIN);
  if (!experience || !availability || !vibe || !captain) return null;
  const raw = Array.isArray(r.positions) ? (r.positions as unknown[]) : [];
  const positions = POSITIONS.filter((p) => raw.includes(p));
  return { version: 1, experience, positions, availability, vibe, captain };
}

/** Reads stored answers back, from either version of the quiz. */
export function readAnswers(raw: unknown): StoredQuizAnswers | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.version === 2) {
    const parsed = parseQuiz(r);
    return parsed.ok ? parsed.value.answers : null;
  }
  return readLegacy(r);
}

/** What the matcher reads from stored answers. */
export function matcherView(answers: StoredQuizAnswers | null): {
  availability: Availability | null;
  positions: readonly Position[];
  captain: CaptainAnswer | null;
} {
  if (!answers) return { availability: null, positions: [], captain: null };
  return answers.version === 1
    ? {
        availability: answers.availability,
        positions: answers.positions,
        captain: answers.captain,
      }
    : { availability: answers.availability, positions: [], captain: null };
}
