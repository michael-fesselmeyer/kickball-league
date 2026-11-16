// Sets a Lighthouse CI shard's CPU slowdown from this runner's speed, so every
// run measures the same target phone (docs/adr/0079-calibrated-cpu-throttle.md).
//
//   node scripts/lighthouse-calibrate.mjs .lighthouseci/shard.json
//
// It asks Chrome for Lighthouse's own benchmark index five times, takes the
// median, and rewrites only `cpuSlowdownMultiplier` in the shard's config. The
// index and the multiplier are printed so every job log shows them. Run it
// after scripts/lighthouse-shard.mjs and before scripts/lighthouse-run.mjs.
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
  waitForUrl,
  withRetries,
  withSlowdown,
} from "./lighthouse-calibration.mjs";

/** Samples taken; each runs for about a second. */
const SAMPLES = 5;

/** Whole measurements tried, each in a fresh Chrome, before giving up. */
const TRIES = 3;

/** How long Chrome's debugging port may take to open. */
const PORT_TIMEOUT_MS = 15_000;

/** Lighthouse's benchmark index, measured in Chrome as Lighthouse does. */
async function measureIndexes() {
  const chrome = await launch({
    chromeFlags: ["--headless=new", "--no-sandbox"],
  });
  try {
    // Chrome can still be opening its debugging port here.
    await waitForUrl(`http://127.0.0.1:${chrome.port}/json/version`, {
      timeoutMs: PORT_TIMEOUT_MS,
    });
    const browser = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${chrome.port}`,
    });
    const page = await browser.newPage();
    const source = pageFunctions.computeBenchmarkIndex.toString();
    const indexes = [];
    for (let i = 0; i < SAMPLES; i++)
      indexes.push(await page.evaluate(`(${source})()`));
    await browser.disconnect();
    return indexes;
  } finally {
    await chrome.kill();
  }
}

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: node scripts/lighthouse-calibrate.mjs <config>");
    process.exit(2);
  }
  let indexes;
  try {
    indexes = await withRetries(measureIndexes, {
      tries: TRIES,
      delayMs: 2_000,
      onRetry: (error, n) =>
        console.log(
          `Benchmark try ${n} of ${TRIES} failed (${error instanceof Error ? error.message : error}); trying again in a fresh Chrome.`,
        ),
    });
  } catch (error) {
    // Measuring at the config's fixed slowdown would quietly change what the
    // budgets mean, so this shard stops instead.
    console.error(
      `Could not measure this runner's benchmark index: ${error instanceof Error ? error.message : error}. Lighthouse will not run uncalibrated; rerun the job.`,
    );
    process.exit(1);
  }
  const index = medianOf(indexes);
  const slowdown = slowdownFor(index);
  const config = JSON.parse(readFileSync(path, "utf8"));
  const was = config.ci.collect.settings.throttling.cpuSlowdownMultiplier;
  writeFileSync(
    path,
    `${JSON.stringify(withSlowdown(config, slowdown), null, 2)}\n`,
  );

  console.log(`Benchmark index samples: ${indexes.map(Math.round).join(", ")}`);
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

await main();
