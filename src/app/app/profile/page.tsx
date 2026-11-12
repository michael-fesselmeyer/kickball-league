import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { profileOf } from "@/db/queries/profile";
import { toProfileForm } from "@/domain/profile/profile-form";
import { requireSelf } from "@/lib/auth/permission";
import { ProfileSettingsForm } from "./profile-form";

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
  const profile = await profileOf(db, subject.userId);
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
    </>
  );
}
