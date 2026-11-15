/**
 * Writes the Lighthouse CI config for one shard of the public pages, so CI
 * can audit them on several runners at once (docs/architecture.md, section 11).
 *
 *   node scripts/lighthouse-shard.mjs <shard> <total>   # e.g. 2 7
 *   npx lhci autorun --config=.lighthouseci/shard.json
 *
 * Pages are dealt out by how long they take to measure, so every shard
 * finishes at about the same time: longest first, each to the shard with
 * the least work so far. Every other setting, the five runs per page and
 * every budget assertion, is copied unchanged, so each shard holds its pages
 * to exactly the same budgets. The shard's server warms only the shard's
 * own pages and what they link to.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

/**
 * Seconds one Lighthouse run of a page took on a CI runner, from the
 * reports of a green run on main (2026-11-15). Only the balance matters, so
 * a page not listed here counts as an average one.
 */
const SECONDS_PER_RUN = {
  "/teams/the-big-kicks": 14.8,
  "/seasons/fall-2026/schedule": 13.2,
  "/faq": 13.1,
  "/parks/mccarren-park": 12.9,
  "/history": 12.9,
  "/about": 12.7,
  "/sponsors/the-corner-pocket": 12.7,
  "/seasons/summer-2026/schedule/division/competitive": 11.6,
  "/": 11.6,
  "/seasons/fall-2026/standings": 11.3,
  "/sign-in": 11.2,
  "/seasons/fall-2026/bracket": 11.2,
  "/records": 11.2,
  "/account-deleted": 11.2,
  "/paused": 11.1,
  "/offline": 11.1,
  "/sponsors": 11.1,
  "/free-agents": 11.1,
  "/events/spring-kickoff-bbq-2027-04-10": 11.1,
  "/nyc-kickball-league": 11.1,
  "/style": 11.0,
  "/games/05cd8fa2-c2b9-48d9-b6d4-0d4e3414b25b": 10.3,
  "/friends": 10.3,
  "/events": 10.3,
  "/news/how-to-play-kickball": 10.2,
  "/seasons/fall-2026/money": 10.2,
};
const AVERAGE_SECONDS = 11.5;

const SHARD_CONFIG = ".lighthouseci/shard.json";

/**
 * Splits `urls` into `total` lists of about equal measuring time, longest
 * page first, each to the list with the least time so far (ties to the
 * lower shard). The same input always gives the same split.
 */
export function shardsOf(urls, total) {
  const cost = (url) =>
    SECONDS_PER_RUN[new URL(url).pathname] ?? AVERAGE_SECONDS;
  const shards = Array.from({ length: total }, () => ({ urls: [], time: 0 }));
  const longestFirst = urls
    .map((url, index) => ({ url, index }))
    .sort((a, b) => cost(b.url) - cost(a.url) || a.index - b.index);
  for (const { url } of longestFirst) {
    const lightest = shards.reduce((min, s) => (s.time < min.time ? s : min));
    lightest.urls.push(url);
    lightest.time += cost(url);
  }
  // Each shard measures its pages in the order lighthouserc.json lists them.
  return shards.map((s) =>
    s.urls.sort((a, b) => urls.indexOf(a) - urls.indexOf(b)),
  );
}

function main() {
  const [shard, total] = process.argv.slice(2).map(Number);
  if (
    !Number.isInteger(shard) ||
    !Number.isInteger(total) ||
    total < 1 ||
    shard < 1 ||
    shard > total
  ) {
    console.error(
      "Usage: node scripts/lighthouse-shard.mjs <shard> <total>, with 1 <= shard <= total.",
    );
    process.exit(1);
  }

  const config = JSON.parse(readFileSync("lighthouserc.json", "utf8"));
  const urls = config.ci.collect.url;
  const mine = shardsOf(urls, total)[shard - 1] ?? [];
  if (mine.length === 0) {
    console.error(
      `Shard ${shard} of ${total} has no pages: there are only ${urls.length}.`,
    );
    process.exit(1);
  }

  config.ci.collect.url = mine;
  // The server warms the pages this config lists, not every page.
  config.ci.collect.startServerCommand = `${config.ci.collect.startServerCommand} ${SHARD_CONFIG}`;
  mkdirSync(".lighthouseci", { recursive: true });
  writeFileSync(SHARD_CONFIG, `${JSON.stringify(config, null, 2)}\n`);
  console.log(
    `Lighthouse shard ${shard} of ${total}: ${mine.length} of ${urls.length} pages`,
  );
  for (const url of mine) console.log(`  ${url}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
