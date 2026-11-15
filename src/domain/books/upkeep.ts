/**
 * Keeping the books up to date (ADR 0054): what each person is owed for
 * expenses they paid themselves, and the owners' monthly nudge. Pure.
 */

export type FrontedExpense = {
  id: string;
  paidBy: string;
  amountCents: number;
};

export type Owed = { paidBy: string; cents: number; expenseIds: string[] };

/** Unreimbursed expenses summed per person, most owed first. */
export function owedByPerson(rows: readonly FrontedExpense[]): Owed[] {
  const byPerson = new Map<string, Owed>();
  for (const r of rows) {
    const owed = byPerson.get(r.paidBy) ?? {
      paidBy: r.paidBy,
      cents: 0,
      expenseIds: [],
    };
    owed.cents += r.amountCents;
    owed.expenseIds.push(r.id);
    byPerson.set(r.paidBy, owed);
  }
  return [...byPerson.values()].sort(
    (a, b) => b.cents - a.cents || a.paidBy.localeCompare(b.paidBy),
  );
}

/** The nudge goes out in the first week of a month, once per owner. */
export const NUDGE_DAYS = 7;

/**
 * "YYYY-MM" when today (YYYY-MM-DD, the league's time zone) is in the
 * first week of its month, so a missed daily run still sends that month's
 * nudge; null otherwise.
 */
export function nudgeMonth(today: string): string | null {
  const day = Number(today.slice(8, 10));
  return day >= 1 && day <= NUDGE_DAYS ? today.slice(0, 7) : null;
}

export const nudgeKey = (month: string, userId: string) =>
  `books_nudge:${month}:${userId}`;
