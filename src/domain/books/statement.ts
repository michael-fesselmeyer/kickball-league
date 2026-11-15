import { dollarsToCents } from "../money/credit";
import { err, ok, type Result } from "../result";
import type { ExpenseCategory } from "./ledger";

/**
 * Reads a Venmo statement or a bank's CSV export into money-out rows the
 * owners can import as expenses (ADR 0054). The owners download the file
 * themselves: Venmo and the banks have no free API, and the league uses no
 * aggregator. Pure, so every format is tested without a database.
 *
 * Nothing that identifies an account is kept: only the date, amount and
 * description columns are read, and any run of five or more digits in a
 * description (a card, account or reference number) is masked before it
 * goes anywhere. The file itself is never stored.
 */

/** Largest file read; a season's statement is a few hundred rows. */
export const STATEMENT_MAX_BYTES = 512 * 1024;
/** Most money-out rows one import takes. */
export const STATEMENT_MAX_ROWS = 500;
/** Longest description kept, after masking. */
export const DESCRIPTION_MAX = 120;

export type StatementSource = "venmo" | "bank";

export type StatementRow = {
  /** YYYY-MM-DD. */
  spentOn: string;
  /** Money out, always positive. */
  amountCents: number;
  /** Masked and trimmed; never empty. */
  description: string;
  /**
   * Identifies the row across imports of overlapping statements: the
   * statement's own transaction ID when it has one, else the date, amount,
   * description and how many identical rows came before it in the file.
   */
  key: string;
};

export type StatementProblem = "empty" | "too_big" | "unrecognized";

export type Statement = {
  source: StatementSource;
  rows: StatementRow[];
  /**
   * Money-in rows left out: payments, refunds and transfers in. The ledger
   * reads income from the payments the app records (ADR 0034).
   */
  moneyIn: number;
  /** Venmo transfers to a bank, left out: money moving, not spent. */
  transfers: number;
  /** Rows left out because they weren't complete (no date or amount). */
  unreadable: number;
  /** Money-out rows past STATEMENT_MAX_ROWS, left out. */
  overLimit: number;
};

/** Splits CSV text into rows of cells: quotes, doubled quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quoted) {
      if (c === '"') {
        if (body[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && body[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Masks every run of five or more digits, spaces or dashes allowed between. */
export function maskNumbers(text: string): string {
  return text.replace(/\d(?:[\s-]?\d){4,}/g, (run) => {
    const digits = run.replace(/\D/g, "");
    return `••••${digits.slice(-2)}`;
  });
}

/** A description fit to store: masked, one line, trimmed and clipped. */
export function cleanDescription(text: string): string {
  const one = maskNumbers(text).replace(/\s+/g, " ").trim();
  return one.length > DESCRIPTION_MAX
    ? `${one.slice(0, DESCRIPTION_MAX - 1)}…`
    : one;
}

const US = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/;
const ISO = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ].*)?$/;

/**
 * "10/03/2026", "10/3/26", "2026-10-03", "2026/10/03" or
 * "2026-10-03T19:22:11" → YYYY-MM-DD. US exports put the month first.
 */
export function statementDate(text: string): string | null {
  const value = text.trim();
  let y: number, m: number, d: number;
  const iso = ISO.exec(value);
  const us = US.exec(value);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (us) {
    [m, d, y] = [Number(us[1]), Number(us[2]), Number(us[3])];
    if (us[3]?.length === 2) y += 2000;
  } else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  )
    return null;
  return date.toISOString().slice(0, 10);
}

/**
 * "- $25.00", "$-25.00", "25.00-", "(25.00)", "25.00 DR", "+ $1,200.00",
 * "25.00 CR", "$25" → signed cents, or null. A minus sign anywhere,
 * parentheses or "DR" mean money out. Amounts are read as text, never as
 * floating point, and at most $99,999.99 (larger is null).
 */
