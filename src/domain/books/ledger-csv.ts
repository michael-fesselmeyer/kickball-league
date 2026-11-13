import type { Column } from "../export/csv";
import { CATEGORY_LABELS, type ExpenseCategory } from "./ledger";

/**
 * The season's books as one line per transaction, for the owners' taxes.
 * Pure: the caller passes the season's rows and the league's time zone.
 * Lines carry no player's name or contact, only what the money was for.
 * Written with toCsv, so any text that looks like a formula is defused.
 */

export type LedgerLine = {
  date: string;
  type: "Income" | "Refund" | "Expense";
  category: string;
  description: string;
  amountCents: number;
  receipt: boolean | null;
};

export const LEDGER_COLUMNS: readonly Column<LedgerLine>[] = [
  { header: "Date", value: (l) => l.date },
  { header: "Type", value: (l) => l.type },
  { header: "Category", value: (l) => l.category },
  { header: "Description", value: (l) => l.description },
  // A number, not text: a spreadsheet adds it up, and the formula guard
  // would otherwise mark a negative amount as text.
  { header: "Amount", value: (l) => Math.round(l.amountCents) / 100 },
  {
    header: "Receipt",
    value: (l) => (l.receipt === null ? "" : l.receipt),
  },
];

const ITEM_LABELS: Readonly<Record<string, string>> = {
  team_fee: "Team fee",
  player_share: "Player share",
  player_fee: "Player fee",
  free_agent_fee: "Free agent fee",
  balance: "Team balance",
  event_ticket: "Event ticket",
  merch: "Merch",
};

const METHOD_LABELS: Readonly<Record<string, string>> = {
  stripe: "Paid in the app",
  cash: "Cash",
  venmo: "Venmo",
  other: "Paid outside the app",
};

/** YYYY-MM-DD of an instant in a time zone. */
export function localDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(instant);
}

export function ledgerLines(
  rows: {
    payments: readonly {
      method: string;
      amountCents: number;
      refundedCents: number;
      paidAt: Date | null;
      createdAt: Date;
      kinds: readonly string[] | null;
    }[];
    expenses: readonly {
      spentOn: string;
      amountCents: number;
      category: ExpenseCategory;
      note: string | null;
      receiptFileId: string | null;
    }[];
    permitCosts: readonly {
      startsAt: Date;
      costCents: number | null;
      permitNumber: string | null;
      fieldName: string;
    }[];
  },
  timeZone: string,
): LedgerLine[] {
  const lines: LedgerLine[] = [];
  for (const p of rows.payments) {
    const date = localDate(p.paidAt ?? p.createdAt, timeZone);
    const description =
      (p.kinds ?? []).map((k) => ITEM_LABELS[k] ?? k).join(", ") || "Payment";
    const category = METHOD_LABELS[p.method] ?? p.method;
    lines.push({
      date,
      type: "Income",
      category,
      description,
      amountCents: p.amountCents,
      receipt: null,
    });
    if (p.refundedCents > 0)
      lines.push({
        date,
        type: "Refund",
        category,
        description: `Refunded: ${description}`,
        amountCents: -p.refundedCents,
        receipt: null,
      });
  }
  for (const e of rows.expenses)
    lines.push({
      date: e.spentOn,
      type: "Expense",
      category: CATEGORY_LABELS[e.category],
      description: e.note ?? "",
      amountCents: -e.amountCents,
      receipt: e.receiptFileId !== null,
    });
  for (const w of rows.permitCosts)
    if (w.costCents)
      lines.push({
        date: localDate(w.startsAt, timeZone),
        type: "Expense",
        category: CATEGORY_LABELS.fields_permits,
        description: `${w.permitNumber ? `Permit ${w.permitNumber}` : "Permit"}, ${w.fieldName} (this date's share)`,
        amountCents: -w.costCents,
        receipt: null,
      });
  return lines.sort((a, b) => a.date.localeCompare(b.date));
}
