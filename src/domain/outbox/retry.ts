/**
 * How the outbox retries a message the provider refused or could not take.
 * See docs/architecture.md, section 5 ("The outbox").
 */

/** A message is tried this many times, then left as failed for an admin. */
export const MAX_ATTEMPTS = 5;

/**
 * How long a worker holds a claimed message. A worker that stops mid-send
 * lets the claim lapse, and a later sweep tries again with the same
 * idempotency key, so the provider still delivers it once.
 */
export const CLAIM_MS = 5 * 60_000;

const MINUTE = 60_000;

/** The wait after the nth failed attempt: 1, 4, 16, then 64 minutes. */
export function retryDelayMs(attempts: number): number {
  return MINUTE * 4 ** Math.max(0, attempts - 1);
}

export type AfterFailure =
  { status: "queued"; sendAfter: Date } | { status: "failed" };

/** What happens to a message after its `attempts`th try failed. */
export function afterFailure(attempts: number, now: Date): AfterFailure {
  if (attempts >= MAX_ATTEMPTS) return { status: "failed" };
  return {
    status: "queued",
    sendAfter: new Date(now.getTime() + retryDelayMs(attempts)),
  };
}
