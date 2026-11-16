import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { HelpLink } from "@/components/help-link";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";
import { db } from "@/db/client";
import { myMoveInterest, myMoveInvites } from "@/db/queries/move";
import { DEFAULT_TIME_ZONE } from "@/db/queries/outbox";
import { type Audience, NOTE_MAX, seenByCaptains } from "@/domain/move/move";
import { requireSelf } from "@/lib/auth/permission";
import { activeLeague } from "@/lib/league/active";
import {
  answerInviteAction,
  saveMoveAction,
  withdrawMoveAction,
} from "./actions";

export const metadata: Metadata = { title: "Looking for a change" };

/** Messages by code; an unknown code from the URL finds nothing. */
const NOTICES: Record<string, { ok: boolean; text: string }> = {
  saved: {
    ok: true,
    text: "Saved. Your current team won't see it.",
  },
  withdrawn: {
    ok: true,
    text: "Taken back, with any invites. Nobody is told.",
  },
  accepted: {
    ok: true,
    text: "You said yes. That team's captains can now see your name and email.",
  },
  declined: { ok: true, text: "You said no. That team won't know." },
  pick_audience: { ok: false, text: "Choose who can see it." },
  note_too_long: {
    ok: false,
    text: `Keep the note to ${NOTE_MAX} characters.`,
  },
  not_found: {
    ok: false,
    text: "That invite has gone: the flag was taken back or has cleared.",
  },
  answered: {
    ok: false,
    text: "You already said yes to that team. Take the whole thing back to undo it.",
  },
};

const AUDIENCE_OPTIONS: { value: Audience; label: string; hint: string }[] = [
  {
    value: "captains",
    label: "Captains recruiting for next season",
    hint: "They see only how many players are open, never who, until you say yes to one of their invites.",
  },
  {
    value: "admins",
    label: "League admins only",
    hint: "They see your name and note, and can help find you a team.",
  },
  {
    value: "both",
    label: "Both",
    hint: "Admins see your name and note; recruiting captains see only a count until you say yes.",
  },
];

const AUDIENCE_LABEL: Record<Audience, string> = {
  captains: "recruiting captains (as a count, until you say yes)",
  admins: "league admins",
  both: "league admins, and recruiting captains (as a count, until you say yes)",
};

export default function ChangeTeamPage(props: PageProps<"/app/change-team">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <ChangeTeam {...props} />
      </Suspense>
    </main>
  );
}

