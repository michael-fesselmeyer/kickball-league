/**
 * Writes the Lighthouse CI config for one shard of the public pages, so CI
 * can audit them on several runners at once (docs/architecture.md, section 11).
 *
 *   node scripts/lighthouse-shard.mjs <shard> <total>   # e.g. 2 3
 *   npx lhci autorun --config=.lighthouseci/shard.json
 *
 * The shard gets every page whose position in lighthouserc.json's URL list,
 * counted from 0, leaves remainder <shard> - 1 when divided by <total>. Every
 * other setting, the five runs per page and every budget assertion, is copied
 * unchanged, so each shard holds its pages to exactly the same budgets.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

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
const mine = urls.filter((_, i) => i % total === shard - 1);
if (mine.length === 0) {
  console.error(
    `Shard ${shard} of ${total} has no pages: there are only ${urls.length}.`,
  );
  process.exit(1);
}

config.ci.collect.url = mine;
mkdirSync(".lighthouseci", { recursive: true });
writeFileSync(
  ".lighthouseci/shard.json",
  `${JSON.stringify(config, null, 2)}\n`,
);
console.log(
  `Lighthouse shard ${shard} of ${total}: ${mine.length} of ${urls.length} pages`,
);
for (const url of mine) console.log(`  ${url}`);
