/**
 * NYC Parks' insurance line (docs/permits/nyc-parks.md, "Insurance"): an
 * applicant with more than 50 permitted hours in a season needs liability
 * insurance naming the City and a notarized broker's certification form,
 * and the portal takes no more applications until they are approved. The
 * owners hear about it while there is still time to get both.
 */

export const INSURANCE_HOURS = 50;

/** From here on the owners are told the line is close. */
export const NEAR_HOURS = 40;

export type HoursLevel = "under" | "near" | "over";

/** Where `minutes` of permitted time stands against the line. */
export function hoursLevel(minutes: number): HoursLevel {
  const hours = minutes / 60;
  if (hours > INSURANCE_HOURS) return "over";
  if (hours >= NEAR_HOURS) return "near";
  return "under";
}

/** Hours with at most one decimal, such as 37.5. */
export function hoursText(minutes: number): string {
  return (Math.round(minutes / 6) / 10).toLocaleString("en-US");
}

/** The windows that count: everything asked for or granted, not the lost. */
export function permittedMinutes(
  windows: readonly { startsAt: Date; endsAt: Date; status: string }[],
): number {
  return windows.reduce(
    (total, w) =>
      w.status === "lost"
        ? total
        : total +
          Math.max(
            0,
            Math.round((w.endsAt.getTime() - w.startsAt.getTime()) / 60_000),
          ),
    0,
  );
}

/**
 * What the season's hours would come to with a request sheet. A sheet with
 * a set number of games each day is the capacity planner's extra request,
 * on top of the permits; any other sheet is the whole season's ask, which
 * the permits already held may cover.
 */
export function minutesWithSheet(
  permitted: number,
  sheet: number,
  extra: boolean,
): number {
  return extra ? permitted + sheet : Math.max(permitted, sheet);
}
