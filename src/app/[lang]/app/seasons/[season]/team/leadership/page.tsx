import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";
import { db } from "@/db/client";
import { dayName, leadershipFor } from "@/db/queries/leadership";
import {
  myRegistration,
  seasonForRegistration,
} from "@/db/queries/registration";
import { can } from "@/domain/authz/permissions";
import type { LeadRole, Outcome } from "@/domain/leadership/leadership";
import { requirePermission } from "@/lib/auth/permission";
import { activeLeague } from "@/lib/league/active";
import {
  answerAction,
  checkInAction,
  chooseAction,
  voteAction,
} from "./actions";

export const metadata: Metadata = { title: "Leadership check-in" };

/** Messages by code; an unknown code from the URL finds nothing. */
const MESSAGES: Record<string, { ok: boolean; text: string }> = {
  checked_in: {
    ok: true,
    text: "Thanks for checking in. Only you know what you said.",
  },
  voted: { ok: true, text: "Your secret vote is in. Thanks!" },
  standing: { ok: true, text: "Great, you're standing." },
  not_standing: { ok: true, text: "No problem. You're not standing." },
  hand_off_now: {
    ok: true,
    text: "Done. They've been offered the captaincy, and the team has heard.",
  },
  captain_elect: {
    ok: true,
    text: "Done. They're a co-captain now and take over next season. The team has heard.",
  },
  already: {
    ok: false,
    text: "You've already sent yours; it can't be changed.",
  },
  paused: {
    ok: false,
    text: "The league has paused this check-in for now. Try again once it resumes.",
  },
  closed: { ok: false, text: "This step has closed." },
  not_on_team: {
    ok: false,
    text: "Only people on the team's roster can take part.",
  },
  suggest_self: {
    ok: false,
    text: "To put yourself forward, tick the box above instead.",
  },
  suggest_not_on_team: { ok: false, text: "Pick a teammate on the roster." },
  already_in_role: { ok: false, text: "They already have that role." },
  not_captain: { ok: false, text: "Only the captain can say that." },
  not_asked: { ok: false, text: "There's nothing to answer yet." },
  pick_one: { ok: false, text: "Pick one choice." },
  not_found: { ok: false, text: "That's no longer there." },
};

const ROLE: Record<LeadRole, string> = {
  captain: "next season's captain",
  co_captain: "a co-captain",
};

const OUTCOME: Record<Outcome, string> = {
  no_quorum:
    "Not quite enough of the team checked in this time, so nothing changes. Thanks to everyone who did.",
  no_candidates:
    "Everyone's happy with how the team is led, so nothing changes. Thanks for checking in.",
  no_majority:
    "The ballot didn't land on a clear choice, so nothing changes this time.",
  captain_stays: "The team chose to keep its captain. Here's to next season!",
  new_captain: "The team chose a new captain.",
  winner_left:
    "The teammate the ballot chose has left the team, so nothing changes this time.",
  closed_by_league:
    "The league closed this check-in with no change. Your captain can still hand over as usual.",
};

const field = "rounded-md border border-border bg-surface px-2 py-2";

export default function LeadershipPage(
  props: PageProps<"/app/seasons/[season]/team/leadership">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <Leadership {...props} />
      </Suspense>
    </main>
  );
}

