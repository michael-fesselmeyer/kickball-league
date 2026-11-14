/**
 * Fields worth applying for: NYC Parks fields suited to kickball near the
 * league's parks, from the NYC Open Data snapshot in
 * src/domain/capacity/nyc-park-fields.json (refreshed by scripts/fetch-park-fields.ts).
 */

export type ParkField = {
  /** NYC Parks' facility id, such as B058-ZN03-BASEBALL-1. */
  id: string;
  park: string;
  /** B, M, Q, R or X. */
  borough: string;
  /** A softball or baseball diamond, or a large multi-use field. */
  kind: "diamond" | "large";
  /** NYC Parks lists kickball as a sport it permits there. */
  kickball: boolean;
  /** Adult softball, baseball or kickball can be permitted there. */
  adult: boolean;
  surface: string;
  lit: boolean;
  lat: number;
  lng: number;
};

export type Point = { lat: number; lng: number };

export type Suggestion = ParkField & {
  /** Kilometres to the nearest of the league's parks. */
  km: number;
  /** The field's name within its park, such as "Baseball 1". */
  label: string;
};

const EARTH_KM = 6371;

/** Great-circle distance in kilometres. */
export function distanceKm(a: Point, b: Point): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

const BOROUGHS: Record<string, string> = {
  B: "Brooklyn",
  M: "Manhattan",
  Q: "Queens",
  R: "Staten Island",
  X: "Bronx",
};

export const boroughName = (code: string) => BOROUGHS[code] ?? code;

/** "B058-ZN03-BASEBALL-1" → "Baseball 1". */
export function fieldLabel(id: string): string {
  const parts = id.split("-");
  const last = parts.at(-1) ?? "";
  const number = /^(\d+)([A-Z]*)$/.exec(last);
  const raw = (number ? parts.at(-2) : last) ?? "";
  const sport = raw === "MPPA" ? "MULTIPURPOSE" : raw;
  const name = sport ? sport.charAt(0) + sport.slice(1).toLowerCase() : "Field";
  return number ? `${name} ${Number(number[1])}${number[2]}` : name;
}

/**
 * The nearest suitable fields to any of `from`, nearest first. At the same
 * distance, fields where NYC Parks permits kickball come first. The list
 * stops at `withinKm` and `limit`.
 */
export function nearbyFields(
  fields: readonly ParkField[],
  from: readonly Point[],
  { withinKm = 5, limit = 12 }: { withinKm?: number; limit?: number } = {},
): Suggestion[] {
  if (from.length === 0) return [];
  return fields
    .map((f) => ({
      ...f,
      label: fieldLabel(f.id),
      km: Math.min(...from.map((p) => distanceKm(p, f))),
    }))
    .filter((f) => f.km <= withinKm)
    .sort(
      (a, b) =>
        a.km - b.km ||
        Number(b.kickball) - Number(a.kickball) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, limit);
}

/** Kilometres as a short phrase in miles, the unit NYC Parks uses. */
export function milesText(km: number): string {
  const miles = km / 1.609344;
  return miles < 0.1 ? "under 0.1 mi" : `${miles.toFixed(1)} mi`;
}
