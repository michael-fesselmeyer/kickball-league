import Link from "next/link";
import { db } from "@/db/client";
import { dayFields, fieldChecksOn } from "@/db/queries/game-day-checklist";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { fieldDayWords } from "@/domain/gameday/checklist";
import type { LeagueId } from "@/domain/ids";
import { kickoff } from "@/domain/schedule/format";

/**
 * Each field's game-day checks on the command center (issue #409): whether
 * the set-up lead confirmed set-up, and whether someone confirmed the field
 * was left clean after its last game. Read once per page load.
 */
export async function DayFields({
  leagueId,
  seasonSlug,
  date,
  timeZone,
}: {
  leagueId: LeagueId;
  seasonSlug: string | undefined;
  date: string;
  timeZone: string;
}) {
  const season = seasonSlug
    ? await seasonBySlug(db, leagueId, seasonSlug)
    : null;
  if (!season) return null;
  const [fields, checks] = await Promise.all([
    dayFields(db, season.id, date, timeZone),
    fieldChecksOn(db, season.id, date),
  ]);
  if (fields.length === 0) return null;
  const now = new Date();
  return (
    <section aria-labelledby="day-fields" className="flex flex-col gap-2">
      <h2 id="day-fields" className="text-h2">
        Fields
      </h2>
      <ul>
        {fields.map((f) => {
          const check = checks.get(f.fieldId);
          const words = fieldDayWords(
            {
              setup: check?.setup ?? null,
              close: check?.close ?? null,
              lastGameEndsAt: f.lastEndsAt,
            },
            now,
          );
          const late = !check?.close && now >= f.lastEndsAt;
          return (
            <li
              key={f.fieldId}
              className="flex flex-col gap-1 border-t border-border py-2"
            >
              <strong>
                {f.venueName}, {f.fieldName}
              </strong>
              <span className="text-small text-text-muted">
                {kickoff(f.firstStartsAt, timeZone)} to{" "}
                {kickoff(f.lastEndsAt, timeZone)}
              </span>
              <span
                className={
                  check?.setup?.status === "ok"
                    ? "text-small text-success"
                    : "text-small font-bold"
                }
              >
                {words.setup}
                {check?.setup?.note ? `: ${check.setup.note}` : ""}
              </span>
              <span
                className={
                  check?.close?.status === "ok"
                    ? "text-small text-success"
                    : late || check?.close
                      ? "text-small font-bold"
                      : "text-small text-text-muted"
                }
              >
                {words.close}
                {check?.close?.note ? `: ${check.close.note}` : ""}
                {check?.close?.photoId && (
                  <>
                    {" · "}
                    <Link
                      href={`/app/admin/today/photo/${check.close.photoId}`}
                      className="underline"
                    >
                      Photo
                    </Link>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
