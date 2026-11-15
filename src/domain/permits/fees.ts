import {
  distanceKm,
  fieldLabel,
  type ParkField,
  type Point,
} from "../capacity/nearby";

/**
 * NYC Parks' permit fees for adult leagues (docs/permits/nyc-parks.md,
 * "Fees for adult leagues"), and an estimate of a permit's fee before the
 * owners know it. The estimate is a placeholder for the books: once an
 * owner enters what Parks actually charged, that replaces it.
 */

/** Per hour, in cents, from NYC Parks' fee schedule of November 1, 2024. */
export const ADULT_RATES = {
  synthetic_large: 4100,
  synthetic_multi: 2800,
  grass: 2400,
  hard_top: 2000,
} as const;

/** Added per hour that the field lights are on. */
export const LIGHTS_RATE = 1500;

export type Surface = keyof typeof ADULT_RATES;

export const SURFACE_LABELS: Readonly<Record<Surface, string>> = {
  synthetic_large: "synthetic turf, large or full field",
  synthetic_multi: "synthetic turf, multipurpose",
  grass: "natural grass",
  hard_top: "hard top",
};

/** NYC Open Data's surface names, as in the fields snapshot. */
export function surfaceOf(openData: string): Surface {
  if (openData === "Synthetic - Large/Full") return "synthetic_large";
  if (openData === "Synthetic - Multi") return "synthetic_multi";
  if (/asphalt|hard|concrete/i.test(openData)) return "hard_top";
  return "grass";
}

/** How the estimate knows the surface. */
export type SurfaceBasis =
  /** NYC Parks' data has a field at the league's park with the same name. */
  | "matched"
  /** Every kickball field at the league's park has this surface. */
  | "park"
  /** No field in NYC Parks' data matched; most kickball fields are grass. */
  | "assumed";

export type FieldGuess = {
  surface: Surface;
  basis: SurfaceBasis;
  /** NYC Parks' borough code (B, M, Q, R or X), when the park was found. */
  borough: string | null;
  /** NYC Parks' name for the park, when it was found. */
  park: string | null;
};

/** How far from the league's own pin a park's fields can be and still be it. */
const SAME_PARK_KM = 0.5;

/**
 * What NYC Parks' data says about one of the league's fields: the nearest
 * park to the venue's pin, then the field there whose name matches the
 * league's ("Baseball 2"), else the surface every kickball field there
 * shares, else natural grass, the surface of most kickball fields.
 */
export function guessField(
  fields: readonly ParkField[],
  venue: Point | null,
  fieldName: string,
): FieldGuess {
  const assumed: FieldGuess = {
    surface: "grass",
    basis: "assumed",
    borough: null,
    park: null,
  };
  if (!venue) return assumed;
  let nearest: { field: ParkField; km: number } | null = null;
  for (const f of fields) {
    const km = distanceKm(venue, f);
    if (km <= SAME_PARK_KM && (!nearest || km < nearest.km))
      nearest = { field: f, km };
  }
  if (!nearest) return assumed;
  const park = nearest.field.park;
  const inPark = fields.filter((f) => f.park === park);
  const where = { borough: nearest.field.borough, park };
  const wanted = fieldName.trim().toLowerCase();
  const named = inPark.find((f) => fieldLabel(f.id).toLowerCase() === wanted);
  if (named)
    return { surface: surfaceOf(named.surface), basis: "matched", ...where };
  const kickball = inPark.filter((f) => f.kickball);
  const surfaces = new Set(kickball.map((f) => surfaceOf(f.surface)));
  const [only] = surfaces;
  if (surfaces.size === 1 && only)
    return { surface: only, basis: "park", ...where };
  return { ...assumed, ...where };
}

export type FeeEstimate = {
  minutes: number;
  /** Minutes after sunset, when the field lights are on. */
  litMinutes: number;
  cents: number;
};

/**
 * One window's fee: its hours at the surface's rate, plus the lights fee
 * for the part after sunset. Parks bills by the hour; part hours are
 * charged pro rata here, which is close enough for an estimate.
 */
export function estimateWindow(
  window: { startsAt: Date; endsAt: Date },
  surface: Surface,
  sunsetAt: Date | null,
): FeeEstimate {
  const start = window.startsAt.getTime();
  const end = window.endsAt.getTime();
  const minutes = Math.max(0, Math.round((end - start) / 60_000));
  const dark = sunsetAt ? Math.max(start, sunsetAt.getTime()) : end;
  const litMinutes = Math.max(0, Math.round((end - dark) / 60_000));
  const cents = Math.round(
    (ADULT_RATES[surface] * minutes + LIGHTS_RATE * litMinutes) / 60,
  );
  return { minutes, litMinutes, cents };
}

/** Adds estimates up. */
export function sumEstimates(estimates: readonly FeeEstimate[]): FeeEstimate {
  return estimates.reduce(
    (total, e) => ({
      minutes: total.minutes + e.minutes,
      litMinutes: total.litMinutes + e.litMinutes,
      cents: total.cents + e.cents,
    }),
    { minutes: 0, litMinutes: 0, cents: 0 },
  );
}

/**
 * Fees are due 14 days before the season starts (Rule 2-12, (c)(13)); a
 * permit granted later is due within 3 business days, which the owners
 * learn from Parks itself.
 */
export const FEES_DUE_DAYS_BEFORE = 14;

/** The day the season's permit fees are due, YYYY-MM-DD. */
export function feesDueOn(seasonStartsOn: string): string {
  const at = Date.parse(`${seasonStartsOn}T12:00:00Z`);
  return new Date(at - FEES_DUE_DAYS_BEFORE * 86_400_000)
    .toISOString()
    .slice(0, 10);
}
