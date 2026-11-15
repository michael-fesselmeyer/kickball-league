import { clock, minutesOf } from "@/domain/books/request-sheet";
import type { Pattern, Wanted } from "@/domain/permits/renewal";

/**
 * The renewal screen's changes, read from its query string (an owners-only
 * screen). With no `set=1`, nothing has been changed: the draft renews
 * every pattern as it was held. Row `i` is the season's `i`th pattern:
 * `k<i>` keeps it, `s<i>`/`e<i>` are the hours wanted; `af`, `aw`, `as`
 * and `ae` add a field on a weekday.
 */

type Query = Record<string, string | string[] | undefined>;

const one = (query: Query, name: string) => {
  const value = query[name];
  return typeof value === "string" ? value : undefined;
};

const time = (query: Query, name: string, fallback: string) => {
  const raw = one(query, name);
  const m = raw === undefined ? null : minutesOf(raw);
  return m === null ? fallback : clock(m);
};

export type Added = {
  fieldId: string;
  weekday: number;
  start: string;
  end: string;
} | null;

export function wantedFrom(
  query: Query,
  patterns: readonly Pattern[],
  fields: readonly { id: string; place: string }[],
): { wanted: Wanted[]; changed: boolean; added: Added } {
  const changed = one(query, "set") === "1";
  const wanted: Wanted[] = patterns.flatMap((p, i) =>
    changed && one(query, `k${i}`) !== "on"
      ? []
      : [
          {
            of: p.key,
            fieldId: p.fieldId,
            place: p.place,
            weekday: p.weekday,
            start: changed ? time(query, `s${i}`, p.start) : p.start,
            end: changed ? time(query, `e${i}`, p.end) : p.end,
          },
        ],
  );
  let added: Added = null;
  const field = fields.find((f) => f.id === one(query, "af"));
  const weekday = Number(one(query, "aw"));
  const start = minutesOf(one(query, "as") ?? "");
  const end = minutesOf(one(query, "ae") ?? "");
  if (
    changed &&
    field &&
    Number.isInteger(weekday) &&
    weekday >= 0 &&
    weekday <= 6 &&
    start !== null &&
    end !== null &&
    end > start
  ) {
    added = {
      fieldId: field.id,
      weekday,
      start: clock(start),
      end: clock(end),
    };
    wanted.push({ of: null, place: field.place, ...added });
  }
  return { wanted, changed, added };
}
