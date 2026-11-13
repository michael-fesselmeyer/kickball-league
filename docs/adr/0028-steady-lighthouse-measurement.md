# ADR 0028: Steady Lighthouse measurement

- Status: accepted
- Date: 2026-11-13

## Context

Lighthouse CI failed pages that no change had touched, roughly one workflow run in five, and a re-run passed. Every page is measured five times on a throttled phone profile, and the assertions used Lighthouse CI's `median-run`.

The reports from 29 CI runs (2,435 Lighthouse runs) showed:

- **A page's median LCP never moved.** Across the 29 runs it stayed between 755 and 771 ms on every page and between 909 and 922 ms on the schedule, against a 2,000 ms budget.
- **The failures were single runs.** In about 1.7% of runs, LCP came out near 2.5 s while first contentful paint stayed at 0.76 s. `median-run` doesn't pick the run with the median LCP: it picks the run closest to the median first contentful paint and time to interactive. A run that is normal on those two and an outlier on LCP is often the one it picks. Replaying that rule over the 29 runs gives 6 failing pages in 6 runs.
- **The outlier is a measurement artifact.** In every outlier, the trace's LCP timestamp differs from the FCP timestamp, on ordinary pages by exactly 1 µs. In every normal run they are equal. Lighthouse's simulated LCP reuses the FCP estimate only when the two timestamps are equal and the LCP is text. Otherwise it counts every script that finished loading before the paint, which adds about 1.75 s to a page that painted at the same moment.
- **The first page on each runner paid the server's start-up cost.** Its first run waited 150–330 ms for the document and had 0.5–5 s of blocked main thread (performance score 0.70–0.88). That run was never the median, but it left four useful runs instead of five.
- **The runner's CPU didn't explain anything.** Lighthouse's benchmark index ranged from about 2,400 to 4,200 on warm runs, the outliers fell across that same range, and normal LCP didn't change with it.
- **One page has a real delay.** The schedule page sometimes paints its loading state first and its content about 300 ms later. Its median is within budget, so that's a page fix, not a measurement fix ([#229](https://github.com/michael-fesselmeyer/kickball-league/issues/229)).

## Decision

Measure warm, pin the profile, and assert each metric's own median. Every budget and every assertion level stays exactly as it was.

- **Each metric's median of five runs.** The performance and accessibility scores, LCP, CLS and total blocking time use `"aggregationMethod": "median"`: the middle of the five values for that metric. One odd run out of five can't fail a page, and three slow runs out of five still do.
- **A warm server.** `scripts/lighthouse-server.mjs` starts `next start` and requests every listed page twice, the routes those pages link to (as their link prefetches will) and the static files they load. Only then does it print the line Lighthouse CI waits for. A production server is warm after its first few visitors, so this measures what nearly every visitor gets.
- **A pinned profile.** `lighthouserc.json` sets the form factor, screen and simulated throttling (150 ms round trip, 1.6 Mbps, 4× CPU slowdown) to the values Lighthouse 13 uses by default, so a Lighthouse upgrade can't change the phone being measured without a visible change to this file.
- **No CPU adjustment.** The data shows no link between the runner's speed and the results, so `cpuSlowdownMultiplier` stays fixed rather than tuned to the benchmark index.

## Alternatives considered

- **Keep `median-run` and add runs.** More runs make an outlier less likely to be picked, but not impossible, because the pick still ignores LCP. Each run also adds about 10 s per page.
- **Applied (DevTools) throttling.** It measures real timings on a slowed connection instead of simulating them, which avoids this simulation artifact but varies more from run to run on shared runners.
- **Patch Lighthouse's equality check.** That means maintaining a fork of a dependency for a 1 µs difference that should be fixed upstream.

## Consequences

- An outlier run shows up in the uploaded reports but doesn't fail the check. A page that's slow in most of its runs still fails.
- Lighthouse CI's ready timeout is 120 s, because the warm-up runs before the server reports ready. It takes under a second locally.
- A page added to `lighthouserc.json` is warmed automatically.