async function ChangeTeam({ searchParams }: PageProps<"/app/change-team">) {
  const subject = await requireSelf("move.set", "/app/change-team");
  const query = await searchParams;
  const league = await activeLeague();
  if (!league) notFound();
  const now = new Date();
  const [mine, invites] = await Promise.all([
    myMoveInterest(db, subject.userId, league.id, now),
    myMoveInvites(db, subject.userId, league.id, now),
  ]);
  const timeZone = league.timeZone ?? DEFAULT_TIME_ZONE;
  const day = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone,
    }).format(d);
  const notice =
    typeof query.done === "string" ? NOTICES[query.done] : undefined;
  const answers = mine !== null && seenByCaptains(mine.audience);

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link href="/app/profile" className="underline">
          Your profile
        </Link>
        <h1 className="text-h1">Looking for a change?</h1>
        <HelpLink
          audience="player"
          article="change-team"
          topic="looking for a change"
        />
        <p>
          If you&apos;d like to try a different team next season, say so quietly
          here. You don&apos;t need to give a reason.
        </p>
        <p className="text-text-muted">
          Your current team never sees it: not your captain, co-captains or
          teammates, and nothing public shows it. It clears on its own when next
          season&apos;s registration closes, and you can take it back any time.
        </p>
      </header>

      <div id="status" className="flex flex-col gap-3">
        {notice && (
          <p
            role={notice.ok ? "status" : "alert"}
            className={`rounded-lg border p-3 ${notice.ok ? "border-success" : "border-danger"}`}
          >
            {notice.text}
          </p>
        )}
        {mine && (
          <p className="rounded-lg border border-border p-3">
            You&apos;re open to a new team, since {day(mine.since)}. Seen by{" "}
            {AUDIENCE_LABEL[mine.audience]}.{" "}
            {mine.clearsAt
              ? `It clears on its own on ${day(mine.clearsAt)}.`
              : "It clears on its own when next season's registration closes."}
          </p>
        )}
      </div>

      <form action={saveMoveAction} className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-h2">Who can see it</legend>
          {AUDIENCE_OPTIONS.map((o) => (
            <div key={o.value} className="flex min-h-11 items-start gap-3">
              <input
                id={`audience-${o.value}`}
                type="radio"
                name="audience"
                value={o.value}
                required
                defaultChecked={(mine?.audience ?? "both") === o.value}
                aria-describedby={`audience-${o.value}-hint`}
                className="mt-1 size-6"
              />
              <div className="flex flex-col">
                <label htmlFor={`audience-${o.value}`}>{o.label}</label>
                <span
                  id={`audience-${o.value}-hint`}
                  className="text-small text-text-muted"
                >
                  {o.hint}
                </span>
              </div>
            </div>
          ))}
        </fieldset>
        <label htmlFor="note" className="flex flex-col gap-1">
          <span>
            A short note <span className="text-text-muted">(optional)</span>
          </span>
          <span className="text-small text-text-muted">
            Only the people you chose read it. For example, a night that suits
            you.
          </span>
        </label>
        <textarea
          id="note"
          name="note"
          rows={2}
          maxLength={NOTE_MAX}
          defaultValue={mine?.note ?? ""}
          className="rounded-md border border-border bg-surface px-2 py-2"
        />
        <SubmitButton className="btn self-start btn-primary">
          {mine ? "Save changes" : "I'm open to a new team"}
        </SubmitButton>
      </form>

      {mine && (
        <form action={withdrawMoveAction}>
          <SubmitButton className="btn self-start btn-secondary">
            Take it back
          </SubmitButton>
        </form>
      )}

      {mine && (
        <section aria-labelledby="invites" className="flex flex-col gap-3">
          <h2 id="invites" className="text-h2">
            Invites
          </h2>
          {invites.length === 0 ? (
            <p className="text-text-muted">
              {seenByCaptains(mine.audience)
                ? "No invites yet. Teams recruiting for next season can send one without knowing who you are."
                : "Captains can't see you, so teams can't invite you. Choose captains or both to get invites."}
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {invites.map((i) => (
                <li
                  key={i.id}
                  className="flex flex-col gap-2 rounded-lg border border-border p-4"
                >
                  <p className="font-semibold">
                    {i.team}{" "}
                    <span className="font-normal text-text-muted">
                      · {i.seasonName} · {day(i.sentAt)}
                    </span>
                  </p>
                  {i.message && (
                    <blockquote className="border-l-4 border-border pl-3">
                      {i.message}
                    </blockquote>
                  )}
                  {i.teammateCaptains && i.status !== "accepted" && (
                    <p className="text-small">
                      Heads up: someone who helps captain {i.team} plays with
                      you this season. Saying yes shows them your name and
                      email.
                    </p>
                  )}
                  {i.status === "accepted" ? (
                    <p className="text-small text-text-muted">
                      You said yes. Their captains can see your name and email.
                    </p>
                  ) : answers ? (
                    <div className="flex flex-wrap gap-3">
                      <form action={answerInviteAction.bind(null, i.id, true)}>
                        <SubmitButton className="btn btn-primary">
                          Yes, share my name and email
                        </SubmitButton>
                      </form>
                      {i.status === "pending" ? (
                        <form
                          action={answerInviteAction.bind(null, i.id, false)}
                        >
                          <SubmitButton className="btn btn-secondary">
                            No thanks
                          </SubmitButton>
                        </form>
                      ) : (
                        <p className="self-center text-small text-text-muted">
                          You said no. They don&apos;t know.
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-small text-text-muted">
                      Let captains see it to answer.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
