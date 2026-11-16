import { type SQL, sql } from "drizzle-orm";
import type { Db } from "@/db/queries/schedule";
import { localDate } from "@/domain/scheduler/slots";
import { localTime, zonedInstant } from "@/domain/time/zoned";

/**
 * Keeps the demo current (#317). The seed is written on a fixed calendar,
 * so `npm run seed` and the end-to-end tests stay the same every day; but on
 * the demo, a season played Sep 15 to Oct 27, 2026 has nothing coming up by
 * November. After each nightly reset, `npm run demo:reset` moves the whole
 * seeded league forward by whole weeks, so the in-progress season's next
 * game day is the coming one. Whole weeks keep every weekday; instants move
 * by local wall-clock time in the league's time zone, so an 8 pm game stays
 * at 8 pm across a daylight-saving change. Season names don't change.
 *
 * Left as they are:
 * - `created_at` and `updated_at`, the records' own history;
 * - anything the seed wrote with the clock while it ran (between `ranFrom`
 *   and `ranTo`), such as a schedule's publish time;
 * - tables the seed already dates from now (award polls and votes), and
 *   tables that aren't league data (sign-in, push devices, the outbox, the
 *   audit log, webhooks, Instagram tokens), and birth dates.
 */

/** Tables whose dates the seed writes relative to now, or that aren't league data. */
const LEFT_ALONE = new Set([
  "award_poll",
  "award_vote",
  "account",
  "session",
  "verification",
  "user",
  "push_subscription",
  "message",
  "audit_log",
  "webhook_event",
  "social_account",
]);

const LEFT_ALONE_COLUMNS = new Set([
  "created_at",
  "updated_at",
  "profile.birth_date",
]);

/** Far enough ahead that nothing real lives there, for the two-step move. */
const PARK_WEEKS = 10_000;
const PARKED_AFTER = "2150-01-01";

/**
 * How many whole weeks to move the league so the in-progress season's
 * first unplayed game day is today or the next one after it. Zero when
 * that day is still ahead, or when no season is being played.
 */
export function weeksToCatchUp(nextGameDay: string, today: string): number {
  const days =
    (Date.parse(`${today}T00:00:00Z`) -
      Date.parse(`${nextGameDay}T00:00:00Z`)) /
    86_400_000;
  return days <= 0 ? 0 : Math.ceil(days / 7);
}

/**
 * The in-progress season's first unplayed game day, as a local date. The
 * whole database moves by one number of weeks, so it follows the default
 * league (the demo's main one): another league seeded on its own calendar,
 * such as the second demo league, must not push the main league's played
 * games into the future. Without a default league in play, the earliest
 * league's day counts.
 */
export async function nextUnplayedGameDay(
  db: Db,
): Promise<{ date: string; timeZone: string } | null> {
  const rows = await rowsOf<{
    starts_at: string | Date | null;
    time_zone: string;
  }>(
    db,
    sql`
    select min(sl.starts_at) as starts_at, l.timezone as time_zone
      from game g
      join season s on s.id = g.season_id
      join league l on l.id = s.league_id
      join slot sl on sl.id = g.slot_id
     where s.status in ('in_progress', 'playoffs')
       and g.status not in ('final', 'forfeit', 'cancelled')
       and sl.status <> 'cancelled'
     group by l.id, l.timezone, l.is_default
     order by l.is_default desc, 1
     limit 1`,
  );
  const row = rows[0];
  if (!row?.starts_at) return null;
  return {
    date: localDate(new Date(row.starts_at), row.time_zone),
    timeZone: row.time_zone,
  };
}

/** An ISO instant moved by whole weeks at the same local time. */
export function shiftInstant(
  iso: string,
  weeks: number,
  timeZone: string,
): string {
  const at = new Date(iso);
  const date = shiftDate(localDate(at, timeZone), weeks);
  const moved = zonedInstant(date, localTime(at, timeZone), timeZone);
  // Keep the seconds and milliseconds, which the local time leaves out.
  return new Date(
    moved.getTime() + (((at.getTime() % 60_000) + 60_000) % 60_000),
  ).toISOString();
}

