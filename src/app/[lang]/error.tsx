"use client";

import Link from "next/link";

/**
 * What a page shows when it fails on the server, most often because the
 * database can't be reached for a moment. Trying again is the player's
 * choice: nothing retries by itself, so an outage never turns into a loop
 * of requests from every open phone.
 */
export default function ErrorPage({
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-16">
      <title>Something went wrong · Kickball League</title>
      <h1 className="text-h1">That didn&apos;t load</h1>
      <p>
        Something on our side went wrong, and it&apos;s usually over in a
        minute. Nothing you did caused it, and anything you saved before is
        still saved.
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() => retry()}
          className="inline-flex min-h-11 items-center rounded-full border-2 border-text bg-brand px-5 font-bold text-on-brand"
        >
          Try again
        </button>
        <Link href="/" className="inline-flex min-h-11 items-center underline">
          Go to the home page
        </Link>
      </div>
    </main>
  );
}
