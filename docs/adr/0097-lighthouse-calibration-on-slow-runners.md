# 0097. Lighthouse calibration on slow runners

Date: 2026-11-17

## Status

Accepted. Refines [ADR 0079](0079-calibrated-cpu-throttle.md); the budgets, the assertions and the target phone are unchanged.

## Context

Two problems showed up in the Lighthouse shards ([#604](https://github.com/michael-fesselmeyer/kickball-league/issues/604)).

**Slow runners seemed to miss the LCP budget.** Runners whose median benchmark index was near 2,600–2,700 missed LCP on a public page that passed on `main` (the Harbor Cup event page, a game page, `/fields/mccarren-park`, a sponsor page), while runners above about 3,400 passed. The first benchmark sample of a shard was often far below the rest. The question was whether the calibrated CPU slowdown under-corrects slow runners, so that a correction, a band of accepted runners or more runs would fix the measurement.

**The calibrate step could hang.** On run 43943188248 the first try failed with an empty message after it had connected to Chrome. The second try printed its samples, the index and the slowdown, and then the step sat until the job's 15-minute limit. The failed try never closed its DevTools connection, and an open connection keeps Node running after the script's last line.

### What the CI reports show

The calibration logs of 662 shard jobs from 125 CI runs, and the full Lighthouse reports of 89 shards (3,395 page loads in 12 runs) from the most recent runs, were read.

- **The LCP misses are bimodal, not a slow tail.** Each failing page's five runs split into a normal mode (about 0.91–1.07 s) and a slow mode (about 2.4–3.6 s), for example 3,636, 1,061, 3,619, 1,060 and 2,413 ms on the Harbor Cup page (run 44001593927). The calibrated slowdown can't produce that: it scales main-thread work smoothly, and first contentful paint stayed at 1.06 s in every one of those runs.
- **Most slow-mode loads are a real late paint.** In those loads the browser itself painted the largest element after first paint (observed LCP 405–449 ms against observed FCP 142–211 ms), so Lantern, Lighthouse's simulator, rightly charges the page's scripts to LCP. They cluster on the pages whose content sat in a hidden boundary and was revealed by an inline script: the Harbor Cup page (22% of loads), `/fields/mccarren-park` (15%) and `/sponsors` (7%). That is the page defect [#595](https://github.com/michael-fesselmeyer/kickball-league/issues/595) fixes.
- **That late paint happens more on slow runners, because they are slower.** Real late paints were 4.4% of loads on runners calibrated below 2,800 and 1.7% above 3,200. A real phone is slower than any runner, so the slow runners are closer to the players' experience, not further from it.
- **A second, smaller slow mode is a simulation artifact.** In about 2% of loads the element painted with first paint, but the runner's first paint came after the async scripts had run, and Lantern counted them. Its rate is the same on fast and slow runners (1.5% below 2,800, 2.1% above 3,200), and at that rate the median of five runs almost never lands in it.
- **The first benchmark sample is a cold start.** It was the lowest of five in 635 of 662 shards, and below 90% of the others in 547. On run 43943188248 it read 429 against about 3,470 for the rest. The median absorbed most of it (a shift of about 12 points, at most 183), but a cold sample is not a measurement of the runner.

## Decision

1. **Drop a warm-up sample.** The calibration takes six benchmark samples in its fresh Chrome, drops the first, and takes the median of the other five. The log prints all six and says the first was dropped.
2. **Keep the slowdown formula, every runner and five Lighthouse runs.** The data shows no CPU under-correction on slow runners to fit, and the remaining slow-runner misses are a real page behavior that slow hardware makes more likely. The fix for those belongs in the pages (#595), not in the measurement.
3. **Never let calibration hang.**
   - Every Chrome the script starts and every DevTools connection it opens is tracked and closed in `finally`, failed and timed-out tries included, with a hard kill of Chrome's process if closing it doesn't finish.
   - Each try has a 45-second limit; a try past it is closed and counts as a failed try.
   - The script has a hard 3-minute limit of its own. Past it, it closes Chrome, prints "Calibration still running after 180 s, so this runner is stuck … Rerun this job." and exits 1.
   - It always ends with an explicit `process.exit`, so a handle a library leaves open can't keep the step alive.
   - The CI step has `timeout-minutes: 5` as a backstop.
   - A failure with an empty message is logged by its name instead of as "failed ()".

## Alternatives considered

- **Reject runners below a band and ask for a rerun.** About 41% of shards ran on runners with an index below 2,900, so with eight shards nearly every run would fail somewhere. It would also stop measuring on the hardware that most resembles a phone, and hide a page defect that a phone shows.
- **An empirically fitted correction to the slowdown.** There is nothing to fit: the misses are a second mode, not a shifted curve, and a correction that pulled slow-mode loads under the budget would be a relaxed budget on those runners.
- **More Lighthouse runs on slow runners.** The median of more runs is a fairer estimate of a page's median, but on the affected pages the slow mode is a real share of loads, so more runs would add minutes to every slow shard without changing what the budget says about those pages. It stays open if the simulation artifact ever becomes common.
- **Retry a shard that misses a budget.** A best-of-two is a weaker assertion than the budget, which ADR 0079 and AGENTS.md rule out.

## Consequences

- A slow runner is calibrated from warm samples, so its slowdown no longer depends on how long Chrome took to start.
- A page whose content waits on a script to paint still fails, and fails more often on slow runners. The log's per-run values show the two modes, which points at the page.
- The calibrate step finishes in about 15 seconds on a healthy runner and can't take more than 3 minutes; a stuck runner fails with a message that says to rerun it.
