import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { db } from "@/db/client";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { activeLeagueId } from "@/lib/league/active";
import { surveyForSeason, surveyStanding } from "@/db/queries/surveys";
import {
  ANSWER_FORM_ERRORS,
  ANSWER_REFUSALS,
  MAX_COMMENT,
  MAX_SHORT_ANSWER,
  mayAnswer,
  QUESTIONS,
  RATING_LABELS,
  RATINGS,
  RETURN_LABELS,
  RETURN_OPTIONS,
} from "@/domain/survey/questions";
import { requirePermission } from "@/lib/auth/permission";
import { answerSurveyAction } from "./actions";
import { SubmitButton } from "@/components/submit-button";

export const metadata: Metadata = { title: "Season survey" };

type Props = PageProps<"/[lang]/app/seasons/[season]/survey">;

export default function SurveyPage(props: Props) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <Suspense fallback={<p className="min-h-svh">Loading the survey…</p>}>
        <Survey {...props} />
      </Suspense>
    </main>
  );
}

const MESSAGES: Record<string, string> = {
  ...ANSWER_FORM_ERRORS,
  ...ANSWER_REFUSALS,
};

const control =
  "min-h-11 rounded-input border border-border-strong bg-surface px-3 py-2 text-body";

async function Survey({ params, searchParams }: Props) {
  const { season: slug } = await params;
  const query = await searchParams;
  const page = `/app/seasons/${slug}/survey`;
  const subject = await requirePermission("survey.answer", { next: page });
  await connection();
  const season = await seasonBySlug(db, await activeLeagueId(), slug);
  const survey = season ? await surveyForSeason(db, season.id) : null;
  if (!season || !survey) notFound();
  const standing = await surveyStanding(db, survey, subject.userId);
  const allowed = mayAnswer({ survey, ...standing });
  const thanks = query.notice === "thanks";
  const error =
    typeof query.error === "string" && !thanks
      ? MESSAGES[query.error]
      : undefined;

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link
          href="/app"
          className="inline-flex min-h-11 items-center self-start underline"
        >
          Home
        </Link>
        <h1 className="text-h1">How was {season.name}?</h1>
        <p className="text-text-muted">
          Five quick questions. Your answers are anonymous: the league sees
          totals and comments, never who wrote them. You can answer once.
        </p>
      </header>
      {thanks && (
        <p role="status" className="rounded-lg border border-success p-3">
          Thanks! Your answers are in.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      {!allowed.ok ? (
        !thanks && (
          <p className="rounded-card border-2 border-border p-4">
            {ANSWER_REFUSALS[allowed.error]}
          </p>
        )
      ) : (
        <form
          action={answerSurveyAction.bind(null, slug)}
          className="flex flex-col gap-6"
        >
          <fieldset className="flex flex-col gap-1">
            <legend className="font-bold">{QUESTIONS.rating}</legend>
            {[...RATINGS].reverse().map((r) => (
              <label key={r} className="flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  name="rating"
                  value={r}
                  required
                  className="size-5"
                />
                {RATING_LABELS[r]}
              </label>
            ))}
          </fieldset>
          <fieldset className="flex flex-col gap-1">
            <legend className="font-bold">{QUESTIONS.wouldReturn}</legend>
            {RETURN_OPTIONS.map((o) => (
              <label key={o} className="flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  name="wouldReturn"
                  value={o}
                  required
                  className="size-5"
                />
                {RETURN_LABELS[o]}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-col gap-1">
            <label htmlFor="bestPart" className="font-bold">
              {QUESTIONS.bestPart} (optional)
            </label>
            <textarea
              id="bestPart"
              name="bestPart"
              rows={3}
              maxLength={MAX_SHORT_ANSWER}
              className={control}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="oneChange" className="font-bold">
              {QUESTIONS.oneChange} (optional)
            </label>
            <textarea
              id="oneChange"
              name="oneChange"
              rows={3}
              maxLength={MAX_SHORT_ANSWER}
              className={control}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="comment" className="font-bold">
              {QUESTIONS.comment} (optional)
            </label>
            <textarea
              id="comment"
              name="comment"
              rows={4}
              maxLength={MAX_COMMENT}
              aria-describedby="comment-hint"
              className={control}
            />
            <p id="comment-hint" className="text-small text-text-muted">
              Leave out names if you want to stay anonymous: comments are shown
              as written.
            </p>
          </div>
          <SubmitButton className="btn self-start btn-primary">
            Send my answers
          </SubmitButton>
        </form>
      )}
    </>
  );
}
