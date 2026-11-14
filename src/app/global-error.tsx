"use client";

import "./globals.css";

/**
 * The last resort, when even the page frame fails. It brings its own
 * document, so it stays plain; like the page-level error, it only tries
 * again when asked.
 */
export default function GlobalError({
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body className="bg-bg text-text">
        <title>Something went wrong · Kickball League</title>
        <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-16">
          <h1 className="text-h1">That didn&apos;t load</h1>
          <p>
            Something on our side went wrong, and it&apos;s usually over in a
            minute.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            className="inline-flex min-h-11 items-center self-start rounded-full border-2 border-text bg-brand px-5 font-bold text-on-brand"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
