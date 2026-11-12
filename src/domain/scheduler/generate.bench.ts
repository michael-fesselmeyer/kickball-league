import { expect, test } from "vitest";
import { generate } from "./generate";
import { league } from "./league.fixture";
import { workedExample } from "./worked-example.fixture";

/**
 * Target (scheduling-algorithm.md, section 10): `generate` returns in under
 * 300 ms for 24 teams over 12 dates, so a schedule can be built inside a
 * request. Run with `npm run bench`; timings depend on the machine, so this
 * is kept out of the CI test run.
 */
const BUDGET_MS = 300;

const largest = league({
  teams: 24,
  fields: 4,
  times: 4,
  dates: 12,
  gamesPerTeamPerDay: 1,
  reservePerDay: 2,
  rounds: 12,
});

test("generate: 24 teams over 12 dates, 4 fields × 4 times", async ({
  bench,
}) => {
  const result = await bench("24 teams, 12 dates", () => {
    generate(largest);
  }).run();
  expect(result.latency.p50).toBeLessThan(BUDGET_MS);
});

test("generate: the worked example, 8 teams over 7 dates", async ({
  bench,
}) => {
  const [example] = workedExample();
  const result = await bench("worked example", () => {
    generate(example);
  }).run();
  expect(result.latency.p50).toBeLessThan(BUDGET_MS);
});
