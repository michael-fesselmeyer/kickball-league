import Link from "next/link";
import type { WeekAvailability } from "@/domain/availability/away";

/**
 * Who on a team is available in a game's week, after away weeks. Captains
 * also see who is away, and, when that leaves the team short of a full
 * lineup, a prompt with a one-tap link to ask for a sub.
 */
export function WeekAvailabilityNote({
  week,
  captain,
  subsHref,
  noSubs = "Sub requests aren't open for playoff games.",
}: {
  week: WeekAvailability;
  /** The viewer captains the team, so may see who is away. */
  captain: boolean;
  /** Where to ask for a sub, when sub requests are open for the game. */
  subsHref: string | null;
  /** Why there is no link, when there isn't. */
  noSubs?: string;
}) {
  const away = week.away.length;
  return (
    <div className="flex w-full flex-col gap-1 text-small">
      <p className="text-text-muted">
        {week.available} available that week
        {away > 0 &&
          (captain
            ? ` · away: ${week.away.map((m) => m.name).join(", ")}`
            : ` · ${away} away`)}
      </p>
      {captain && week.short && (
        <p className="rounded-lg border border-warning p-2 text-text">
          Short that week: {week.fielding.message}{" "}
          {subsHref ? (
            <Link href={subsHref} className="font-semibold underline">
              Ask for a sub
            </Link>
          ) : (
            noSubs
          )}
        </p>
      )}
    </div>
  );
}
