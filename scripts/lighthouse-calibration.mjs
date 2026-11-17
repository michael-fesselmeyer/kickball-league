// The pure part of the CPU-throttle calibration (ADR 0077), kept apart from
// scripts/lighthouse-calibrate.mjs so a unit test can run it.

/**
 * The phone the budgets were set for: Lighthouse's 4x CPU slowdown on a
 * runner whose benchmark index was about 3,450 (CI runs of main, 2026-11-15,
 * measured with Lighthouse 13). The target device's own index is therefore
 * 3,450 / 4. A runner's slowdown is its index divided by that, which is
 * Lighthouse's documented way to calibrate the multiplier
 * (https://github.com/GoogleChrome/lighthouse/blob/main/docs/throttling.md).
 * These two numbers define the phone. Never change them to make a page pass.
 */
export const ANCHOR_BENCHMARK_INDEX = 3450;
export const ANCHOR_SLOWDOWN = 4;
export const TARGET_DEVICE_INDEX = ANCHOR_BENCHMARK_INDEX / ANCHOR_SLOWDOWN;

/** Sanity limits: a runner outside them is logged, and measured at the limit. */
export const MIN_SLOWDOWN = 2;
export const MAX_SLOWDOWN = 6;

/**
 * Whether a runner is too slow to measure the target phone at all: slower
 * than the phone itself, so no slowdown (even none) can reproduce it, and
 * a shard on it runs out its time limit without a meaningful result.
 */
export function tooSlowToMeasure(benchmarkIndex) {
  return benchmarkIndex < TARGET_DEVICE_INDEX;
}

/** The middle value of a list of numbers (the mean of the middle two). */
export function medianOf(values) {
  if (values.length === 0) throw new Error("No benchmark samples.");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The CPU slowdown that makes a runner with this benchmark index behave like
 * the target phone, to two decimals, within the sanity limits.
 */
export function slowdownFor(benchmarkIndex) {
  if (!Number.isFinite(benchmarkIndex) || benchmarkIndex <= 0)
    throw new Error(`Not a benchmark index: ${benchmarkIndex}`);
  const raw = benchmarkIndex / TARGET_DEVICE_INDEX;
  return (
    Math.round(Math.min(MAX_SLOWDOWN, Math.max(MIN_SLOWDOWN, raw)) * 100) / 100
  );
}

/**
 * A copy of a Lighthouse CI config with only the CPU slowdown replaced.
 * Every page, run count, other setting and assertion is carried over as is.
 */
export function withSlowdown(config, slowdown) {
  const settings = config.ci.collect.settings;
  return {
    ...config,
    ci: {
      ...config.ci,
      collect: {
        ...config.ci.collect,
        settings: {
          ...settings,
          throttling: {
            ...settings.throttling,
            cpuSlowdownMultiplier: slowdown,
          },
        },
      },
    },
  };
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A readable reason for a failure. Some errors arrive with an empty message,
 * which logged as "failed ()"; their name or text is used instead.
 */
export function reasonOf(error) {
  if (error instanceof Error)
    return error.message || error.name || "unknown error";
  const text = String(error ?? "");
  return text || "unknown error";
}

/**
 * Runs `attempt` until it succeeds, at most `tries` times, waiting `delayMs`
 * between tries. If every try fails, throws one error that lists them all,
 * so a caller can stop loudly instead of carrying on without a result.
 */
export async function withRetries(
  attempt,
  { tries, delayMs = 0, onRetry = () => {}, sleep = pause },
) {
  const errors = [];
  for (let n = 1; n <= tries; n++) {
    try {
      return await attempt(n);
    } catch (error) {
      errors.push(error);
      if (n < tries) {
        onRetry(error, n);
        await sleep(delayMs);
      }
    }
  }
  const reasons = errors
    .map((e, i) => `try ${i + 1}: ${reasonOf(e)}`)
    .join("; ");
  throw new AggregateError(errors, `Failed ${tries} times (${reasons})`);
}

/**
 * Waits until `url` answers with a success status, asking every
 * `intervalMs`, and throws once `timeoutMs` has passed without one. Chrome's
 * debugging port can open a moment after Chrome starts.
 */
export async function waitForUrl(
  url,
  {
    timeoutMs,
    intervalMs = 100,
    fetchUrl = (u) => fetch(u),
    now = () => Date.now(),
    sleep = pause,
  },
) {
  const deadline = now() + timeoutMs;
  let last = "no answer";
  for (;;) {
    try {
      const response = await fetchUrl(url);
      if (response.ok) return;
      last = `status ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    if (now() >= deadline)
      throw new Error(`${url} did not answer within ${timeoutMs} ms (${last})`);
    await sleep(intervalMs);
  }
}

/**
 * The samples left once the first `warmup` are dropped. The first benchmark
 * in a fresh Chrome often reads far lower than the rest (429 then about
 * 3,450 on one runner), because Chrome is still starting up, not because the
 * runner is slow (ADR 0097).
 */
export function afterWarmup(samples, warmup) {
  if (samples.length <= warmup)
    throw new Error(
      `Only ${samples.length} benchmark samples; ${warmup} are warm-up.`,
    );
  return samples.slice(warmup);
}

/**
 * Settles with `promise`, or rejects with `message` once `ms` have passed.
 * Calls `onTimeout` first, so a caller can close what the promise was
 * waiting on. The timer never keeps the process alive.
 */
export function withTimeout(
  promise,
  ms,
  message,
  {
    onTimeout = () => {},
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = {},
) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimer(() => {
      onTimeout();
      reject(new Error(message));
    }, ms);
    timer?.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimer(timer));
}