export function statementAmount(text: string): number | null {
  let value = text.trim();
  if (value === "") return null;
  let negative = /^\(.*\)$/.test(value);
  const suffix = /\s*(CR|DR)$/i.exec(value);
  if (suffix) {
    negative = negative || suffix[1]?.toUpperCase() === "DR";
    value = value.slice(0, suffix.index);
  }
  if ((value.match(/[-−–]/g) ?? []).length > 1) return null;
  negative = negative || /[-−–]/.test(value);
  const bare = value.replace(/[()+\-−–$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(bare)) return null;
  const cents = dollarsToCents(bare);
  if (cents === null) return null;
  return negative ? -cents : cents;
}

/**
 * A statement file's text. Banks export UTF-8 (often with a byte-order
 * mark), UTF-16 from some spreadsheet tools, or Windows-1252 from older
 * systems; each is read as such rather than as garbled UTF-8.
 */
export function decodeStatement(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** Descriptions that look like money moving between the league's accounts. */
const TRANSFER = /\b(transfer|xfer|to savings|from savings|cash ?out)\b/i;

/** True when a row looks like a transfer rather than a cost. */
export const looksLikeTransfer = (description: string) =>
  TRANSFER.test(description);

const norm = (header: string) => header.toLowerCase().replace(/[^a-z]/g, "");

const DATE_HEADERS = [
  "datetime",
  "date",
  "transactiondate",
  "postingdate",
  "posteddate",
  "postdate",
];
const DESCRIPTION_HEADERS = [
  "description",
  "payee",
  "merchant",
  "name",
  "memo",
  "details",
];
const AMOUNT_HEADERS = ["amount", "amounttotal", "transactionamount"];

type Columns = {
  source: StatementSource;
  date: number;
  amount: number | null;
  debit: number | null;
  credit: number | null;
  descriptions: number[];
  id: number | null;
  status: number | null;
  type: number | null;
};

const first = (headers: string[], names: readonly string[]) => {
  for (const name of names) {
    const at = headers.indexOf(name);
    if (at >= 0) return at;
  }
  return -1;
};

/** Finds the header row (statements often start with a title or balance). */
function columnsOf(rows: string[][]): { at: number; cols: Columns } | null {
  for (let at = 0; at < Math.min(rows.length, 20); at++) {
    const headers = (rows[at] ?? []).map(norm);
    const date = first(headers, DATE_HEADERS);
    if (date < 0) continue;
    const amount = first(headers, AMOUNT_HEADERS);
    const debit = headers.indexOf("debit");
    const credit = headers.indexOf("credit");
    if (amount < 0 && debit < 0) continue;
    const venmo =
      headers.includes("from") &&
      headers.includes("to") &&
      headers.includes("note");
    const descriptions = venmo
      ? [headers.indexOf("to"), headers.indexOf("note")]
      : [first(headers, DESCRIPTION_HEADERS)];
    if (descriptions.some((d) => d < 0)) continue;
    const id = headers.indexOf("id");
    const status = headers.indexOf("status");
    const type = headers.indexOf("type");
    return {
      at,
      cols: {
        source: venmo ? "venmo" : "bank",
        date,
        amount: amount >= 0 ? amount : null,
        debit: debit >= 0 ? debit : null,
        credit: credit >= 0 ? credit : null,
        descriptions,
        id: venmo && id >= 0 ? id : null,
        status: venmo && status >= 0 ? status : null,
        type: venmo && type >= 0 ? type : null,
      },
    };
  }
  return null;
}

/**
 * Money out as positive cents, "in" for money in (payments, refunds,
 * transfers in), "zero" for a $0 line, null when unreadable.
 */
function moneyOut(row: string[], cols: Columns): number | "in" | "zero" | null {
  if (cols.amount !== null) {
    const signed = statementAmount(row[cols.amount] ?? "");
    if (signed === null) return null;
    if (signed === 0) return "zero";
    return signed < 0 ? -signed : "in";
  }
  const debit = statementAmount(row[cols.debit ?? -1] ?? "");
  const credit = statementAmount(row[cols.credit ?? -1] ?? "");
  if (debit !== null && debit !== 0) return Math.abs(debit);
  if (credit !== null && credit !== 0) return "in";
  if (debit === 0 || credit === 0) return "zero";
  return null;
}

/** Reads a statement's text. Rows come back oldest first. */
export function readStatement(
  text: string,
): Result<Statement, StatementProblem> {
  if (text.length > STATEMENT_MAX_BYTES) return err("too_big");
  const rows = parseCsv(text);
  if (rows.length === 0) return err("empty");
  const found = columnsOf(rows);
  if (!found) return err("unrecognized");
  const { at, cols } = found;
  const out: StatementRow[] = [];
  const seen = new Map<string, number>();
  let moneyIn = 0;
  let transfers = 0;
  let unreadable = 0;
  let overLimit = 0;
  for (const row of rows.slice(at + 1)) {
    // Venmo lists pending and failed payments too; only completed ones count.
    const status =
      cols.status !== null ? (row[cols.status] ?? "").trim().toLowerCase() : "";
    if (status !== "" && status !== "complete" && status !== "completed")
      continue;
    const spentOn = statementDate(row[cols.date] ?? "");
    const amount = moneyOut(row, cols);
    if (amount === "zero") continue;
    if (amount === "in") {
      moneyIn++;
      continue;
    }
    // Venmo moving the balance to the league's bank isn't a cost.
    if (
      cols.type !== null &&
      /transfer/i.test(row[cols.type] ?? "") &&
      amount !== null
    ) {
      transfers++;
      continue;
    }
    if (!spentOn || amount === null) {
      // Balance and summary lines have neither; a row with one is broken.
      if (spentOn || amount !== null) unreadable++;
      continue;
    }
    if (out.length >= STATEMENT_MAX_ROWS) {
      overLimit++;
      continue;
    }
    const description =
      cleanDescription(
        cols.descriptions
          .map((d) => (row[d] ?? "").trim())
          .filter(Boolean)
          .join(" · "),
      ) || "No description";
    const id = cols.id !== null ? (row[cols.id] ?? "").trim() : "";
    const base = `${spentOn}|${amount}|${description.toLowerCase()}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.push({
      spentOn,
      amountCents: amount,
      description,
      key: id ? `${cols.source}:${id}` : `${base}|${n}`,
    });
  }
  out.sort((a, b) => a.spentOn.localeCompare(b.spentOn));
  return ok({
    source: cols.source,
    rows: out,
    moneyIn,
    transfers,
    unreadable,
    overLimit,
  });
}

// ---------------------------------------------------------------------------
// Merchant rules

export type MerchantRule = { pattern: string; category: ExpenseCategory };

/** Longest pattern kept; it's matched as a substring, ignoring case. */
export const PATTERN_MAX = 60;

/**
 * Starting guesses, used after the owners' own rules. Lowercase substrings
 * of the description; the longest match wins.
 */
export const BUILT_IN_RULES: readonly MerchantRule[] = [
  { pattern: "nyc parks", category: "fields_permits" },
  { pattern: "parks dept", category: "fields_permits" },
  { pattern: "permit", category: "fields_permits" },
  { pattern: "field", category: "fields_permits" },
  { pattern: "referee", category: "refs" },
  { pattern: "ref pay", category: "refs" },
  { pattern: "umpire", category: "refs" },
  { pattern: "sporting goods", category: "equipment" },
  { pattern: "kickball", category: "equipment" },
  { pattern: "cones", category: "equipment" },
  { pattern: "shirt", category: "shirts" },
  { pattern: "jersey", category: "shirts" },
  { pattern: "screen print", category: "shirts" },
  { pattern: "deposit", category: "events" },
  { pattern: "tavern", category: "events" },
  { pattern: "trophy", category: "events" },
  { pattern: "party", category: "events" },
  { pattern: "sponsor", category: "sponsor_costs" },
];

/** A rule's pattern as stored: lowercase, one line, trimmed. */
export function rulePattern(text: string): Result<string, "pattern"> {
  const value = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (value.length < 2 || value.length > PATTERN_MAX) return err("pattern");
  return ok(value);
}

/**
 * The category a description most likely belongs to: the owners' rules
 * first, then the built-in ones, longest matching pattern first. Null when
 * nothing matches.
 */
export function guessCategory(
  description: string,
  ownRules: readonly MerchantRule[],
  builtIn: readonly MerchantRule[] = BUILT_IN_RULES,
): ExpenseCategory | null {
  const text = description.toLowerCase();
  for (const rules of [ownRules, builtIn]) {
    const hit = rules
      .filter((r) => r.pattern !== "" && text.includes(r.pattern))
      .sort((a, b) => b.pattern.length - a.pattern.length)[0];
    if (hit) return hit.category;
  }
  return null;
}
