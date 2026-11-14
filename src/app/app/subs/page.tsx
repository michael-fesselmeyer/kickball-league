import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { db } from "@/db/client";
import { type OpenRequest, subRequestsFor } from "@/db/queries/subs";
import { describeSpots } from "@/domain/subs/eligibility";
import { requirePermission } from "@/lib/auth/permission";
import { claimAction, withdrawAction } from "./actions";
import { requireFeature } from "@/lib/platform/site";
import { PageLoading } from "@/components/page-loading";

export const metadata: Metadata = { title: "Sub for a team" };

export default function SubsPage(props: PageProps<"/app/subs">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading sub requests…</PageLoading>}>
        <Subs {...props} />
      </Suspense>
    </main>
  );
}

/** Messages by error code; an unknown code from the URL finds nothing. */
const ERRORS: Record<string, string> = {
  full: "Every spot you could take is held. Keep an eye out: a spot opens if someone drops out.",
  closed: "That request is closed.",
  not_found: "That request is gone.",
  already_claimed: "You're already on that one.",
  declined_before: "The captain already passed on your offer for that game.",
  not_registered: "Register for the season to sub.",
  waiver_unsigned: "Sign this season's waiver first.",
  suspended: "You're suspended, so you can't sub until it's served.",
  plays_in_game: "You play in that game already.",
  busy: "You're playing or reffing at that time.",
};

const NOTICES: Record<string, string> = {
  claimed:
    "You're holding a spot. The captain confirms, and you'll get an email.",
  withdrawn: "You've dropped out. The captain has been told.",
};

/** Why a player cannot take a spot, in their words. */
const BLOCKED: Record<NonNullable<OpenRequest["blocked"]>, string> = {
  full: "The spots left are taken or reserved for another fielding group.",
  not_registered: "Register for this season to sub.",
  waiver_unsigned: "Sign this season's waiver to sub.",
  suspended: "You're suspended, so you can't sub until it's served.",
  plays_in_game: "You play in this game.",
  busy: "You're playing or reffing at that time.",
};

function RequestCard({ r }: { r: OpenRequest }) {
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-4">
      <div className="flex flex-col">
        <strong>
          {r.team} needs {describeSpots(r.spots)}
        </strong>
        <span className="text-text-muted">
          {r.game.teamNames[0]} vs {r.game.teamNames[1]} · {r.game.when}
        </span>
      </div>
      {r.note && <p>“{r.note}”</p>}
      {r.mine === "approved" ? (
        <>
          <p className="font-bold text-success">
            You&apos;re playing! See you at the field.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={`/games/${r.game.id}`}
              className="inline-flex min-h-11 items-center underline"
            >
              Game details
              <span className="sr-only">
                : {r.game.teamNames[0]} vs {r.game.teamNames[1]}
              </span>
            </Link>
            <form action={withdrawAction.bind(null, r.id)}>
              <button
                type="submit"
                className="inline-flex min-h-11 items-center underline"
              >
                I can&apos;t make it
                <span className="sr-only">
                  : {r.team}, {r.game.when}
                </span>
              </button>
            </form>
          </div>
        </>
      ) : r.mine === "pending" ? (
        <div className="flex flex-wrap items-center gap-3">
          <p>You&apos;re holding a spot. Waiting for the captain.</p>
          <form action={withdrawAction.bind(null, r.id)}>
            <button
              type="submit"
              className="inline-flex min-h-11 items-center underline"
            >
              Drop out
              <span className="sr-only">
                : {r.team}, {r.game.when}
              </span>
            </button>
          </form>
        </div>
      ) : r.mine === "declined" ? (
        <p className="text-text-muted">The captain has this one covered.</p>
      ) : r.blocked ? (
        <p className="text-text-muted">
          {BLOCKED[r.blocked]}{" "}
          {r.blocked === "waiver_unsigned" && (
            <Link
              href={`/app/seasons/${r.game.seasonSlug}/waiver`}
              className="underline"
            >
              Sign it
            </Link>
          )}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <form action={claimAction.bind(null, r.id)}>
            <button type="submit" className="btn btn-primary">
              I&apos;m in
              <span className="sr-only">
                : {r.team}, {r.game.when}
              </span>
            </button>
          </form>
          <span className="text-small text-text-muted">
            {r.left} {r.left === 1 ? "spot" : "spots"} left
          </span>
        </div>
      )}
    </li>
  );
}

async function Subs({ searchParams }: PageProps<"/app/subs">) {
  await requireFeature("subs");
  const query = await searchParams;
  const subject = await requirePermission("registration.join", {
    next: "/app/subs",
  });
  const requests = await subRequestsFor(db, subject.userId, new Date());
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const notice =
    typeof query.notice === "string" ? NOTICES[query.notice] : undefined;
  const mine = requests.filter(
    (r) => r.mine === "pending" || r.mine === "approved",
  );
  const others = requests.filter(
    (r) => r.mine !== "pending" && r.mine !== "approved",
  );

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link
          href="/app"
          className="inline-flex min-h-11 items-center self-start underline"
        >
          Home
        </Link>
        <h1 className="text-h1">Sub for a team</h1>
        <p className="text-text-muted">
          Teams that are short post here. Tap &quot;I&apos;m in&quot; to hold a
          spot; the captain confirms. You need to be registered this season with
          the waiver signed, and free at that time.
        </p>
      </header>
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-lg border border-success p-3">
          {notice}
        </p>
      )}
      {mine.length > 0 && (
        <section aria-labelledby="yours" className="flex flex-col gap-3">
          <h2 id="yours" className="text-h2">
            Your games as a sub
          </h2>
          <ul className="flex flex-col gap-3">
            {mine.map((r) => (
              <RequestCard key={r.id} r={r} />
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby="open" className="flex flex-col gap-3">
        <h2 id="open" className="text-h2">
          Teams looking for subs
        </h2>
        {others.length === 0 ? (
          <p className="text-text-muted">
            Nobody needs a sub right now.{" "}
            <Link href="/app/profile#notifications" className="underline">
              Turn on sub alerts
            </Link>{" "}
            to hear first.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {others.map((r) => (
              <RequestCard key={r.id} r={r} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
