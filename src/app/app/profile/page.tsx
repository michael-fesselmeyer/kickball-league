import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { creditBalance, creditHistory } from "@/db/queries/credit";
import { emailSettingsOf } from "@/db/queries/notifications";
import { profileOf } from "@/db/queries/profile";
import { pushSettingsOf } from "@/db/queries/push";
import { existingReferralCode, myReferrals } from "@/db/queries/referrals";
import { currentLeague } from "@/db/queries/seasons";
import { REFERRAL_CREDIT_CENTS } from "@/domain/money/credit";
import { toProfileForm } from "@/domain/profile/profile-form";
import { env } from "@/env";
import { requireSelf } from "@/lib/auth/permission";
import { siteOrigin } from "@/lib/site";
import { CreditSection } from "./credit-section";
import { EmailSettings } from "./email-settings";
import { ProfileSettingsForm } from "./profile-form";
import { PushSettings } from "./push-settings";

export const metadata: Metadata = { title: "Your profile" };

export default function ProfilePage(props: PageProps<"/app/profile">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<p>Loading your profile…</p>}>
        <Profile {...props} />
      </Suspense>
    </main>
  );
}

async function Profile({ searchParams }: PageProps<"/app/profile">) {
  const subject = await requireSelf("profile.edit", "/app/profile");
  const query = await searchParams;
  const publicKey = env.VAPID_PUBLIC_KEY;
  const [profile, emailTopics, push, league, balance, history, code, referrals] =
    await Promise.all([
      profileOf(db, subject.userId),
      emailSettingsOf(db, subject.userId),
      publicKey ? pushSettingsOf(db, subject.userId) : null,
      currentLeague(db),
      creditBalance(db, subject.userId),
      creditHistory(db, subject.userId, 20),
      existingReferralCode(db, subject.userId),
      myReferrals(db, subject.userId),
    ]);
  if (!profile) notFound();
  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href="/app" className="underline">
          Home
        </Link>
        <h1 className="text-h1">Your profile</h1>
        <p className="text-text-muted">
          Signed in as <strong className="text-text">{profile.email}</strong>.
          The league needs these before you register for a season.
        </p>
      </header>
      {query.saved && (
        <p role="status" className="rounded-lg border border-success p-3">
          Saved.
        </p>
      )}
      <ProfileSettingsForm values={toProfileForm(profile)} />
      {query.emails && (
        <p role="status" className="rounded-lg border border-success p-3">
          Email settings saved.
        </p>
      )}
      <EmailSettings topics={emailTopics} />
      {publicKey && push && (
        <PushSettings
          publicKey={publicKey}
          topics={push.topics}
          devices={push.devices}
        />
      )}
      <section aria-labelledby="signing-in" className="flex flex-col gap-3">
        <h2 id="signing-in" className="text-h2">
          Signing in
        </h2>
        <p>
          Add a passkey to sign in with Face ID, Touch ID or your device PIN,
          and see every device you&apos;re signed in on.
        </p>
        <p>
          <Link href="/app/profile/security" className="underline">
            Passkeys and devices
          </Link>
        </p>
      </section>
      <CreditSection
        balanceCents={balance}
        history={history}
        timeZone={league?.timeZone ?? "America/New_York"}
        referralLink={
          code ? `${siteOrigin(env.BETTER_AUTH_URL)}/r/${code}` : null
        }
        referralCents={REFERRAL_CREDIT_CENTS}
        referrals={referrals}
      />
      <section aria-labelledby="your-data" className="flex flex-col gap-3">
        <h2 id="your-data" className="text-h2">
          Your data
        </h2>
        <p>
          Download everything the league holds about you as a JSON file, or
          delete your account.
        </p>
        <p className="flex flex-wrap gap-4">
          <a href="/app/profile/export" download className="underline">
            Download your data (JSON)
          </a>
          <Link href="/app/profile/delete" className="underline">
            Delete your account
          </Link>
        </p>
      </section>
    </>
  );
}
