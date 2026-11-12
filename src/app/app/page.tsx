import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { can } from "@/domain/authz/permissions";
import { auth } from "@/lib/auth";
import { currentSubject } from "@/lib/auth/permission";
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
  const isAdmin = can(await currentSubject(), "season.manage", {});
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-h1">You&apos;re in!</h1>
        <p className="text-text-muted">
          Signed in as <strong className="text-text">{name || email}</strong>.
          Your season stuff will live here.
        </p>
      </div>
      {isAdmin && (
        <Link href="/app/admin/seasons" className="btn btn-primary">
          Manage seasons
        </Link>
      )}
      <form action={signOut}>
        <button type="submit" className="btn btn-secondary">
          Sign out
        </button>
      </form>
    </>
  );
}
