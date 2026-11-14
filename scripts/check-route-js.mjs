/**
 * Checks every route's first-load JavaScript against the budgets in
 * docs/design-system.md (Performance budgets), from the last `next build`.
 *
 *   npm run build && npm run check:route-js
 *
 * Lighthouse CI measures the public pages it can load; this covers every
 * route, signed-in screens included. A route's first load is the framework's
 * root files plus the chunks its client reference manifest lists for each of
 * its segments (layouts and page). Lazily loaded chunks, such as the schedule
 * board's, are not part of it. Sizes are gzipped, as `next start` and the
 * CDN serve them, and match Lighthouse's transfer sizes to within the
 * response headers.
 *
 * "Route-specific" is what a route adds to the code every route shares (the
 * root files and the root layout's chunks).
 */
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const KIB = 1024;

/** The budget table in docs/design-system.md, in kB (KiB), first match wins. */
const GROUPS = [
  {
    name: "Admin schedule board",
    total: 295,
    own: 155,
    match: (r) => r === "/app/admin/seasons/[season]/schedule",
  },
  {
    name: "Score entry",
    total: 185,
    own: 45,
    match: (r) => /^\/app\/games\/\[game\]\/(score|live)$/.test(r),
  },
  {
    name: "Admin",
    total: 235,
    own: 95,
    match: (r) => /^\/(app\/(admin|owner|books)|operator)(\/|$)/.test(r),
  },
  {
    name: "Signed-in player and captain",
    total: 215,
    own: 75,
    match: (r) => r === "/app" || r.startsWith("/app/"),
  },
  {
    name: "Public data",
    total: 185,
    own: 45,
    match: (r) =>
      /^\/(seasons|teams|games|events|sponsors|records|history|friends)(\/|$)/.test(
        r,
      ),
  },
  { name: "Marketing and content", total: 165, own: 25, match: () => true },
];

const dir = process.argv[2] ?? ".next";
const build = JSON.parse(
  readFileSync(join(dir, "build-manifest.json"), "utf8"),
);
const require = createRequire(import.meta.url);

const sizes = new Map();
function gzipped(file) {
  if (!sizes.has(file)) {
    sizes.set(file, gzipSync(readFileSync(join(dir, file))).length);
  }
  return sizes.get(file);
}

/** Every route's first-load chunks, from its client reference manifest. */
function routes() {
  const found = [];
  const walk = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name === "page_client-reference-manifest.js") {
        globalThis.__RSC_MANIFEST = {};
        require(resolve(path));
        for (const [key, manifest] of Object.entries(
          globalThis.__RSC_MANIFEST,
        )) {
          const route = key.replace(/\/page$/, "") || "/";
          if (route.startsWith("/_")) continue;
          found.push({ route, segments: manifest.entryJSFiles });
        }
      }
    }
  };
  walk(join(dir, "server", "app"));
  return found.sort((a, b) => a.route.localeCompare(b.route));
}

const all = routes();
if (all.length === 0) {
  console.error(`No routes found under ${dir}. Run \`npm run build\` first.`);
  process.exit(1);
}

const rootLayout = all[0].segments["[project]/src/app/layout"] ?? [];
const shared = new Set([...build.rootMainFiles, ...rootLayout]);
const sum = (files) => [...files].reduce((n, f) => n + gzipped(f), 0);
const sharedSize = sum(shared);

const kib = (bytes) => (bytes / KIB).toFixed(1).padStart(6);
const misses = [];
console.log(
  `Shared by every route: ${kib(sharedSize).trim()} kB\n\n  total    own  budget       route`,
);
for (const { route, segments } of all) {
  const files = new Set(shared);
  for (const chunks of Object.values(segments)) {
    for (const chunk of chunks) files.add(chunk);
  }
  const total = sum(files);
  const own = total - sharedSize;
  const group = GROUPS.find((g) => g.match(route));
  const over = total > group.total * KIB || own > group.own * KIB;
  if (over) misses.push({ route, total, own, group });
  console.log(
    `${kib(total)} ${kib(own)}  ${String(group.total).padStart(3)}/${String(group.own).padEnd(3)} ${over ? "✘" : " "} ${route}`,
  );
}

if (misses.length > 0) {
  console.error(`\n${misses.length} route(s) over budget:`);
  for (const { route, total, own, group } of misses) {
    console.error(
      `  ${route}: ${kib(total).trim()} kB total (budget ${group.total}), ${kib(own).trim()} kB own (budget ${group.own}), ${group.name}`,
    );
  }
  process.exit(1);
}
console.log(`\nEvery route is within its budget (${all.length} routes).`);
