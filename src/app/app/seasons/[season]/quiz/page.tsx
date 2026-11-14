import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { myQuiz } from "@/db/queries/free-agents";
import { seasonForRegistration } from "@/db/queries/registration";
import { currentLeague } from "@/db/queries/seasons";
import {
  FRIEND_GROUP_MAX,
  formatFriendCode,
  friendsSentence,
} from "@/domain/matcher/friend-code";
import { NOTES_MAX, QUESTIONS, type QuizAnswers } from "@/domain/matcher/quiz";
import { requireSelf } from "@/lib/auth/permission";
import {
  joinGroupAction,
  leaveGroupAction,
  saveQuizAction,
  startGroupAction,
} from "./actions";
import { SubmitButton } from "@/components/submit-button";

export const metadata: Metadata = { title: "Team-fit quiz" };

const ERRORS: Record<string, string> = {
  missing_experience: "Tell us how much kickball you've played.",
  missing_availability: "Tell us how many game nights you can make.",
  missing_vibe: "Tell us what you're here for.",
  missing_captain: "Tell us whether you'd captain.",
  notes_too_long: `Keep the note to ${NOTES_MAX} characters.`,
  not_in_pool:
    "The quiz and friend codes are for free agents who haven't been placed on a team yet.",
  bad_code: "Friend codes are 6 letters and numbers, like ABC-234.",
  unknown_code:
    "We couldn't find that code for this season. Check it with your friend.",
  group_full: `That group is full: a friend code holds up to ${FRIEND_GROUP_MAX} people.`,
  already_in_group: "You're already in that group.",
};
const GROUP_ERRORS = new Set([
  "bad_code",
  "unknown_code",
  "group_full",
  "already_in_group",
]);
const NOTICES: Record<string, string> = {
  group_started: "Group started. Share the code with your friends.",
  group_joined: "You're in. We'll keep you together.",
  group_left: "You left the group.",
};

export default function QuizPage(
  props: PageProps<"/app/seasons/[season]/quiz">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<QuizSkeleton />}>
        <Quiz {...props} />
      </Suspense>
    </main>
  );
}

/** Holds the page's shape while it loads, so nothing jumps. */
function QuizSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-8">
      <p className="sr-only">Loading…</p>
      <div className="h-24 rounded-lg bg-surface" />
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-40 rounded-lg bg-surface" />
      ))}
    </div>
  );
}

const choice =
  "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border-2 border-border px-3 py-2 has-[:checked]:border-text has-[:checked]:bg-surface has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus";

