/**
 * Refreshes src/data/nyc-park-fields.json, the snapshot of NYC Parks fields
 * suited to kickball that the capacity planner suggests (docs/permits/nyc-parks.md).
 *
 * Source: NYC Open Data, "Athletic Facilities" (qnem-b8re) for the fields and
 * "Parks Properties" (enfh-gkve) for park names, both published by NYC Parks
 * and free to read without an app token at this volume. Run it by hand when
 * the data looks stale:
 *
 *   npx tsx scripts/fetch-park-fields.ts
 *
 * The app never calls the API itself; it reads the checked-in snapshot, so
 * the planner costs nothing and works when the API is down.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const API = "https://data.cityofnewyork.us/resource";
const FACILITIES = "qnem-b8re";
const PROPERTIES = "enfh-gkve";

/** Surfaces a kickball game can be played on. */
const PLAYABLE = /^(natural|synthetic|clay)/i;

type Facility = {
  system: string;
  gispropnum?: string;
  borough?: string;
  featurestatus?: string;
  primary_sport?: string;
  surface_type?: string;
  field_lighted?: boolean;
  dimensions?: string;
  kickball?: boolean;
  adult_softball?: boolean;
  adult_baseball?: boolean;
  ll_softball?: boolean;
  ll_baseb_12andunder?: boolean;
  ll_baseb_13andolder?: boolean;
  t_ball?: boolean;
  regulation_soccer?: boolean;
  adult_football?: boolean;
  multipolygon?: { coordinates: number[][][][] };
};

async function get<T>(dataset: string, params: Record<string, string>) {
  const url = `${API}/${dataset}.json?${new URLSearchParams(params)}`;
  const response = await fetch(url, {
    headers: { "user-agent": "league-capacity-planner" },
  });
  if (!response.ok) throw new Error(`${dataset}: HTTP ${response.status}`);
  return (await response.json()) as T[];
}

/** The mean of the outer ring's points: close enough to place a field. */
function centre(shape: Facility["multipolygon"]): [number, number] | null {
  const ring = shape?.coordinates[0]?.[0];
  if (!ring || ring.length === 0) return null;
  const points = ring.slice(0, -1).length > 0 ? ring.slice(0, -1) : ring;
  const lng = points.reduce((s, p) => s + (p[0] ?? 0), 0) / points.length;
  const lat = points.reduce((s, p) => s + (p[1] ?? 0), 0) / points.length;
  return [Number(lat.toFixed(5)), Number(lng.toFixed(5))];
}

async function main() {
  const [facilities, properties] = await Promise.all([
    get<Facility>(FACILITIES, {
      $where: "featurestatus = 'Active'",
      $limit: "20000",
    }),
    get<{ gispropnum: string; signname?: string }>(PROPERTIES, {
      $select: "gispropnum,signname",
      $limit: "20000",
    }),
  ]);
  const parkName = new Map(
    properties.flatMap((p) => (p.signname ? [[p.gispropnum, p.signname]] : [])),
  );

  const fields = facilities.flatMap((f) => {
    if (!PLAYABLE.test(f.surface_type ?? "")) return [];
    const diamond = Boolean(
      f.adult_softball ||
      f.adult_baseball ||
      f.ll_softball ||
      f.ll_baseb_12andunder ||
      f.ll_baseb_13andolder ||
      f.t_ball ||
      f.primary_sport === "SFB" ||
      f.primary_sport === "BSB",
    );
    const large = Boolean(
      f.regulation_soccer ||
      f.adult_football ||
      /large\/full/i.test(f.surface_type ?? ""),
    );
    if (!diamond && !large && !f.kickball) return [];
    const at = centre(f.multipolygon);
    const park = f.gispropnum ? parkName.get(f.gispropnum) : undefined;
    if (!at || !park || !f.borough) return [];
    return [
      {
        id: f.system,
        park,
        borough: f.borough,
        kind: diamond ? "diamond" : "large",
        kickball: Boolean(f.kickball),
        adult: Boolean(f.adult_softball || f.adult_baseball || f.kickball),
        surface: f.surface_type ?? "",
        lit: Boolean(f.field_lighted),
        lat: at[0],
        lng: at[1],
      },
    ];
  });
  fields.sort((a, b) => a.id.localeCompare(b.id));

  const out = {
    source:
      "NYC Open Data: Athletic Facilities (qnem-b8re) and Parks Properties (enfh-gkve), NYC Department of Parks and Recreation",
    sourceUrl:
      "https://data.cityofnewyork.us/dataset/Athletic-Facilities/qnem-b8re",
    fetchedOn: new Date().toISOString().slice(0, 10),
    fields,
  };
  const path = join(process.cwd(), "src/data/nyc-park-fields.json");
  writeFileSync(path, `${JSON.stringify(out, null, 0)}\n`);
  console.log(`${fields.length} fields written to ${path}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
