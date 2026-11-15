import type { Column } from "../export/csv";
import { change, type ReportLine } from "./report-card";

/**
 * The report card as a CSV: one line per measure with both seasons'
 * numbers and the change in words. Money is in dollars, rates in percent
 * and scores out of 5, as numbers a spreadsheet can add up.
 */

export type ReportCsvLine = {
  section: string;
  measure: string;
  unit: string;
  current: number | null;
  previous: number | null;
  change: string;
};

export const reportColumns = (
  currentName: string,
  previousName: string | null,
): readonly Column<ReportCsvLine>[] => [
  { header: "Section", value: (l) => l.section },
  { header: "Measure", value: (l) => l.measure },
  { header: "Unit", value: (l) => l.unit },
  { header: currentName, value: (l) => l.current },
  { header: previousName ?? "Season before", value: (l) => l.previous },
  { header: "Change", value: (l) => l.change },
];

const UNIT = {
  count: "count",
  money: "dollars",
  percent: "percent",
  score: "out of 5",
} as const;

const asNumber = (line: ReportLine, value: number | null) => {
  if (value === null) return null;
  if (line.kind === "money") return Math.round(value) / 100;
  if (line.kind === "percent") return Math.round(value * 1000) / 10;
  if (line.kind === "score") return Math.round(value * 10) / 10;
  return value;
};

export function reportCsvLines(
  lines: readonly ReportLine[],
  previousName: string | null,
): ReportCsvLine[] {
  return lines.map((l) => ({
    section: l.section,
    measure: l.label,
    unit: UNIT[l.kind],
    current: asNumber(l, l.current),
    previous: asNumber(l, l.previous),
    change: change(l, previousName).words,
  }));
}
