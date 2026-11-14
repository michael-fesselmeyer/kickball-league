"use client";

import Link from "next/link";
import { ErrorCode } from "@/components/error-code";

/**
 * What a page shows when it fails to load. Plain words, no jokes: say it is
 * not the player's fault and what to do next. The code matches the server
 * log, so an admin can find the cause.
 */
export default function PageError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-16">
      <title>Something went wrong · Kickball League</title>
      <h1 className="text-h1">Something went wrong</h1>
      <p>
        This page didn&apos;t load. It isn&apos;t anything you did. Try again,
        and if it keeps happening, wait a few minutes and reload.
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => retry()}
          className="btn btn-primary"
        >
          Try again
        </button>
        <Link href="/" className="btn btn-secondary">
          Go to the home page
        </Link>
      </div>
      <ErrorCode error={error} />
    </main>
  );
}
