import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SubmitButton } from "@/components/submit-button";
import { env } from "@/env";
import { readUnsubscribeToken, topicLabel } from "@/lib/unsubscribe";
import { unsubscribeAction } from "./actions";

export const metadata: Metadata = {
  title: "Stop these emails",
  robots: { index: false },
};

type Props = PageProps<"/unsubscribe/[token]">;

/**
 * Where an email's "Stop emails about …" link opens. Opening it changes
 * nothing (mail scanners follow links); the button does, without a sign-in,
 * since the signed link is the key (src/lib/unsubscribe.ts).
 */
export default function UnsubscribePage(props: Props) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-10">
      <Suspense fallback={<p className="min-h-40">Loading…</p>}>
        <Unsubscribe {...props} />
      </Suspense>
    </main>
  );
}

async function Unsubscribe({ params, searchParams }: Props) {
  const { token } = await params;
  const done = (await searchParams).done === "1";
  const found = readUnsubscribeToken(env.BETTER_AUTH_SECRET, token);
  if (!found)
    return (
      <>
        <h1 className="text-h1">This link doesn&apos;t work</h1>
        <p>
          It may have been copied only in part. You can choose which emails you
          get in your{" "}
          <Link href="/app/profile#notifications" className="underline">
            email settings
          </Link>
          .
        </p>
      </>
    );
  const label = topicLabel(found.topic).toLowerCase();
  if (done)
    return (
      <>
        <h1 className="text-h1">Done</h1>
        <p role="status">
          You won&apos;t get emails about {label} any more. Changed your mind?
          Turn them back on in your{" "}
          <Link href="/app/profile#notifications" className="underline">
            email settings
          </Link>
          .
        </p>
      </>
    );
  return (
    <>
      <h1 className="text-h1">Stop emails about {label}?</h1>
      <p>
        You&apos;ll stop getting league emails about {label}. Everything else
        stays as it is, and you can turn them back on in your email settings any
        time.
      </p>
      <form action={unsubscribeAction.bind(null, token)}>
        <SubmitButton className="btn btn-primary">
          Stop these emails
        </SubmitButton>
      </form>
    </>
  );
}
