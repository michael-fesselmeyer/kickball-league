import Link from "next/link";
import { db } from "@/db/client";
import { dayGear } from "@/db/queries/equipment";
import type { LeagueId } from "@/domain/ids";
import { kickoff } from "@/domain/schedule/format";

/**
 * The day's league gear on the command center (issue #286): each kit, who
 * brings it to which field by when, and whether they have it yet. Read once
 * per page load; the games above refresh on their own.
 */
export async function DayGear({
  leagueId,
  date,
  timeZone,
}: {
  leagueId: LeagueId;
  date: string;
  timeZone: string;
}) {
  const rows = await dayGear(db, leagueId, date, new Date());
  return (
    <section aria-labelledby="day-gear" className="flex flex-col gap-2">
      <h2 id="day-gear" className="text-h2">
        Gear
      </h2>
      {rows.length === 0 ? (
        <p className="text-text-muted">
          No kits assigned for this day.{" "}
          <Link href="/app/admin/equipment" className="underline">
            Assign one
          </Link>
        </p>
      ) : (
        <ul>
          {rows.map((r) => (
            <li
              key={`${r.kitId}-${r.gameId}`}
              className="flex flex-col gap-1 border-t border-border py-2"
            >
              <Link
                href={`/app/admin/equipment/${r.kitId}`}
                className="font-bold underline"
              >
                {r.kitName}
              </Link>
              <span>
                {r.bringerName} brings it to {r.place} by{" "}
                {kickoff(r.bringBy, timeZone)}
              </span>
              <span
                className={
                  r.ready ? "text-small text-success" : "text-small font-bold"
                }
              >
                {r.ready
                  ? `${r.bringerName} has it`
                  : r.pendingToName
                    ? `On its way to ${r.pendingToName}`
                    : r.holderName
                      ? `Still with ${r.holderName}`
                      : "Still at its home"}
                {r.openReports > 0 &&
                  ` · ${r.openReports === 1 ? "1 missing-items report" : `${r.openReports} missing-items reports`}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
