import type { Metadata } from "next";
import { Suspense } from "react";
import { env } from "@/env";
import { isGoogleEnabled } from "@/lib/auth/google";
import { appScheme } from "@/lib/mobile/app-scheme";
import { safeNextPath } from "@/lib/safe-next";
import { signInWithGoogle } from "./actions";
import { GoogleSignIn } from "./google-sign-in";
import { PasskeySignIn } from "./passkey-sign-in";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage({ searchParams }: PageProps<"/[lang]/sign-in">) {
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
