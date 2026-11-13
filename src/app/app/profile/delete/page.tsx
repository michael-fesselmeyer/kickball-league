import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { deleteBlocker } from "@/db/queries/account";
import { profileOf } from "@/db/queries/profile";
import { isFreshSession, SESSION_FRESH_AGE_SECONDS } from "@/lib/auth/config";
import { requireSelf, sessionSignedInAt } from "@/lib/auth/permission";
import { demoStatus } from "@/lib/demo/guard";
import { deleteAccountAction, sendConfirmLinkAction } from "./actions";

export const metadata: Metadata = { title: "Delete your account" };

export default function DeleteAccountPage(
  props: PageProps<"/app/profile/delete">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<p>Loading…</p>}>
        <DeleteAccount {...props} />
      </Suspense>
    </main>
  );
}

const FRESH_MINUTES = SESSION_FRESH_AGE_SECONDS / 60;

const ERRORS: Record<string, string> = {
  confirm:
    "The email address you typed does not match your account. Nothing was deleted.",
  stale: `Your sign-in is more than ${FRESH_MINUTES} minutes old. Confirm it's you again, then delete. Nothing was deleted.`,
  link: "We couldn't send the link just now. Try again in a minute.",
  demo: "Account deletion is turned off in the demo.",
  captain:
    "You captain a team in a season that is not over. Nothing was deleted.",
  last_owner: "You are the league's only owner. Nothing was deleted.",
  not_found: "We couldn't find your account. Nothing was deleted.",
};

async function DeleteAccount({
  searchParams,
}: PageProps<"/app/profile/delete">) {
  const subject = await requireSelf(
    "data.export_or_delete",
    "/app/profile/delete",
  );
  const query = await searchParams;
  const me = await profileOf(db, subject.userId);
  if (!me) notFound();
  const demo = demoStatus(process.env).on;
  const blocker = await deleteBlocker(db, subject.userId);
  const signedInAt = await sessionSignedInAt();
  const fresh = signedInAt !== null && isFreshSession(signedInAt, new Date());
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href="/app/profile" className="underline">
          Your profile
        </Link>
        <h1 className="text-h1">Delete your account</h1>
      </header>
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}

      <section aria-labelledby="removed" className="flex flex-col gap-2">
        <h2 id="removed" className="text-h2">
          What is deleted
        </h2>
        <ul className="list-disc pl-6">
          <li>
            Your profile: name, phone number, gender, shirt size, birth date and
            emergency contact.
          </li>
          <li>
            Your email address and every way of signing in. You are signed out
            on every device and cannot sign in to this account again.
          </li>
          <li>
            Your game and event RSVPs, email settings and emails waiting to be
            sent. If you had a spot at an event, the next person on its waitlist
            gets it.
          </li>
          <li>
            Your sub offers for games still to come. The captain is told you
            withdrew.
          </li>
        </ul>
      </section>

      <section aria-labelledby="kept" className="flex flex-col gap-2">
        <h2 id="kept" className="text-h2">
          What the league keeps
        </h2>
        <p>
          These records stay so past seasons remain correct. Rosters and
          payments show &ldquo;Deleted account&rdquo; instead of your name.
        </p>
        <ul className="list-disc pl-6">
          <li>
            Your registrations, places on team rosters and past sub games, so
            standings, scores and history stay correct.
          </li>
          <li>Your payments, for the league&apos;s accounts.</li>
          <li>
            Your signed waivers, including the name you typed, the time and the
            device details, which the league may need for legal reasons.
          </li>
          <li>The log of changes made in the app.</li>
        </ul>
        <p>
          Deleting cannot be undone.{" "}
          <a href="/app/profile/export" download className="underline">
            Download your data
          </a>{" "}
          first if you want a copy.
        </p>
      </section>

      <section aria-labelledby="confirm" className="flex flex-col gap-3">
        <h2 id="confirm" className="text-h2">
          Delete
        </h2>
        {demo ? (
          <p>Account deletion is turned off in the demo.</p>
        ) : blocker?.reason === "captain" ? (
          <p>
            You captain {blocker.team} in {blocker.season}, which is not over.
            Hand the team to a new captain before you delete your account. A
            league admin can help.
          </p>
        ) : blocker?.reason === "last_owner" ? (
          <p>
            You are the league&apos;s only owner. Add another owner before you
            delete your account.
          </p>
        ) : !fresh ? (
          <div className="flex flex-col gap-3">
            <p>
              To delete your account, first confirm it&apos;s you. We&apos;ll
              email a sign-in link to <strong>{me.email}</strong>. Open it, and
              it brings you back here. You then have {FRESH_MINUTES} minutes to
              delete.
            </p>
            {query.sent ? (
              <p role="status" className="rounded-lg border border-success p-3">
                Link sent to {me.email}. Open it on this device to continue.
              </p>
            ) : (
              <form action={sendConfirmLinkAction}>
                <button type="submit" className="btn btn-secondary">
                  Email me a sign-in link
                </button>
              </form>
            )}
          </div>
        ) : (
          <form action={deleteAccountAction} className="flex flex-col gap-3">
            <label htmlFor="confirm-email" className="font-medium">
              Type your email address, {me.email}, to confirm
            </label>
            <input
              id="confirm-email"
              name="confirm"
              type="email"
              autoComplete="off"
              required
              className="min-h-11 rounded-input border-2 border-border-strong bg-surface px-3 py-2 text-body text-text"
            />
            <button
              type="submit"
              className="btn self-start border-danger bg-surface text-danger"
            >
              Delete my account
            </button>
          </form>
        )}
      </section>
    </>
  );
}
