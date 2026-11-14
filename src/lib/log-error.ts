/**
 * What the server logs about an error: its code and a one-line message,
 * never the error object. A failed database query's error carries the
 * query's parameters (an email address, say), and logs outlive the data
 * they mention, so only the cause's code and message go out
 * (docs/security-review.md, L9).
 */
export type LoggedError = { code: string | null; message: string };

const MAX_MESSAGE = 200;

export function loggedError(error: unknown): LoggedError {
  // A failed query wraps the driver's error, whose message holds no values.
  const inner =
    error instanceof Error &&
    error.message.startsWith("Failed query:") &&
    error.cause !== undefined
      ? error.cause
      : error;
  const code =
    typeof inner === "object" &&
    inner !== null &&
    "code" in inner &&
    typeof inner.code === "string"
      ? inner.code
      : null;
  const raw =
    inner instanceof Error
      ? inner.message
      : typeof inner === "string"
        ? inner
        : "Unknown error";
  const firstLine = (raw.split("\n")[0] ?? "")
    .replace(/^Failed query:.*$/, "Failed query")
    .replace(/[^\s@'"<>(),;:]+@[^\s@'"<>(),;:]+/g, "[address]")
    .slice(0, MAX_MESSAGE);
  return { code, message: firstLine };
}

/** `console.error` with the error reduced to its code and message. */
export function logError(context: string, error: unknown, ...ids: string[]) {
  console.error(context, ...ids, loggedError(error));
}