async function Leadership({
  params,
  searchParams,
}: PageProps<"/app/seasons/[season]/team/leadership">) {
  const { season: slug } = await params;
  const query = await searchParams;
  const subject = await requirePermission("registration.join", {
    next: `/app/seasons/${slug}/team/leadership`,
  });
  const league = await activeLeague();
  const season = league
    ? await seasonForRegistration(db, league.id, slug)
    : null;
  if (!league || !season) notFound();
  const team = (await myRegistration(db, season.id, subject.userId))?.team;
  if (
    !team ||
    !can(subject, "leadership.take_part", { teamSeasonId: team.teamSeasonId })
  )
    notFound();
  const view = await leadershipFor(db, team.teamSeasonId, subject.userId);
  if (!view) notFound();
  const tz = league.timeZone;
  const code = typeof query.leadership === "string" ? query.leadership : "";
  const message = MESSAGES[code];
  const id = view.id;
  const isCaptain = view.me.role === "captain";

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href={`/app/seasons/${slug}/team`} className="underline">
          {team.teamName}
        </Link>
        <h1 className="text-h1">Leadership check-in</h1>
        <p className="text-text-muted">
          Every team gets this quick, private check-in at the end of the season:
          who&apos;d you like to help lead next season?
        </p>
      </header>

      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          className={`rounded-lg border p-3 ${message.ok ? "border-success" : "border-danger"}`}
        >
          {message.text}
        </p>
      )}

      {view.paused && view.step !== "closed" && (
        <p className="rounded-lg border border-warning p-3">
          The league has paused this check-in for now. Nothing can be sent until
          it resumes, and its deadline moves on by the time it was paused.
        </p>
      )}

      {view.step === "check_in" && (
        <>
          <Progress
            label="Checked in"
            rule="A vote needs"
            took={view.progress.tookPart}
            needed={view.progress.needed}
            roster={view.progress.roster}
            closes={dayName(view.checkInClosesAt, tz)}
          />
          {view.me.asks.length > 0 && (
            <section aria-labelledby="asks" className="flex flex-col gap-3">
              <h2 id="asks" className="text-h2">
                For you
              </h2>
              {view.me.asks.map((ask) => (
                <div
                  key={ask.role}
                  className="flex flex-col gap-2 rounded-lg border border-border p-3"
                >
                  <p>
                    {ask.volunteered
                      ? `You put yourself forward as ${ROLE[ask.role]}.`
                      : `A teammate suggested you as ${ROLE[ask.role]}. Would you like to stand? Saying no is completely fine, and only you see this.`}
                    {ask.answer === "accepted" &&
                      !ask.volunteered &&
                      " You said yes."}
                    {ask.answer === "declined" && " You're not standing."}
                  </p>
                  <div className="flex flex-wrap gap-3">
                    {ask.answer !== "accepted" &&
                      !(ask.volunteered && ask.answer === null) && (
                        <form
                          action={answerAction.bind(
                            null,
                            slug,
                            id,
                            ask.role,
                            true,
                          )}
                        >
                          <SubmitButton className="btn btn-primary">
                            {ask.volunteered
                              ? "Stand again"
                              : "Yes, I'll stand"}
                          </SubmitButton>
                        </form>
                      )}
                    {ask.answer !== "declined" && (
                      <form
                        action={answerAction.bind(
                          null,
                          slug,
                          id,
                          ask.role,
                          false,
                        )}
                      >
                        <SubmitButton className="btn btn-secondary">
                          {ask.volunteered ? "Withdraw" : "No thanks"}
                        </SubmitButton>
                      </form>
                    )}
                  </div>
                </div>
              ))}
            </section>
          )}
          {view.me.checkedIn ? (
            <p className="rounded-lg border border-border p-3">
              You&apos;ve checked in. Thanks! Only you know what you said.
            </p>
          ) : (
            !view.paused && (
              <form
                action={checkInAction.bind(null, slug, id)}
                className="flex flex-col gap-5"
              >
                {view.me.role !== "captain" && (
                  <fieldset className="flex flex-col gap-2">
                    <legend className="text-h3">Put yourself forward</legend>
                    {view.me.role === "player" && (
                      <label className="flex min-h-11 items-center gap-2">
                        <input
                          type="checkbox"
                          name="volunteer"
                          value="co_captain"
                        />
                        I&apos;d like to help as a co-captain
                      </label>
                    )}
                    <label className="flex min-h-11 items-center gap-2">
                      <input type="checkbox" name="volunteer" value="captain" />
                      I&apos;d like to captain next season
                    </label>
                  </fieldset>
                )}
                {view.teammates.length > 0 && (
                  <fieldset className="flex flex-col gap-2">
                    <legend className="text-h3">Suggest a teammate</legend>
                    <label htmlFor="suggest">Teammate</label>
                    <select
                      id="suggest"
                      name="suggest"
                      className={field}
                      defaultValue=""
                    >
                      <option value="">Nobody this time</option>
                      {view.teammates.map((m) => (
                        <option key={m.userId} value={m.userId}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                    <span>As</span>
                    <label className="flex min-h-11 items-center gap-2">
                      <input
                        type="radio"
                        name="suggestRole"
                        value="co_captain"
                        defaultChecked
                      />
                      A co-captain
                    </label>
                    <label className="flex min-h-11 items-center gap-2">
                      <input type="radio" name="suggestRole" value="captain" />
                      Next season&apos;s captain
                    </label>
                    <p className="text-small text-text-muted">
                      They&apos;re asked whether they&apos;d like to stand,
                      within a day, and never told who suggested them.
                    </p>
                  </fieldset>
                )}
                {isCaptain && (
                  <label className="flex min-h-11 items-center gap-2">
                    <input type="checkbox" name="steppingDown" value="yes" />
                    I&apos;m happy to hand over next season
                  </label>
                )}
                <p className="text-small text-text-muted">
                  Leave everything blank to say things are good as they are.
                  Nobody sees your answer: not your captain, teammates or the
                  league. You check in once, and it can&apos;t be changed after.
                </p>
                <SubmitButton className="btn self-start btn-primary">
                  Check in
                </SubmitButton>
              </form>
            )
          )}
        </>
      )}

      {view.step === "ballot" && (
        <>
          <Progress
            label="Voted"
            rule="The vote counts with"
            took={view.progress.tookPart}
            needed={view.progress.needed}
            roster={view.progress.roster}
            closes={view.ballotClosesAt ? dayName(view.ballotClosesAt, tz) : ""}
          />
          {view.me.voted ? (
            <p className="rounded-lg border border-border p-3">
              Your secret vote is in. Thanks!
            </p>
          ) : (
            !view.paused && (
              <form
                action={voteAction.bind(null, slug, id)}
                className="flex flex-col gap-3"
              >
                <fieldset className="flex flex-col gap-2">
                  <legend className="text-h2">
                    Who&apos;d you like to captain next season?
                  </legend>
                  {view.ballot.map((option) => (
                    <label
                      key={option.id}
                      className="flex min-h-11 items-center gap-2"
                    >
                      <input
                        type="radio"
                        name="option"
                        value={option.id}
                        required
                      />
                      {option.isCaptain
                        ? `Keep ${option.name} as captain`
                        : option.name}
                    </label>
                  ))}
                </fieldset>
                <p className="text-small text-text-muted">
                  Nobody sees how you vote, not the captain, teammates or the
                  league; the team only hears the outcome. A clear majority is
                  needed for any change. You vote once, and it can&apos;t be
                  changed after.
                </p>
                <SubmitButton className="btn self-start btn-primary">
                  Cast my secret vote
                </SubmitButton>
              </form>
            )
          )}
        </>
      )}

      {view.step === "captain_review" &&
        (view.resultForCaptain ? (
          <section
            aria-labelledby="result"
            className="flex flex-col gap-3 rounded-lg border border-warning p-4"
          >
            <h2 id="result" className="text-h2">
              Your team&apos;s result, just for you
            </h2>
            {view.resultForCaptain === "new_captain" &&
            view.electedForCaptain ? (
              <>
                <p>
                  The team&apos;s secret ballot chose {view.electedForCaptain}{" "}
                  to captain next season. You&apos;re hearing it first; the team
                  hears once you choose
                  {view.reviewEndsAt
                    ? `, or on ${dayName(view.reviewEndsAt, tz)}`
                    : ""}
                  .
                </p>
                {!view.paused && (
                  <div className="flex flex-col gap-3">
                    <form
                      action={chooseAction.bind(
                        null,
                        slug,
                        id,
                        "captain_elect",
                      )}
                    >
                      <SubmitButton className="btn btn-primary">
                        Stay on this season, with {view.electedForCaptain} as
                        co-captain taking over next season
                      </SubmitButton>
                    </form>
                    <form
                      action={chooseAction.bind(null, slug, id, "hand_off_now")}
                    >
                      <SubmitButton className="btn btn-secondary">
                        Hand over to {view.electedForCaptain} now
                      </SubmitButton>
                    </form>
                  </div>
                )}
              </>
            ) : (
              <p>
                {OUTCOME[view.resultForCaptain]} The team hears
                {view.reviewEndsAt
                  ? ` on ${dayName(view.reviewEndsAt, tz)}`
                  : " soon"}
                .
              </p>
            )}
          </section>
        ) : (
          <p className="rounded-lg border border-border p-3">
            Voting has closed. The team hears the outcome
            {view.reviewEndsAt
              ? ` by ${dayName(view.reviewEndsAt, tz)}`
              : " soon"}
            . Thanks for taking part.
          </p>
        ))}

      {view.step === "closed" && view.outcome && (
        <section aria-labelledby="outcome" className="flex flex-col gap-3">
          <h2 id="outcome" className="text-h2">
            Check-in done
          </h2>
          <p>
            {view.outcome === "new_captain" && view.elected
              ? view.captainChoice === "hand_off_now"
                ? `The team chose ${view.elected} as captain, and they're taking over now.`
                : `The team chose ${view.elected} as captain for next season. Until then they help lead as a co-captain.`
              : OUTCOME[view.outcome]}
          </p>
          {view.helpers.length > 0 && (
            <div className="rounded-lg border border-border p-3">
              <p>
                Just for you: {view.helpers.join(", ")}{" "}
                {view.helpers.length === 1 ? "would" : "would each"} be happy to
                help as a co-captain. You can add co-captains on your team page.
              </p>
            </div>
          )}
        </section>
      )}

      <p className="text-small text-text-muted">
        Captains can always hand the team over on their own, from the team page.{" "}
        <Link href="/help/player#leadership-check-in" className="underline">
          How the check-in works
        </Link>
      </p>
    </>
  );
}

function Progress({
  label,
  rule,
  took,
  needed,
  roster,
  closes,
}: {
  label: string;
  rule: string;
  took: number;
  needed: number;
  roster: number;
  closes: string;
}) {
  return (
    <p className="rounded-lg border border-border p-3">
      {label}: {took} of {roster} on the roster. {rule} {needed}.
      {closes && ` Open until ${closes}.`}
    </p>
  );
}
