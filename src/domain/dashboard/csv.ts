import type { Column } from "../export/csv";
import type { DashboardView } from "./view";

/**
 * The dashboard's numbers as a CSV, one number per line so a spreadsheet
 * can pivot them any way: the section, the season, what it is about (a
 * team, an event, a week or an expense category), the measure and the
 * value. Counts and totals only: no person's name, contact or amount.
 */

export type DashboardLine = {
  section: string;
  season: string;
  item: string;
  measure: string;
  value: number | null;
};

export const DASHBOARD_COLUMNS: readonly Column<DashboardLine>[] = [
  { header: "Section", value: (l) => l.section },
  { header: "Season", value: (l) => l.season },
  { header: "Item", value: (l) => l.item },
  { header: "Measure", value: (l) => l.measure },
  { header: "Value", value: (l) => l.value },
];

const dollars = (cents: number) => Math.round(cents) / 100;
/** A rate as a percentage with one decimal, or empty. */
const pct = (r: number | null) =>
  r === null ? null : Math.round(r * 1000) / 10;

export function dashboardLines(
  view: DashboardView,
  selectedName: string,
): DashboardLine[] {
  const lines: DashboardLine[] = [];
  const add = (
    section: string,
    season: string,
    item: string,
    measure: string,
    value: number | null,
  ) => lines.push({ section, season, item, measure, value });

  for (const m of view.membership) {
    const s = "Membership";
    add(s, m.name, "", "Members", m.members);
    add(s, m.name, "", "New", m.newMembers);
    add(s, m.name, "", "Returning", m.returning);
    add(s, m.name, "", "Back from the season before", m.retained);
    add(s, m.name, "", "Retention %", pct(m.retention));
    add(s, m.name, "", "Waivers signed", m.signed);
    add(s, m.name, "", "Paid up", m.paid);
  }
  for (const m of view.money) {
    const s = "Money";
    add(
      s,
      m.name,
      "Money in",
      "Registrations in the app ($)",
      dollars(m.registrationsCents),
    );
    add(
      s,
      m.name,
      "Money in",
      "Event tickets in the app ($)",
      dollars(m.ticketsCents),
    );
    add(s, m.name, "Money in", "Merch in the app ($)", dollars(m.merchCents));
    add(
      s,
      m.name,
      "Money in",
      "Paid outside the app ($)",
      dollars(m.offAppCents),
    );
    add(s, m.name, "Money in", "Refunds ($)", -dollars(m.refundsCents));
    add(s, m.name, "Money in", "Total ($)", dollars(m.incomeCents));
    add(
      s,
      m.name,
      "Money in",
      "League credit spent ($)",
      dollars(m.creditCents),
    );
    for (const e of m.expenses)
      add(s, m.name, "Money out", `${e.label} ($)`, dollars(e.cents));
    add(s, m.name, "Money out", "Total ($)", dollars(m.expenseTotalCents));
    add(s, m.name, "Net", "Money in less money out ($)", dollars(m.netCents));
  }
  for (const t of view.selected.teams) {
    const s = "Teams";
    add(s, selectedName, t.name, "Members", t.members);
    add(s, selectedName, t.name, "Roster target", t.target);
    add(s, selectedName, t.name, "Sign-up %", pct(t.signUpRate));
    add(s, selectedName, t.name, "Waivers signed", t.signed);
    add(s, selectedName, t.name, "Waiver %", pct(t.waiverRate));
    add(s, selectedName, t.name, "Paid up", t.paid);
    add(s, selectedName, t.name, "Payment %", pct(t.paymentRate));
  }
  for (const e of view.selected.events) {
    const s = "Events";
    const item = `${e.title} (${e.startsAt.toISOString().slice(0, 10)})`;
    add(s, selectedName, item, "Going", e.signedUp);
    add(s, selectedName, item, "Checked in", e.checkedIn);
    add(s, selectedName, item, "Turnout %", pct(e.turnout));
  }
  for (const w of view.selected.checkins) {
    const s = "Sponsor check-ins";
    add(s, selectedName, `Week of ${w.weekOf}`, "All sponsors", w.checkins);
    for (const b of w.bySponsor)
      add(s, selectedName, `Week of ${w.weekOf}`, b.sponsor, b.checkins);
  }
  return lines;
}
