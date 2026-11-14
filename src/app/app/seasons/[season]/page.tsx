import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { creditBalance } from "@/db/queries/credit";
import { myQuiz } from "@/db/queries/free-agents";
import { friendsSentence } from "@/domain/matcher/friend-code";
import {
  amountOwed,
  myRegistration,
  seasonForRegistration,
} from "@/db/queries/registration";
import { currentLeague } from "@/db/queries/seasons";
import { hasSignedSeasonWaiver } from "@/db/queries/waivers";
import { formatCents, registrationWindow } from "@/domain/registration/pricing";
import { requirePermission } from "@/lib/auth/permission";
import { stripeClient } from "@/services/stripe";
import { startCheckout } from "./actions";
import { ConfirmingPayment } from "./confirming";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";

export const metadata: Metadata = { title: "Your season" };

const PAYMENT_MESSAGES: Record<string, string> = {
  off: "Online payment is not set up yet.",
  cancelled: "Payment cancelled. Nothing was charged.",
  failed: "Stripe could not start the payment. Try again in a minute.",
  waiver_first: "Sign the waiver before paying.",
  already_paid: "You have already paid.",
  captain_pays: "Your captain is paying the team fee.",
  no_price: "The league has not set a price for this yet.",
  unknown_code:
    "That promo code doesn't exist. Check the spelling and try again.",
  expired: "That promo code has expired.",
  used_up: "That promo code has been used as many times as it allows.",
};

export default function SeasonPage(props: PageProps<"/app/seasons/[season]">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <Season {...props} />
      </Suspense>
    </main>
  );
}

function Step({
  done,
  title,
  children,
}: {
  done: boolean;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex gap-3 border-b border-border py-3">
      <span
        aria-hidden="true"
        className={done ? "text-success" : "text-text-muted"}
      >
        {done ? "✓" : "○"}
      </span>
      <div className="flex flex-col gap-1">
        <p>
          <strong>{title}</strong>
          <span className="sr-only">{done ? " (done)" : " (to do)"}</span>
        </p>
        {children}
      </div>
    </li>
  );
}

