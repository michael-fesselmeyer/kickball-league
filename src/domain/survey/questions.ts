import { err, ok, type Result } from "@/domain/result";

/**
 * The end-of-season survey: a fixed set of five questions, asked once per
 * player who was on a roster that season. Results are totals and the
 * written answers as separate anonymous lists: nothing here, and nothing
 * stored, ties an answer to the person who gave it. Pure: no clock and no
 * database.
 */

export const RATINGS = [1, 2, 3, 4, 5] as const;
export type Rating = (typeof RATINGS)[number];

export const RATING_LABELS: Readonly<Record<Rating, string>> = {
  1: "1, not great",
  2: "2",
  3: "3, fine",
  4: "4",
  5: "5, loved it",
};

export const RETURN_OPTIONS = ["yes", "maybe", "no"] as const;
export type WouldReturn = (typeof RETURN_OPTIONS)[number];

export const RETURN_LABELS: Readonly<Record<WouldReturn, string>> = {
  yes: "Yes",
  maybe: "Maybe",
  no: "No",
};

/** The questions, as the form and the results show them. */
export const QUESTIONS = {
  rating: "Overall, how was the season?",
  wouldReturn: "Would you play again next season?",
  bestPart: "What was the best part?",
  oneChange: "One thing you'd change?",
  comment: "Anything else?",
} as const;

export const MAX_SHORT_ANSWER = 500;
export const MAX_COMMENT = 1000;

export type AnswerInput = {
  rating: Rating;
  wouldReturn: WouldReturn;
  bestPart: string | null;
  oneChange: string | null;
  comment: string | null;
};

export type AnswerForm = {
  rating: string;
  wouldReturn: string;
  bestPart: string;
  oneChange: string;
  comment: string;
};

export type AnswerFormError = "rating" | "would_return" | "too_long";

export const ANSWER_FORM_ERRORS: Readonly<Record<AnswerFormError, string>> = {
  rating: "Pick a rating from 1 to 5.",
  would_return: "Say whether you'd play again.",
  too_long: `Keep each answer under ${MAX_SHORT_ANSWER} characters, and the last one under ${MAX_COMMENT}.`,
};

const text = (value: string) => {
  const t = value.trim();
  return t === "" ? null : t;
};

export function parseAnswerForm(
  form: AnswerForm,
): Result<AnswerInput, AnswerFormError> {
  const rating = Number(form.rating);
  if (!(RATINGS as readonly number[]).includes(rating)) return err("rating");
  if (!(RETURN_OPTIONS as readonly string[]).includes(form.wouldReturn))
    return err("would_return");
  const bestPart = text(form.bestPart);
  const oneChange = text(form.oneChange);
  const comment = text(form.comment);
  if (
    (bestPart?.length ?? 0) > MAX_SHORT_ANSWER ||
    (oneChange?.length ?? 0) > MAX_SHORT_ANSWER ||
    (comment?.length ?? 0) > MAX_COMMENT
  )
    return err("too_long");
  return ok({
    rating: rating as Rating,
    wouldReturn: form.wouldReturn as WouldReturn,
    bestPart,
    oneChange,
    comment,
  });
}

export type SurveyState = { openedAt: Date; closedAt: Date | null };

/** An admin opens a survey only for a season that has finished. */
export function mayOpen(seasonStatus: string): Result<void, "not_completed"> {
  return seasonStatus === "completed" ? ok(undefined) : err("not_completed");
}

export type AnswerRefusal = "closed" | "not_rostered" | "already";

export const ANSWER_REFUSALS: Readonly<Record<AnswerRefusal, string>> = {
  closed: "This survey has closed. Thanks all the same!",
  not_rostered:
    "This survey is for the players who were on a team that season.",
  already: "You've already answered. Thanks!",
};

/** Whether a player may answer: open, on a roster that season, not yet. */
export function mayAnswer(input: {
  survey: SurveyState;
  rostered: boolean;
  answered: boolean;
}): Result<void, AnswerRefusal> {
  if (input.survey.closedAt !== null) return err("closed");
  if (!input.rostered) return err("not_rostered");
  if (input.answered) return err("already");
  return ok(undefined);
}

export type SurveyResults = {
  answers: number;
  ratingCounts: Readonly<Record<Rating, number>>;
  /** Mean rating to one decimal place; null with no answers. */
  averageRating: number | null;
  returnCounts: Readonly<Record<WouldReturn, number>>;
  /**
   * The written answers, each list on its own and sorted, so the order says
   * nothing about who wrote what or which answers came from one person.
   */
  bestParts: string[];
  oneChanges: string[];
  comments: string[];
};

type StoredAnswer = Omit<AnswerInput, "rating"> & { rating: number };

const sorted = (values: readonly (string | null)[]) =>
  values
    .filter((v): v is string => v !== null)
    .sort((a, b) => a.localeCompare(b));

/** Totals and anonymous lists, from answers that carry no person. */
export function summarize(answers: readonly StoredAnswer[]): SurveyResults {
  const ratingCounts: Record<Rating, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const returnCounts: Record<WouldReturn, number> = { yes: 0, maybe: 0, no: 0 };
  let total = 0;
  for (const a of answers) {
    if ((RATINGS as readonly number[]).includes(a.rating))
      ratingCounts[a.rating as Rating] += 1;
    returnCounts[a.wouldReturn] += 1;
    total += a.rating;
  }
  return {
    answers: answers.length,
    ratingCounts,
    averageRating:
      answers.length === 0
        ? null
        : Math.round((total / answers.length) * 10) / 10,
    returnCounts,
    bestParts: sorted(answers.map((a) => a.bestPart)),
    oneChanges: sorted(answers.map((a) => a.oneChange)),
    comments: sorted(answers.map((a) => a.comment)),
  };
}

/** "12 of 30 players answered (40%)". */
export function turnoutLine(answered: number, invited: number): string {
  if (invited === 0) return "No players were on a roster that season.";
  const percent = Math.round((answered * 100) / invited);
  return `${answered} of ${invited} ${invited === 1 ? "player" : "players"} answered (${percent}%)`;
}