/** A YYYY-MM-DD date moved by whole weeks. */
export function shiftDate(date: string, weeks: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A record's string field, moved by `move` when it is there. */
const moved = (
  r: Record<string, unknown>,
  key: string,
  move: (value: string) => string,
) => (typeof r[key] === "string" ? { [key]: move(r[key]) } : {});

/**
 * A schedule version's saved scheduler input, moved with the league: its
 * slots' dates and times and its teams' conflict dates.
 */
export function shiftSnapshot(
  snapshot: unknown,
  weeks: number,
  timeZone: string,
): unknown {
  if (!isRecord(snapshot)) return snapshot;
  const day = (d: string) => shiftDate(d, weeks);
  const instant = (i: string) => shiftInstant(i, weeks, timeZone);
  const each = (list: unknown, fn: (r: Record<string, unknown>) => unknown) =>
    Array.isArray(list) ? list.map((r) => (isRecord(r) ? fn(r) : r)) : list;
  return {
    ...snapshot,
    ...("slots" in snapshot && {
      slots: each(snapshot.slots, (slot) => ({
        ...slot,
        ...moved(slot, "date", day),
        ...moved(slot, "startsAt", instant),
        ...moved(slot, "endsAt", instant),
      })),
    }),
    ...("constraints" in snapshot && {
      constraints: each(snapshot.constraints, (c) => ({
        ...c,
        ...moved(c, "date", day),
      })),
    }),
  };
}

/** Reads the rows of a raw query on either database driver. */
async function rowsOf<T>(db: Db, query: SQL): Promise<T[]> {
  const result: unknown = await db.execute(query);
  return (result as { rows?: T[] }).rows ?? [];
}

const ident = (name: string) => sql.raw(`"${name.replaceAll('"', '""')}"`);

/**
 * Moves every league date by `weeks`, leaving out what the module comment
 * lists. Each table's dates move in one statement (so checks such as "ends
 * after it starts" hold throughout), and in two steps, far ahead and then
 * back, so weekly rows never collide with a unique constraint on the way.
 */
export async function shiftSeededDates(
  db: Db,
  input: { weeks: number; timeZone: string; ranFrom: Date; ranTo: Date },
): Promise<number> {
  const { weeks, timeZone, ranFrom, ranTo } = input;
  if (weeks <= 0) return 0;
  const rows = await rowsOf<{
    table_name: string;
    column_name: string;
    data_type: string;
  }>(
    db,
    sql`
    select table_name, column_name, data_type
      from information_schema.columns
     where table_schema = 'public'
       and data_type in ('date', 'timestamp with time zone')
     order by table_name, column_name`,
  );
  const byTable = new Map<string, { column: string; isDate: boolean }[]>();
  for (const r of rows) {
    if (LEFT_ALONE.has(r.table_name)) continue;
    if (LEFT_ALONE_COLUMNS.has(r.column_name)) continue;
    if (LEFT_ALONE_COLUMNS.has(`${r.table_name}.${r.column_name}`)) continue;
    byTable.set(r.table_name, [
      ...(byTable.get(r.table_name) ?? []),
      { column: r.column_name, isDate: r.data_type === "date" },
    ]);
  }
  const from = ranFrom.toISOString();
  const to = ranTo.toISOString();
  const move = (
    column: string,
    isDate: boolean,
    by: number,
    when: "park" | "back",
  ) => {
    const col = ident(column);
    if (isDate) {
      const cond =
        when === "park"
          ? sql`${col} is not null`
          : sql`${col} >= ${PARKED_AFTER}::date`;
      return sql`${col} = case when ${cond} then ${col} + ${by * 7}::int else ${col} end`;
    }
    const cond =
      when === "park"
        ? sql`${col} is not null and ${col} not between ${from}::timestamptz and ${to}::timestamptz`
        : sql`${col} >= ${PARKED_AFTER}::timestamptz`;
    return sql`${col} = case when ${cond}
      then ((${col} at time zone ${timeZone}) + make_interval(weeks => ${by}::int)) at time zone ${timeZone}
      else ${col} end`;
  };
  for (const [table, columns] of byTable) {
    for (const [by, when] of [
      [PARK_WEEKS, "park"],
      [weeks - PARK_WEEKS, "back"],
    ] as const)
      await db.execute(
        sql`update ${ident(table)} set ${sql.join(
          columns.map((c) => move(c.column, c.isDate, by, when)),
          sql`, `,
        )}`,
      );
  }
  // The saved scheduler input of each schedule version moves too, or the
  // schedule and rain-out screens would still offer the old days.
  const versions = await rowsOf<{ id: string; input_snapshot: unknown }>(
    db,
    sql`select id, input_snapshot from schedule_version`,
  );
  for (const v of versions)
    await db.execute(
      sql`update schedule_version set input_snapshot = ${JSON.stringify(
        shiftSnapshot(v.input_snapshot, weeks, timeZone),
      )}::jsonb where id = ${v.id}`,
    );
  return byTable.size;
}

/** The demo reset's last step: moves the league so its season is current. */
export async function catchUpDemoLeague(
  db: Db,
  { now, ranFrom }: { now: Date; ranFrom: Date },
): Promise<number> {
  const next = await nextUnplayedGameDay(db);
  if (!next) return 0;
  const weeks = weeksToCatchUp(next.date, localDate(now, next.timeZone));
  await shiftSeededDates(db, {
    weeks,
    timeZone: next.timeZone,
    ranFrom,
    ranTo: now,
  });
  return weeks;
}