async function Season({
  params,
  searchParams,
}: PageProps<"/app/seasons/[season]">) {
  const { season: slug } = await params;
  const query = await searchParams;
  const subject = await requirePermission("team.register", {
    next: `/app/seasons/${slug}`,
  });
  const league = await currentLeague(db);
  const season = league
    ? await seasonForRegistration(db, league.id, slug)
    : null;
  if (!league || !season) notFound();
  const mine = await myRegistration(db, season.id, subject.userId);
  const now = new Date();

  const header = (
    <header className="flex flex-col gap-1">
      <Link href="/app" className="underline">
        Home
      </Link>
      <h1 className="text-h1">{season.name}</h1>
    </header>
  );
  if (!mine) {
    const window = registrationWindow(season, now);
    return (
      <>
        {header}
        {window === "open" ? (
          <Link
            href={`/app/seasons/${slug}/register`}
            className="btn self-start btn-primary"
          >
            Register for {season.name}
          </Link>
        ) : (
          <p>
            {window === "not_open"
              ? "Registration has not opened yet."
              : "Registration for this season is closed."}
          </p>
        )}
      </>
    );
  }

  const inPool = mine.kind === "free_agent" && !mine.team;
  const [signed, quiz, credit] = await Promise.all([
    hasSignedSeasonWaiver(db, subject.userId, season.id),
    inPool ? myQuiz(db, season.id, subject.userId) : null,
    creditBalance(db, subject.userId),
  ]);
  const owed = amountOwed(season, mine, now);
  const deadline = season.paymentDeadlineAt
    ? new Intl.DateTimeFormat("en-US", {
        dateStyle: "long",
        timeZone: league.timeZone,
      }).format(season.paymentDeadlineAt)
    : null;
  const paid = mine.status === "active";
  const captainPays =
    mine.team?.paymentMode === "full" &&
    mine.team.role !== "captain" &&
    season.feeModel === "per_team";
  const paymentsOn = stripeClient() !== null;
  const paymentMessage =
    typeof query.payment === "string"
      ? PAYMENT_MESSAGES[query.payment]
      : undefined;
  return (
    <>
      {header}
      {query.paid && !paid && <ConfirmingPayment />}
      {query.payment === "covered" && (
        <p role="status" className="rounded-lg border border-success p-3">
          Your promo code or league credit covered the whole fee. Nothing to
          pay.
        </p>
      )}
      {paymentMessage && (
        <p role="alert" className="rounded-lg border border-warning p-3">
          {paymentMessage}
        </p>
      )}
      {(query.registered || query.joined) && (
        <p role="status" className="rounded-lg border border-success p-3">
          {query.joined
            ? `You're on ${mine.team?.teamName ?? "the team"}. Next, sign the waiver.`
            : query.registered === "team"
              ? "Your team is registered. Next, invite your players and sign the waiver."
              : "You're in the free-agent pool. Next, take the one-minute quiz so we can find your team, then sign the waiver."}
        </p>
      )}
      {query.quiz === "saved" && (
        <p role="status" className="rounded-lg border border-success p-3">
          Thanks! Your answers are saved. The league will use them to place you
          on a team.
        </p>
      )}
      <ol className="flex flex-col">
        <Step
          done
          title={
            mine.team
              ? `${mine.team.role === "captain" ? "Captain of" : "Playing for"} ${mine.team.teamName}`
              : "Registered as a free agent"
          }
        >
          {mine.team?.paymentMode === "split" && (
            <p className="text-text-muted">
              Each player pays a fixed {formatCents(mine.team.shareCents ?? 0)}.
            </p>
          )}
          {mine.team && (
            <Link href={`/app/seasons/${slug}/team`} className="underline">
              {mine.team.role === "player"
                ? "See your team"
                : "Invite players and see your roster"}
            </Link>
          )}
        </Step>
        {inPool && (
          <Step done={Boolean(quiz?.answers)} title="Take the team-fit quiz">
            <Link href={`/app/seasons/${slug}/quiz`} className="underline">
              {quiz?.answers
                ? "Change your answers or friend code"
                : "Five quick questions and an optional friend code"}
            </Link>
            {quiz?.code && (
              <p className="text-text-muted">
                {quiz.friends.length === 0
                  ? "Your friend group is waiting for friends to join."
                  : friendsSentence("Staying together with", quiz.friends)}
              </p>
            )}
          </Step>
        )}
        <Step done={signed} title="Sign the waiver">
          {!signed && (
            <Link href={`/app/seasons/${slug}/waiver`} className="underline">
              Read and sign the waiver
            </Link>
          )}
        </Step>
        <Step
          done={paid}
          title={
            paid
              ? "Paid"
              : owed.ok && owed.cents > 0 && !captainPays
                ? `Pay ${formatCents(owed.cents)}`
                : "Payment"
          }
        >
          {paid ? (
            <p className="text-text-muted">
              You&apos;re all set for {season.name}.
            </p>
          ) : !signed ? (
            <p className="text-text-muted">
              Payment opens once you have signed the waiver.
            </p>
          ) : captainPays ? (
            <p className="text-text-muted">
              Your captain is paying the team fee.
            </p>
          ) : !paymentsOn ? (
            <p className="text-text-muted">
              Online payment is not set up yet. The league will let you know
              when it opens.
            </p>
          ) : (
            <form
              action={startCheckout.bind(null, slug)}
              className="flex flex-col gap-2"
            >
              <label className="flex flex-col gap-1 self-start">
                <span className="text-small">Promo code (optional)</span>
                <input
                  name="promoCode"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={24}
                  className="w-48 rounded-md border border-border bg-surface px-2 py-1 uppercase"
                />
              </label>
              {credit > 0 && (
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="useCredit" defaultChecked />
                  Use my {formatCents(credit)} league credit
                </label>
              )}
              <SubmitButton className="btn self-start btn-primary">
                Pay {owed.ok && credit === 0 ? formatCents(owed.cents) : ""}{" "}
                securely with Stripe
              </SubmitButton>
              <span className="text-small text-text-muted">
                Card, Apple Pay or Google Pay.
                {deadline && ` Pay by ${deadline}.`}
              </span>
            </form>
          )}
        </Step>
      </ol>
      {mine.team?.role !== "captain" && (
        <p className="text-text-muted">
          Want to start your own team?{" "}
          <Link href={`/app/seasons/${slug}/new-team`} className="underline">
            Ask the league
          </Link>
        </p>
      )}
    </>
  );
}
