import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { auth } from "@/lib/auth";
import { signOut } from "./actions";

export const metadata: Metadata = { title: "Home" };

export default function AppHome() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-12">
      <Suspense fallback={<p>Loading your account…</p>}>
        <Account />
      </Suspense>
    </main>
  );
}

async function Account() {
  // proxy.ts only checks that a cookie exists; this verifies the session itself.
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in?next=/app");

  const { name, email } = session.user;
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-h1">You&apos;re signed in</h1>
        <p className="text-text-muted">{name || email}</p>
      </div>
      <form action={signOut}>
        <button
          type="submit"
          className="min-h-11 rounded-input border border-border-strong bg-surface px-4 py-2 font-medium text-text"
        >
          Sign out
        </button>
      </form>
    </>
  );
}
