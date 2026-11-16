// Sets a Lighthouse CI shard's CPU slowdown from this runner's speed, so every
// run measures the same target phone (docs/adr/0077-calibrated-cpu-throttle.md).
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
  withSlowdown,
} from "./lighthouse-calibration.mjs";

/** Samples taken; each runs for about a second. */
const SAMPLES = 5;

/** Lighthouse's benchmark index, measured in Chrome as Lighthouse does. */
async function measureIndexes() {
  const chrome = await launch({
    chromeFlags: ["--headless=new", "--no-sandbox"],
  });
  try {
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
  const indexes = await measureIndexes();
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
