/**
 * CSV files for admins and captains (RFC 4180), safe to open in a
 * spreadsheet. Pure: callers pass columns and rows and get the file's text.
 *
 * Formula injection: a spreadsheet runs a cell that starts with =, +, -, @,
 * a tab or a carriage return as a formula, so a player who names themselves
 * `=HYPERLINK(...)` could plant one in the admin's export. Such text cells get
 * a leading apostrophe, which spreadsheets show as plain text. Numbers are
 * written as numbers and never changed.
 */

export type Cell = string | number | boolean | Date | null | undefined;

export type Column<Row> = {
  header: string;
  value: (row: Row) => Cell;
};

/** Characters that make a spreadsheet treat a cell as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;
/** Cells that need quotes: separators, quotes, line breaks, edge spaces. */
const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/;

/** The text of one cell, defused and quoted as needed. */
export function csvCell(value: Cell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number")
    return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "yes" : "no";
  const text = value instanceof Date ? value.toISOString() : value;
  const safe = FORMULA_START.test(text) ? `'${text}` : text;
  return NEEDS_QUOTES.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/**
 * The whole file: a header row, then one line per row, with CRLF line ends.
 * It starts with a byte order mark so spreadsheet apps read it as UTF-8.
 */
export function toCsv<Row>(
  columns: readonly Column<Row>[],
  rows: readonly Row[],
): string {
  const lines = [
    columns.map((c) => csvCell(c.header)).join(","),
    ...rows.map((row) => columns.map((c) => csvCell(c.value(row))).join(",")),
  ];
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** Cents as a plain decimal amount, for example 4500 → "45.00". */
export function centsToAmount(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * A download name made of safe parts, for example
 * ["spring-2027", "roster"] → "spring-2027-roster.csv".
 */
export function exportFilename(
  parts: readonly string[],
  extension: "csv" | "json",
): string {
  const slug = parts
    .map((p) =>
      p
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, ""),
    )
    .filter((p) => p.length > 0)
    .join("-");
  return `${slug || "export"}.${extension}`;
}
