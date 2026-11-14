import type { Metadata } from "next";
import { Suspense } from "react";
import { env } from "@/env";
import { isGoogleEnabled } from "@/lib/auth/google";
import { safeNextPath } from "@/lib/safe-next";
import { signInWithGoogle } from "./actions";
import { PasskeySignIn } from "./passkey-sign-in";
import { SignInForm } from "./sign-in-form";
import { SubmitButton } from "@/components/submit-button";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-h1">Let&apos;s get you in</h1>
        <p>
          No password to forget. Pop in your email and we&apos;ll send you a
          link that signs you in, or use a passkey you&apos;ve added.
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
}: Pick<PageProps<"/sign-in">, "searchParams">) {
  const { next, google } = await searchParams;
  return (
    <SignInOptions
      next={safeNextPath(next)}
      google={isGoogleEnabled(env)}
      googleError={
        google === "rate_limited" || google === "failed"
          ? GOOGLE_ERRORS[google]
          : undefined
      }
    />
  );
}

const GOOGLE_ERRORS = {
  rate_limited:
    "That's a lot of sign-ins at once. Wait a few seconds, then try again.",
  failed: "We couldn't reach Google just now. Try again, or use an email link.",
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
      {google && <GoogleSignIn next={next} error={googleError} />}
    </>
  );
}

/** A plain form posting to a Server Action: works before JavaScript loads. */
function GoogleSignIn({
  next,
  error,
}: {
  next: string;
  error?: string | undefined;
}) {
  return (
    <form action={signInWithGoogle} className="flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />
      <SubmitButton className="btn btn-secondary">
        Continue with Google
      </SubmitButton>
      {error && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
