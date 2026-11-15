// Runs Lighthouse CI on one shard's config, and measures the whole shard
// once more if Lighthouse itself crashed before scoring a page.
//
//   node scripts/lighthouse-run.mjs .lighthouseci/shard.json
//
// Lighthouse sometimes fails to record a page load's trace (NO_NAVSTART,
// issue #423). That run produces no score, so `lhci` stops before checking
// a single budget. Only that case is retried, and only once: the retry
// measures every page five times again and checks every budget, so a page
// that misses a budget fails exactly as before.
import { spawn } from "node:child_process";

/**
 * True when a run crashed during collection: `lhci` prints "Run #N...failed!"
 * for a Lighthouse process that exits with an error, and never reaches the
 * assertions. A budget miss is reported after "Checking assertions" instead.
 */
export function crashedBeforeScoring(output) {
  return (
    /Run #\d+\.\.\.failed!/.test(output) &&
    !output.includes("Checking assertions")
  );
}

function lhci(config) {
  return new Promise((resolve) => {
    let output = "";
    const child = spawn(
      "npm",
      ["run", "--silent", "lighthouse", "--", `--config=${config}`],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    for (const [from, to] of [
      [child.stdout, process.stdout],
      [child.stderr, process.stderr],
    ]) {
      from.on("data", (chunk) => {
        output += chunk;
        to.write(chunk);
      });
    }
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

async function main() {
  const config = process.argv[2];
  if (!config) {
    console.error("Usage: node scripts/lighthouse-run.mjs <config>");
    process.exit(2);
  }
  const first = await lhci(config);
  if (first.code === 0 || !crashedBeforeScoring(first.output)) {
    process.exit(first.code);
  }
  console.log(
    "\nLighthouse crashed before scoring a page, so no budget was checked. " +
      "Measuring every page of this shard again, once.\n",
  );
  // `lhci collect` clears the crashed attempt's reports before measuring.
  const second = await lhci(config);
  process.exit(second.code);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
