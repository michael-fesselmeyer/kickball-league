import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { env } from "@/env";
import { isGoogleEnabled } from "@/lib/auth/google";
import { currentAuthSession } from "@/lib/auth/permission";
import { appScheme } from "@/lib/mobile/app-scheme";
import { safeNextPath } from "@/lib/safe-next";
import { signOut } from "../app/actions";
import { SignOutForm } from "../app/offline-sync";
import { signInWithGoogle } from "./actions";
import { GoogleSignIn } from "./google-sign-in";
import { PasskeySignIn } from "./passkey-sign-in";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage({
  searchParams,
}: PageProps<"/[lang]/sign-in">) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-h1">Let&apos;s get you in</h1>
        <p>
          No password to forget. Pop in your email and we&apos;ll send you a
          link and a code that sign you in, or use a passkey you&apos;ve added.
        </p>
      </div>
      {/* The destination comes from the request, so it renders at request time. */}
      <Suspense fallback={<SignInOptions next="/app" google={false} />}>
        <FormForRequest searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function FormForRequest({
  searchParams,
}: Pick<PageProps<"/[lang]/sign-in">, "searchParams">) {
  const { next, google, app } = await searchParams;
  // The header and footer are static and can't tell who is signed in, so
  // their "Sign in or open the app" lands here either way.
  const session = await currentAuthSession();
  if (session)
    return (
      <SignedIn
        who={session.user.name || session.user.email}
        next={safeNextPath(next)}
      />
    );
  // `app` comes back from the apps' browser sheet (ADR 0077).
  const problem = google ?? app;
  return (
    <SignInOptions
      next={safeNextPath(next)}
      google={isGoogleEnabled(env)}
      googleError={
        problem === "rate_limited" ||
        problem === "failed" ||
        problem === "expired"
          ? GOOGLE_ERRORS[problem]
          : undefined
      }
    />
  );
}

/** Someone already signed in: the way into the app, or out. */
function SignedIn({ who, next }: { who: string; next: string }) {
  return (
    <section
      aria-labelledby="signed-in"
      className="flex flex-col gap-4 rounded-card border-2 border-text bg-surface p-5 shadow-card"
    >
      <h2 id="signed-in" className="text-h3">
        You&apos;re signed in as <span className="break-words">{who}</span>
      </h2>
      <Link href={next} className="btn btn-primary">
        Go to your games
      </Link>
      <div className="flex flex-col gap-2">
        <p className="text-small text-text-muted">
          Not you, or signing in with another account?
        </p>
        <SignOutForm action={signOut} />
      </div>
    </section>
  );
}

const GOOGLE_ERRORS = {
  rate_limited:
    "That's a lot of sign-ins at once. Wait a few seconds, then try again.",
  failed: "We couldn't reach Google just now. Try again, or use an email link.",
  expired:
    "That sign-in took too long or was started somewhere else. Go back to the app and try again.",
} as const;

function SignInOptions({
  next,
  google,
  googleError,
}: {
  next: string;
  google: boolean;
  googleError?: string | undefined;
}) {
  return (
    <>
      <SignInForm next={next} />
      <PasskeySignIn next={next} />
      {google && (
        <GoogleSignIn
          action={signInWithGoogle}
          next={next}
          appScheme={appScheme(env.MOBILE_APP_ID)}
          error={googleError}
        />
      )}
    </>
  );
}
