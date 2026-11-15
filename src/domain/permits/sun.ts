import type { Point } from "../capacity/nearby";

/**
 * Sunset, worked out on the server with NOAA's solar position formulas
 * (https://gml.noaa.gov/grad/solcalc/solareqns.PDF), so the fee estimate
 * can count the permitted hours that need field lights without calling a
 * weather or astronomy service. Within about three minutes in New York, which
 * is all an hourly fee needs.
 */

/** Where the estimate falls back to when a park has no coordinates: City Hall. */
export const NEW_YORK: Point = { lat: 40.7128, lng: -74.006 };

const RAD = Math.PI / 180;

/** Sunset on `on` (YYYY-MM-DD) at `at`, or null where the sun doesn't set. */
export function sunset(on: string, at: Point): Date | null {
  const noon = Date.parse(`${on}T12:00:00Z`);
  if (Number.isNaN(noon)) return null;
  const year = new Date(noon).getUTCFullYear();
  const dayOfYear = Math.floor((noon - Date.UTC(year, 0, 1)) / 86_400_000) + 1;
  const daysInYear =
    (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
  const g = ((2 * Math.PI) / daysInYear) * (dayOfYear - 1);
  const equationOfTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(g) -
      0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) -
      0.040849 * Math.sin(2 * g));
  const declination =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);
  const lat = at.lat * RAD;
  const cosHourAngle =
    Math.cos(90.833 * RAD) / (Math.cos(lat) * Math.cos(declination)) -
    Math.tan(lat) * Math.tan(declination);
  if (cosHourAngle < -1 || cosHourAngle > 1) return null;
  const hourAngle = Math.acos(cosHourAngle) / RAD;
  const minutesUtc = 720 - 4 * (at.lng - hourAngle) - equationOfTime;
  return new Date(Date.UTC(year, 0, dayOfYear) + minutesUtc * 60_000);
}
