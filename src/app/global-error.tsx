"use client";

import { ErrorCode } from "@/components/error-code";
import "./globals.css";

/**
 * The last resort, when even the site's frame fails: it replaces the root
 * layout, so it brings its own document. A plain link home reloads the
 * whole site rather than relying on the router that just failed.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-full flex-col">
        <title>Something went wrong · Kickball League</title>
        <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-16">
          <h1 className="text-h1">Something went wrong</h1>
          <p>
            The site didn&apos;t load. It isn&apos;t anything you did. Try
            again, and if it keeps happening, wait a few minutes and reload.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => retry()}
              className="btn btn-primary"
            >
              Try again
            </button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full reload, on purpose */}
            <a href="/" className="btn btn-secondary">
              Go to the home page
            </a>
          </div>
          <ErrorCode error={error} />
        </main>
      </body>
    </html>
  );
}
