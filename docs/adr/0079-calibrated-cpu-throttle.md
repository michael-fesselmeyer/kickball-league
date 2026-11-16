# ADR 0079: A CPU throttle calibrated to the runner

- Status: accepted
- Date: 2026-11-16
- Refines the last decision of [ADR 0028](0028-steady-lighthouse-measurement.md)

## Context

Total blocking time is the one budget that depends on how fast the runner is. Lighthouse's simulated throttling takes the main-thread work it observed and multiplies it by `cpuSlowdownMultiplier`. A runner that is slower than the one the budgets were set on observes longer tasks, so the same page reads as slower.

Every public page runs one start-up task that evaluates the framework's script, and nothing in the site's code changes its length (the framework's script is 137.5 kB of the 138.5 kB a page loads). The FAQ page counts all of that task in its blocking time, where most pages count about half ([#539](https://github.com/michael-fesselmeyer/kickball-league/issues/539)). On `main`'s runs its median ranged from 73 ms on a fast runner to 151 ms on a slow one, against a 150 ms budget, so Lighthouse failed pull requests that never touched the page.

ADR 0028 left the multiplier at a fixed 4x because LCP, the metric it studied, showed no link to the runner's benchmark index. Blocking time does.

## Decision

Measure the target phone the same way on every runner, by calibrating the multiplier to the runner as Lighthouse documents.

- **The phone is defined by two numbers**: 4x slowdown on a runner whose Lighthouse benchmark index is about 3,450, which is what the budgets were set on. The target device's own index is 3,450 / 4 = 862.5.
- **Each Lighthouse shard measures its runner** before it audits: `scripts/lighthouse-calibrate.mjs` asks Chrome for Lighthouse's own benchmark index five times and takes the median, then writes `cpuSlowdownMultiplier = index / 862.5` into the shard's config, rounded to two decimals and held to 2x to 6x. Only that value changes; every page, the five runs, every other setting and every assertion is copied as it was.
- **The index and the multiplier are logged** in every shard's job output, so a result can be read against them.
- **The pure arithmetic** (`scripts/lighthouse-calibration.mjs`) has unit tests, including that putting the original multiplier back reproduces `lighthouserc.json` exactly.
- **The anchor is not a tuning knob.** It moves only if the target phone is changed on purpose, in a pull request that says so. A page that fails after calibration is a slow page, or a runner outside the range, and is reported as that.

## Alternatives considered

- **Raise the blocking-time budget, or make the assertion a warning.** It makes the number mean less on every runner, and the budget is the product's promise to players on phones.
- **Rerun on a slow runner.** The median of five runs is already the rerun; a systematically slow runner fails again, and a pull request waits for luck.
- **Cut the framework's start-up work.** Measured and ruled out: the shared layout adds 1.0 kB, turning off partial prefetching changes nothing, and the chunking options split the same code the browser still evaluates in one task. Serving the reading pages as route handlers with no script would change the product's pages and is a separate decision.
- **Applied (DevTools) throttling.** It slows the real CPU, so it avoids a calibration, but ADR 0028 found it varies more from run to run on shared runners.

## Consequences

- A slow runner is measured at a lower slowdown and a fast one at a higher slowdown, so a page's blocking time no longer depends on which runner it landed on, beyond the noise of five runs.
- `npm run lighthouse` on a laptop still uses the fixed 4x in `lighthouserc.json`; only CI's shards calibrate. A laptop is not the runner the budgets were set on, and the difference is the same as any other runner's.
- The benchmark index itself varies a little from sample to sample, so five samples and the median are used. A runner busy with other work while it is sampled reads slower and is measured gently; the shard runs nothing else during the sample.
- A runner outside 2x to 6x is measured at the limit and says so in the log.
