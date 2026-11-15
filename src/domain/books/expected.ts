import type { ExpenseCategory } from "./ledger";

/**
 * Expected costs (ADR 0059): the owners set a recurring cost once (a
 * permit, insurance, ref pay, a bar deposit) and the books list it for each
 * season or each game day, for an owner to confirm with one tap or skip.
 * Nothing is stored until then: an occurrence is worked out from the
 * season's dates and game days, and confirming it adds an ordinary expense
 * that remembers which occurrence it settled. Pure, so it is tested
 * without a database.
 */

export const CADENCES = ["season", "game_day"] as const;
export type Cadence = (typeof CADENCES)[number];

export const CADENCE_LABELS: Readonly<Record<Cadence, string>> = {
  season: "Each season",
  game_day: "Each game day",
};

export type RecurringCost = {
  id: string;
  label: string;
  category: ExpenseCategory;
  amountCents: number;
  cadence: Cadence;
  /** YYYY-MM-DD: occurrences before this day aren't expected. */
  startsOn: string;
};

export type Occurrence = {
  costId: string;
  label: string;
  category: ExpenseCategory;
  amountCents: number;
  cadence: Cadence;
  /** YYYY-MM-DD: the season's first day, or the game day. */
  dueOn: string;
};

/** "costId|YYYY-MM-DD", the key an occurrence is confirmed or skipped by. */
export const occurrenceKey = (o: { costId: string; dueOn: string }) =>
  `${o.costId}|${o.dueOn}`;

export type ExpectedInput = {
  costs: readonly RecurringCost[];
  season: { startsOn: string; endsOn: string };
  /** The season's game days (YYYY-MM-DD), any order, repeats allowed. */
  gameDays: readonly string[];
  /**
   * Occurrence keys already confirmed or skipped in this season. A season
   * cost settled on any day counts as settled, so moving the season's first
   * day doesn't make it due again.
   */
  settled: ReadonlySet<string>;
  /** YYYY-MM-DD in the league's time zone. */
  today: string;
};

export type Expected = {
  /** Due on or before today and not yet settled, oldest first. */
  due: Occurrence[];
  /** The next unsettled occurrence after today, one per cost. */
  next: Occurrence[];
};

/**
 * A season cost is expected once, on the season's first day, if the
 * season was still running on or after the cost's start. A game-day cost
 * is expected on every game day from its start.
 */
export function expectedCosts(input: ExpectedInput): Expected {
  const days = [...new Set(input.gameDays)].sort();
  const settledCosts = new Set(
    [...input.settled].map((key) => key.slice(0, key.lastIndexOf("|"))),
  );
  const due: Occurrence[] = [];
  const next: Occurrence[] = [];
  for (const cost of input.costs) {
    const dates =
      cost.cadence === "season"
        ? input.season.endsOn >= cost.startsOn && !settledCosts.has(cost.id)
          ? [input.season.startsOn]
          : []
        : days.filter((d) => d >= cost.startsOn);
    let upcoming: Occurrence | null = null;
    for (const dueOn of dates) {
      const o: Occurrence = {
        costId: cost.id,
        label: cost.label,
        category: cost.category,
        amountCents: cost.amountCents,
        cadence: cost.cadence,
        dueOn,
      };
      if (input.settled.has(occurrenceKey(o))) continue;
      if (dueOn <= input.today) due.push(o);
      else if (!upcoming) upcoming = o;
    }
    if (upcoming) next.push(upcoming);
  }
  const order = (a: Occurrence, b: Occurrence) =>
    a.dueOn.localeCompare(b.dueOn) || a.label.localeCompare(b.label);
  return { due: due.sort(order), next: next.sort(order) };
}
