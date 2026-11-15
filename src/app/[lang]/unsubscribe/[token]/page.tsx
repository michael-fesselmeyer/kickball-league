import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SubmitButton } from "@/components/submit-button";
import type { TurnDown } from "@/db/queries/alert-choices";
import { NEWS_TOPICS, type Topic } from "@/domain/notifications/topics";
import { env } from "@/env";
import { readUnsubscribeToken, topicLabel } from "@/lib/unsubscribe";
import { turnDownAction, unsubscribeAction } from "./actions";

export const metadata: Metadata = {
  title: "Stop these emails",
  robots: { index: false },
};

type Props = PageProps<"/[lang]/unsubscribe/[token]">;

const STILL_COME =
  "Rain-outs, changes to your games and payment deadlines still come right away.";

/** What each "turn down instead" choice does, in the page's words. */
function turnDownCopy(choice: TurnDown, topic: Topic) {
  switch (choice) {
    case "team":
      return {
        button: "Only my team",
        question: "Only your team's news?",
        explain: `You'll skip news sent to the whole league, like league announcements and event news. News from your captain still comes. ${STILL_COME}`,
        done: "You'll only get your team's news. League-wide news is skipped.",
      };
    case "weekly":
      return NEWS_TOPICS.has(topic)
        ? {
            button: "Weekly digest instead",
            question: "One roundup a week instead?",
            explain: `League news comes together in one email on Sunday evenings. ${STILL_COME}`,
            done: "League news now comes in one email on Sunday evenings.",
          }
        : {
            button: "Weekly digest instead",
            question: "One email a week instead?",
            explain: `Reminders and other emails that can wait come together in one email on Sunday evenings. ${STILL_COME}`,
            done: "Emails that can wait now come together on Sunday evenings.",
          };
    case "snooze":
      return {
        button: "Snooze for 2 weeks",
        question: "Snooze for 2 weeks?",
        explain: `For the next two weeks, emails that can wait are saved up and come in one digest after. ${STILL_COME}`,
        done: "Snoozed for 2 weeks. What can wait will come in one digest after.",
      };
  }
}

const CHOICES: readonly TurnDown[] = ["team", "weekly", "snooze"];
const isChoice = (v: unknown): v is TurnDown =>
  typeof v === "string" && (CHOICES as readonly string[]).includes(v);

const SETTINGS = (
  <Link href="/app/profile#notifications" className="underline">
    email settings
  </Link>
);

/**
 * Where an email's "Stop emails about …" and "Fewer emails instead?" links
 * open. Opening it changes nothing (mail scanners follow links); a button
 * does, without a sign-in, since the signed link is the key
 * (src/lib/unsubscribe.ts). Turning down is offered next to turning off.
 */
export default function UnsubscribePage(props: Props) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-10">
      <Suspense fallback={<p className="min-h-40">Loading…</p>}>
        <Unsubscribe {...props} />
      </Suspense>
    </main>
  );
}

async function Unsubscribe({ params, searchParams }: Props) {
  const { token } = await params;
  const query = await searchParams;
  const found = readUnsubscribeToken(env.BETTER_AUTH_SECRET, token);
  if (!found)
    return (
      <>
        <h1 className="text-h1">This link doesn&apos;t work</h1>
        <p>
          It may have been copied only in part. You can choose which emails you
          get in your {SETTINGS}.
        </p>
      </>
    );
  const label = topicLabel(found.topic).toLowerCase();
  if (query.done === "1")
    return (
      <>
        <h1 className="text-h1">Done</h1>
        <p role="status">
          You won&apos;t get emails about {label} any more. Changed your mind?
          Turn them back on in your {SETTINGS}.
        </p>
      </>
    );
  if (isChoice(query.done))
    return (
      <>
        <h1 className="text-h1">Done</h1>
        <p role="status">
          {turnDownCopy(query.done, found.topic).done} Change it any time in
          your {SETTINGS}.
        </p>
      </>
    );
  const picked = isChoice(query.do) ? query.do : null;
  const others = CHOICES.filter((c) => c !== picked);
  const offer = (choice: TurnDown) => (
    <form key={choice} action={turnDownAction.bind(null, token, choice)}>
      <SubmitButton className="btn w-full btn-secondary">
        {turnDownCopy(choice, found.topic).button}
      </SubmitButton>
    </form>
  );
  if (picked) {
    const copy = turnDownCopy(picked, found.topic);
    return (
      <>
        <h1 className="text-h1">{copy.question}</h1>
        <p>{copy.explain}</p>
        <form action={turnDownAction.bind(null, token, picked)}>
          <SubmitButton className="btn btn-primary">{copy.button}</SubmitButton>
        </form>
        <h2 className="text-h3">Or</h2>
        <div className="flex flex-col gap-2">
          {others.map(offer)}
          <form action={unsubscribeAction.bind(null, token)}>
            <SubmitButton className="btn w-full btn-secondary">
              Stop emails about {label}
            </SubmitButton>
          </form>
        </div>
      </>
    );
  }
  return (
    <>
      <h1 className="text-h1">Stop emails about {label}?</h1>
      <p>
        You&apos;ll stop getting league emails about {label}. Everything else
        stays as it is, and you can turn them back on in your email settings any
        time.
      </p>
      <form action={unsubscribeAction.bind(null, token)}>
        <SubmitButton className="btn btn-primary">
          Stop these emails
        </SubmitButton>
      </form>
      <h2 className="text-h3">Or get fewer instead</h2>
      <p className="text-small text-text-muted">{STILL_COME}</p>
      <div className="flex flex-col gap-2">{others.map(offer)}</div>
    </>
  );
}
