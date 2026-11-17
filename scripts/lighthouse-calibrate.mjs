// Sets a Lighthouse CI shard's CPU slowdown from this runner's speed, so every
// run measures the same target phone (docs/adr/0079-calibrated-cpu-throttle.md).
//
//   node scripts/lighthouse-calibrate.mjs .lighthouseci/shard.json
//
// It asks Chrome for Lighthouse's own benchmark index six times, drops the
// first (warm-up) sample, takes the median of the other five, and rewrites only
// `cpuSlowdownMultiplier` in the shard's config. The samples, the index and the
// multiplier are printed so every job log shows them. Run it after
// scripts/lighthouse-shard.mjs and before scripts/lighthouse-run.mjs.
//
// It closes every Chrome it starts, failed tries included, has a hard time
// limit of its own, and always exits explicitly (ADR 0097).
import { readFileSync, writeFileSync } from "node:fs";
import { launch } from "chrome-launcher";
import { pageFunctions } from "lighthouse/core/lib/page-functions.js";
import puppeteer from "puppeteer-core";
import {
  ANCHOR_BENCHMARK_INDEX,
  ANCHOR_SLOWDOWN,
  MAX_SLOWDOWN,
  MIN_SLOWDOWN,
  medianOf,
  slowdownFor,
  TARGET_DEVICE_INDEX,
  afterWarmup,
  reasonOf,
  tooSlowToMeasure,
  waitForUrl,
  withRetries,
  withSlowdown,
  withTimeout,
} from "./lighthouse-calibration.mjs";

/** Samples kept; each runs for about a second. */
const SAMPLES = 5;

/** Samples taken first and dropped, while a fresh Chrome is still starting. */
const WARMUP = 1;

/** Whole measurements tried, each in a fresh Chrome, before giving up. */
const TRIES = 3;

/** How long Chrome's debugging port may take to open. */
const PORT_TIMEOUT_MS = 15_000;

/** How long one whole try (start Chrome, sample, close it) may take. */
const TRY_TIMEOUT_MS = 45_000;

/**
 * The whole script's limit. A healthy runner finishes in about 15 seconds;
 * past this something is stuck, and the shard stops with a clear message
 * instead of running out the job's time limit.
 */
const WALL_CLOCK_LIMIT_MS = 180_000;

/** Every Chrome this script started that may still be running. */
const chromes = new Set();
/** Every DevTools connection still open; an open one keeps Node alive. */
const browsers = new Set();

/** Closes every connection and Chrome this script opened. Never throws. */
async function closeEverything() {
  for (const browser of browsers) {
    browsers.delete(browser);
    try {
      await withTimeout(browser.disconnect(), 5_000, "disconnect timed out");
    } catch {
      // Chrome is killed next, which ends the connection anyway.
    }
  }
  for (const chrome of chromes) {
    chromes.delete(chrome);
    try {
      await withTimeout(chrome.kill(), 5_000, "kill timed out");
    } catch {
      // Fall through to the hard kill.
    }
    try {
      if (chrome.pid) process.kill(chrome.pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
}

/** Lighthouse's benchmark index, measured in Chrome as Lighthouse does. */
async function measureIndexes() {
  const chrome = await launch({
    chromeFlags: ["--headless=new", "--no-sandbox"],
  });
  chromes.add(chrome);
  try {
    // Chrome can still be opening its debugging port here.
    await waitForUrl(`http://127.0.0.1:${chrome.port}/json/version`, {
      timeoutMs: PORT_TIMEOUT_MS,
    });
    const browser = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${chrome.port}`,
    });
    browsers.add(browser);
    const page = await browser.newPage();
    const source = pageFunctions.computeBenchmarkIndex.toString();
    const indexes = [];
    for (let i = 0; i < WARMUP + SAMPLES; i++)
      indexes.push(await page.evaluate(`(${source})()`));
    return indexes;
  } finally {
    // A failed try closes its Chrome too: a connection left open kept the
    // process alive after it had printed its result (run 43943188248).
    await closeEverything();
  }
}

/** One try, given a time limit; a try that runs out closes its Chrome. */
const measureWithinLimit = () =>
  withTimeout(
    measureIndexes(),
    TRY_TIMEOUT_MS,
    `no benchmark within ${TRY_TIMEOUT_MS / 1000} s`,
    { onTimeout: () => void closeEverything() },
  );

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: node scripts/lighthouse-calibrate.mjs <config>");
    process.exit(2);
  }
  let indexes;
  try {
    indexes = await withRetries(measureWithinLimit, {
      tries: TRIES,
      delayMs: 2_000,
      onRetry: (error, n) =>
        console.log(
          `Benchmark try ${n} of ${TRIES} failed (${reasonOf(error)}); trying again in a fresh Chrome.`,
        ),
    });
  } catch (error) {
    // Measuring at the config's fixed slowdown would quietly change what the
    // budgets mean, so this shard stops instead.
    console.error(
      `Could not measure this runner's benchmark index: ${reasonOf(error)}. Lighthouse will not run uncalibrated; rerun the job.`,
    );
    process.exit(1);
  }
  const kept = afterWarmup(indexes, WARMUP);
  const index = medianOf(kept);
  console.log(
    `Benchmark index samples: ${indexes.map(Math.round).join(", ")} (the first ${WARMUP} is warm-up and dropped).`,
  );
  if (tooSlowToMeasure(index)) {
    // Slower than the phone itself: no slowdown can reproduce it, and the
    // audit would run out the job's time limit (ADR 0079).
    console.error(
      `Runner too slow, rerun this job: its benchmark index is ${Math.round(index)}, below the target phone's ${TARGET_DEVICE_INDEX}, so no CPU slowdown can measure that phone here.`,
    );
    process.exit(1);
  }
  const slowdown = slowdownFor(index);
  const config = JSON.parse(readFileSync(path, "utf8"));
  const was = config.ci.collect.settings.throttling.cpuSlowdownMultiplier;
  writeFileSync(
    path,
    `${JSON.stringify(withSlowdown(config, slowdown), null, 2)}\n`,
  );

  console.log(
    `Benchmark index (median): ${Math.round(index)}; the budgets' phone is ${ANCHOR_SLOWDOWN}x at ${ANCHOR_BENCHMARK_INDEX}.`,
  );
  console.log(
    `CPU slowdown for this runner: ${slowdown}x (was ${was}x in the config).`,
  );
  if (slowdown === MIN_SLOWDOWN || slowdown === MAX_SLOWDOWN)
    console.log(
      `This runner is outside the ${MIN_SLOWDOWN}x to ${MAX_SLOWDOWN}x range; measuring at the limit.`,
    );
}

// The hard limit. The timer doesn't keep the process alive; it only fires
// if something else does, which is exactly the hang it is for.
setTimeout(() => {
  console.error(
    `Calibration still running after ${WALL_CLOCK_LIMIT_MS / 1000} s, so this runner is stuck; closing Chrome and stopping. Rerun this job.`,
  );
  void closeEverything().finally(() => process.exit(1));
}, WALL_CLOCK_LIMIT_MS).unref();

try {
  await main();
} catch (error) {
  console.error(`Calibration failed: ${reasonOf(error)}. Rerun this job.`);
  process.exitCode = 1;
} finally {
  await closeEverything();
}
// Exit even if a library left a handle open.
process.exit(process.exitCode ?? 0);
