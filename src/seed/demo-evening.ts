import { localDate } from "@/domain/scheduler/slots";
import { localTime, zonedInstant } from "@/domain/time/zoned";

const MINUTE = 60_000;
/** The live game started this long before the demo's clock: a few innings in. */
export const STARTED_AGO = 40 * MINUTE;
/** Between these local times, the live game simply started 40 minutes ago. */
const EVENING_FROM = 18 * 60;
const EVENING_TO = 22 * 60 + 30;
/**
 * Outside them, tonight's kickoff: 8 pm, the seeded league's own first
 * kickoff (after the shared-field soccer club's 6 to 8 pm), or 9:50 pm late
 * at night.
 */
const DEFAULT_KICKOFF = "20:00";
const LATE_KICKOFF = "21:50";

/**
 * When the demo's live game kicked off, and the clock the rest of the demo
 * step reads as "now" (STARTED_AGO later), in the league's time zone.
 * Always an evening game on today's local date, whenever the demo was built:
 * - 6 pm to 10:30 pm: 40 minutes before now, on a five-minute mark, so the
 *   clock is the real one;
 * - after 10:30 pm: 9:50 pm, so the game is still tonight's;
 * - before 6 pm (a build overnight or in the day): 8 pm tonight, ready for
 *   an evening demo, instead of a game in the small hours.
 */
export function gameNight(
  now: Date,
  timeZone: string,
): { kickoff: Date; clock: Date } {
  const [h = 0, m = 0] = localTime(now, timeZone).split(":").map(Number);
  const minutes = h * 60 + m;
  if (minutes >= EVENING_FROM && minutes < EVENING_TO) {
    const step = 5 * MINUTE;
    const kickoff = new Date(
      Math.floor((now.getTime() - STARTED_AGO) / step) * step,
    );
    return { kickoff, clock: now };
  }
  const kickoff = zonedInstant(
    localDate(now, timeZone),
    minutes >= EVENING_TO ? LATE_KICKOFF : DEFAULT_KICKOFF,
    timeZone,
  );
  return { kickoff, clock: new Date(kickoff.getTime() + STARTED_AGO) };
}
