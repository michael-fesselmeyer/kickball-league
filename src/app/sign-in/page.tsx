import type { Metadata } from "next";
import { Suspense } from "react";
import { safeNextPath } from "@/lib/safe-next";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-h1">Sign in</h1>
        <p>
          No password needed. We&apos;ll email you a link that signs you in.
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
  return <SignInForm next={safeNextPath(next)} />;
}