function Question({
  name,
  type,
  answers,
}: {
  name: "experience" | "positions" | "availability" | "vibe" | "captain";
  type: "radio" | "checkbox";
  answers: QuizAnswers | null;
}) {
  const q = QUESTIONS[name];
  const chosen = (value: string) =>
    name === "positions"
      ? (answers?.positions as readonly string[] | undefined)?.includes(value)
      : answers?.[name] === value;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-h3">{q.title}</legend>
      {"hint" in q && <p className="text-text-muted">{q.hint}</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {q.choices.map((c) => (
          <label key={c.value} className={choice}>
            <input
              type={type}
              name={name}
              value={c.value}
              defaultChecked={chosen(c.value)}
              required={type === "radio"}
              className="size-5 accent-[var(--text)]"
            />
            {c.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

async function Quiz({
  params,
  searchParams,
}: PageProps<"/app/seasons/[season]/quiz">) {
  const { season: slug } = await params;
  const query = await searchParams;
  const subject = await requireSelf(
    "profile.edit",
    `/app/seasons/${slug}/quiz`,
  );
  const league = await currentLeague(db);
  const season = league
    ? await seasonForRegistration(db, league.id, slug)
    : null;
  if (!season) notFound();
  const mine = await myQuiz(db, season.id, subject.userId);
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const notice =
    typeof query.notice === "string" ? NOTICES[query.notice] : undefined;
  // Friend-code messages show in the friends section, where the page lands.
  const aboutGroup =
    typeof query.error === "string" && GROUP_ERRORS.has(query.error);

  const header = (
    <header className="flex flex-col gap-2">
      <Link href={`/app/seasons/${slug}`} className="underline">
        {season.name}
      </Link>
      <h1 className="text-h1">Find your team</h1>
      <p className="text-text-muted">
        Five quick taps, about a minute. The league uses your answers to put you
        on a team that fits, and keeps you with any friends who signed up with
        you.
      </p>
    </header>
  );

  if (!mine || mine.placed)
    return (
      <>
        {header}
        <p>
          {mine?.placed
            ? "You're already on a team this season, so there's nothing to match. See you on the field!"
            : "The quiz is for free agents. Register as a free agent first, and we'll match you with a team."}
        </p>
        <Link href={`/app/seasons/${slug}`} className="underline">
          Back to your season
        </Link>
      </>
    );

  return (
    <>
      {header}
      {error && !aboutGroup && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}

      <form
        action={saveQuizAction.bind(null, slug)}
        className="flex flex-col gap-8"
      >
        <Question name="experience" type="radio" answers={mine.answers} />
        <Question name="positions" type="checkbox" answers={mine.answers} />
        <Question name="availability" type="radio" answers={mine.answers} />
        <Question name="vibe" type="radio" answers={mine.answers} />
        <Question name="captain" type="radio" answers={mine.answers} />
        <label className="flex flex-col gap-1">
          Anything else the league should know? (optional)
          <input
            type="text"
            name="notes"
            maxLength={NOTES_MAX}
            defaultValue={mine.notes ?? ""}
            className="min-h-11 rounded-lg border border-border px-3"
          />
        </label>
        <SubmitButton className="btn self-start btn-primary">
          {mine.answers ? "Update my answers" : "Save my answers"}
        </SubmitButton>
      </form>

      <section
        id="friends"
        aria-labelledby="friends-title"
        className="flex flex-col gap-3 rounded-lg border border-border p-4"
      >
        <h2 id="friends-title" className="text-h2">
          Signing up with friends?
        </h2>
        {error && aboutGroup && (
          <p role="alert" className="rounded-lg border border-danger p-3">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="rounded-lg border border-success p-3">
            {notice}
          </p>
        )}
        {mine.code ? (
          <>
            <p>
              Your friend code is{" "}
              <strong className="font-mono text-h3 tracking-wider">
                {formatFriendCode(mine.code)}
              </strong>
              . Friends enter it on this page after they register as free
              agents. Up to {FRIEND_GROUP_MAX} of you stay together.
            </p>
            <p className="text-text-muted">
              {mine.friends.length === 0
                ? "Nobody has joined yet."
                : friendsSentence("In your group:", mine.friends)}
            </p>
            <form action={leaveGroupAction.bind(null, slug)}>
              <SubmitButton className="min-h-11 underline">
                Leave this group
              </SubmitButton>
            </form>
          </>
        ) : (
          <>
            <p className="text-text-muted">
              Start a group and share the code, or enter a friend&apos;s code.
              Up to {FRIEND_GROUP_MAX} of you land on the same team.
            </p>
            <form action={startGroupAction.bind(null, slug)}>
              <SubmitButton className="btn btn-secondary">
                Start a group
              </SubmitButton>
            </form>
          </>
        )}
        <form
          action={joinGroupAction.bind(null, slug)}
          className="flex flex-wrap items-end gap-2"
        >
          <label className="flex flex-col gap-1">
            {mine.code ? "Switch to a friend's group" : "Friend's code"}
            <input
              type="text"
              name="code"
              required
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={9}
              placeholder="ABC-234"
              className="min-h-11 w-36 rounded-lg border border-border px-3 font-mono uppercase"
            />
          </label>
          <SubmitButton className="btn btn-secondary">Join</SubmitButton>
        </form>
      </section>
    </>
  );
}
