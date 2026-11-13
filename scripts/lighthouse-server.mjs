/**
 * Starts the production server for Lighthouse CI and warms it before the
 * first measurement (docs/adr/0028-steady-lighthouse-measurement.md).
 *
 *   node scripts/lighthouse-server.mjs <port>
 *
 * lighthouserc.json runs this as its `startServerCommand`. It starts
 * `next start`, then requests every page in the config, the routes those
 * pages link to (as the page's link prefetches will) and the static files
 * they load. Only then does it print the line Lighthouse CI waits for. A
 * production server is warm after its first few visitors; without this,
 * the first page measured on each runner paid the server's start-up cost
 * (a 150–330 ms document and seconds of blocked main thread) in one of its
 * five runs.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

/** Lighthouse CI waits for this exact text (lighthouserc.json). */
const READY_LINE = "Lighthouse server warmed";

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1) {
  console.error("Usage: node scripts/lighthouse-server.mjs <port>");
  process.exit(1);
}
const origin = `http://localhost:${port}`;

const server = spawn("node_modules/.bin/next", ["start", "--port", `${port}`], {
  stdio: ["ignore", "pipe", "inherit"],
});
// Next's own output, marked so its "Ready" line isn't mistaken for READY_LINE.
server.stdout.on("data", (chunk) => {
  for (const line of chunk.toString().split("\n")) {
    if (line.trim()) console.log(`[next] ${line}`);
  }
});
server.on("exit", (code) => {
  console.error(`next start exited with code ${code}`);
  process.exit(code ?? 1);
});
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    server.kill(signal);
    process.exit(0);
  });
}
process.on("exit", () => server.kill());

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      await fetch(origin, { signal: AbortSignal.timeout(2_000) });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`No answer from ${origin} within 60 s`);
}

/** Fetches a URL and reads the whole body, so the server finishes the work. */
async function get(url, headers = {}) {
  const response = await fetch(url, { headers, redirect: "manual" });
  const body = await response.text();
  return { status: response.status, body };
}

const linkPattern = /href="(\/[^"#?]*)"/g;
const assetPattern = /(?:src|href)="(\/_next\/static\/[^"]+)"/g;

/** Same-origin pages and static files a page's HTML points to. */
function referencesIn(html) {
  const links = new Set();
  const assets = new Set();
  for (const [, path] of html.matchAll(linkPattern)) {
    if (!path.startsWith("/_next/") && !path.startsWith("/api/")) {
      links.add(path);
    }
  }
  for (const [, path] of html.matchAll(assetPattern)) assets.add(path);
  return { links, assets };
}

/** Runs `task` over `items`, `limit` at a time. */
async function each(items, limit, task) {
  const queue = [...items];
  const workers = Array.from({ length: limit }, async () => {
    while (queue.length > 0) await task(queue.shift());
  });
  await Promise.all(workers);
}

async function warm() {
  const config = JSON.parse(readFileSync("lighthouserc.json", "utf8"));
  const pages = config.ci.collect.url.map((url) => new URL(url).pathname);
  const links = new Set();
  const assets = new Set();

  // Every measured page twice: the first visit loads its route, the second
  // is served the way every later visitor's is.
  await each(pages, 4, async (page) => {
    const first = await get(origin + page);
    if (first.status !== 200) {
      throw new Error(`${page} answered ${first.status} while warming`);
    }
    await get(origin + page);
    const found = referencesIn(first.body);
    for (const link of found.links) links.add(link);
    for (const asset of found.assets) assets.add(asset);
  });

  // The routes the pages link to, as their link prefetches request them,
  // so no measured run shares the runner with a cold route's first render.
  await each(links, 4, async (link) => {
    await get(origin + link, { RSC: "1", "Next-Router-Prefetch": "1" });
  });
  await each(assets, 8, (asset) => get(origin + asset));

  return { pages: pages.length, links: links.size, assets: assets.size };
}

await waitForServer();
const started = Date.now();
const warmed = await warm();
console.log(
  `${READY_LINE}: ${warmed.pages} pages, ${warmed.links} linked routes and ${warmed.assets} static files in ${Date.now() - started} ms`,
);
