import type { Metadata } from "next";
import { Suspense } from "react";
import { env } from "@/env";
import { isGoogleEnabled } from "@/lib/auth/google";
import { safeNextPath } from "@/lib/safe-next";
import { signInWithGoogle } from "./actions";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-h1">Let&apos;s get you in</h1>
        <p>
          No password to forget. Pop in your email and we&apos;ll send you a
          link that signs you in.
        </p>
      </div>
      {/* The destination comes from the request, so it renders at request time. */}
      <Suspense fallback={<SignInForm next="/app" />}>
        <FormForRequest searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function FormForRequest({
  searchParams,
}: Pick<PageProps<"/sign-in">, "searchParams">) {
  const { next } = await searchParams;
  const destination = safeNextPath(next);
  return (
    <>
      <SignInForm next={destination} />
      {isGoogleEnabled(env) && <GoogleSignIn next={destination} />}
    </>
  );
}

/** A plain form posting to a Server Action: works before JavaScript loads. */
function GoogleSignIn({ next }: { next: string }) {
  return (
    <form action={signInWithGoogle} className="flex flex-col gap-3">
      <p className="text-small text-text-muted">or</p>
      <input type="hidden" name="next" value={next} />
      <button type="submit" className="btn btn-secondary">
        Continue with Google
      </button>
    </form>
  );
}
