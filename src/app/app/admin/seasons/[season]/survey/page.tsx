import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { db } from "@/db/client";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { activeLeagueId } from "@/lib/league/active";
import { surveyForSeason, surveyResults } from "@/db/queries/surveys";
import { can } from "@/domain/authz/permissions";
import { formatMoment } from "@/domain/money/credit";
import {
  QUESTIONS,
  RATING_LABELS,
  RATINGS,
  RETURN_LABELS,
  RETURN_OPTIONS,
  turnoutLine,
} from "@/domain/survey/questions";
import { requirePermission } from "@/lib/auth/permission";
import { closeSurveyAction, openSurveyAction } from "./actions";
import { SubmitButton } from "@/components/submit-button";

export const metadata: Metadata = { title: "Run the season survey" };

type Props = PageProps<"/app/admin/seasons/[season]/survey">;

export default function SurveyAdminPage(props: Props) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<p className="min-h-svh">Loading…</p>}>
        <SurveyAdmin {...props} />
      </Suspense>
    </main>
  );
}

const ERRORS: Record<string, string> = {
  not_completed:
    "The survey opens once the season is completed. Mark the season completed first.",
  exists: "This season's survey is already open.",
  confirm: "Tick the box to confirm.",
  closed: "The survey is already closed.",
  not_found: "That season is gone.",
};

/**
 * Totals and the written answers, each list sorted on its own: nothing on
 * this screen says who answered what.
 */
async function SurveyAdmin({ params, searchParams }: Props) {
  const { season: slug } = await params;
  const query = await searchParams;
  const page = `/app/admin/seasons/${slug}/survey`;
  const subject = await requirePermission("survey.results", { next: page });
  await connection();
  const season = await seasonBySlug(db, await activeLeagueId(), slug);
  if (!season) notFound();
  const survey = await surveyForSeason(db, season.id);
  const results = survey ? await surveyResults(db, survey) : null;
  const manage = can(subject, "survey.manage");
  const at = (d: Date) => formatMoment(d, season.timeZone);
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const invited = Number(query.invited);
  const saved =
    query.saved === "opened"
      ? `Survey opened. ${Number.isInteger(invited) ? `${invited} ${invited === 1 ? "player gets" : "players get"} an invite.` : ""}`
      : query.saved === "closed"
        ? "Survey closed."
        : undefined;
  const percent = (n: number) =>
    results && results.answers > 0
      ? `${Math.round((n * 100) / results.answers)}%`
      : "0%";

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link
          href={`/app/admin/seasons/${slug}`}
          className="inline-flex min-h-11 items-center self-start underline"
        >
          {season.name}
        </Link>
        <h1 className="text-h1">Season survey</h1>
        <p className="text-text-muted">
          Five questions for everyone who was on a team this season. Answers are
          anonymous: you see totals and comments, never who wrote them.
        </p>
      </header>
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="rounded-lg border border-success p-3">
          {saved}
        </p>
      )}

      {!survey ? (
        manage && (
          <section aria-labelledby="open" className="flex flex-col gap-2">
            <h2 id="open" className="text-h2">
              Open the survey
            </h2>
            {season.status === "completed" ? (
              <>
                <p>
                  Every player on a roster gets one invite (by email, and on
                  their phone if they allow it). They can answer until you close
                  the survey.
                </p>
                <form action={openSurveyAction.bind(null, slug)}>
                  <SubmitButton className="btn btn-primary">
                    Open the survey and invite players
                  </SubmitButton>
                </form>
              </>
            ) : (
              <p>
                The survey opens once the season is completed. Come back after
                the last game.
              </p>
            )}
          </section>
        )
      ) : (
        <>
          <section aria-labelledby="status" className="flex flex-col gap-2">
            <h2 id="status" className="text-h2">
              {survey.closedAt ? "Closed" : "Open"}
            </h2>
            <p>
              Opened {at(survey.openedAt)}
              {survey.closedAt && `, closed ${at(survey.closedAt)}`}.
            </p>
            {results && (
              <p className="font-bold">
                {turnoutLine(results.answers, results.invited)}
              </p>
            )}
            {manage && !survey.closedAt && (
              <form
                action={closeSurveyAction.bind(null, slug)}
                className="flex flex-col gap-2"
              >
                <label className="flex min-h-11 items-center gap-2">
                  <input
                    type="checkbox"
                    name="confirm"
                    value="yes"
                    className="size-5"
                  />
                  Stop taking answers
                </label>
                <SubmitButton className="btn self-start btn-secondary">
                  Close the survey
                </SubmitButton>
              </form>
            )}
          </section>

          {results && (
            <>
              <section aria-labelledby="rating" className="flex flex-col gap-2">
                <h2 id="rating" className="text-h2">
                  {QUESTIONS.rating}
                </h2>
                <p>
                  Average:{" "}
                  <strong>
                    {results.averageRating === null
                      ? "no answers yet"
                      : `${results.averageRating.toFixed(1)} out of 5`}
                  </strong>
                </p>
                <table className="w-full text-left">
                  <caption className="sr-only">Ratings</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="py-1">
                        Rating
                      </th>
                      <th scope="col" className="py-1 text-right">
                        Answers
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...RATINGS].reverse().map((r) => (
                      <tr key={r} className="border-t border-border">
                        <th scope="row" className="py-1 font-normal">
                          {RATING_LABELS[r]}
                        </th>
                        <td className="py-1 text-right tabular-nums">
                          {results.ratingCounts[r]} (
                          {percent(results.ratingCounts[r])})
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
              <section aria-labelledby="return" className="flex flex-col gap-2">
                <h2 id="return" className="text-h2">
                  {QUESTIONS.wouldReturn}
                </h2>
                <ul className="flex flex-col gap-1">
                  {RETURN_OPTIONS.map((o) => (
                    <li key={o}>
                      {RETURN_LABELS[o]}:{" "}
                      <strong className="tabular-nums">
                        {results.returnCounts[o]}
                      </strong>{" "}
                      ({percent(results.returnCounts[o])})
                    </li>
                  ))}
                </ul>
              </section>
              <Comments
                id="best"
                title={QUESTIONS.bestPart}
                items={results.bestParts}
              />
              <Comments
                id="change"
                title={QUESTIONS.oneChange}
                items={results.oneChanges}
              />
              <Comments
                id="comments"
                title={QUESTIONS.comment}
                items={results.comments}
              />
            </>
          )}
        </>
      )}
    </>
  );
}

function Comments({
  id,
  title,
  items,
}: {
  id: string;
  title: string;
  items: readonly string[];
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="text-h2">
        {title}
      </h2>
      {items.length === 0 ? (
        <p className="text-text-muted">No answers yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((text, i) => (
            <li
              key={i}
              className="rounded-card border border-border p-3 whitespace-pre-line"
            >
              {text}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
