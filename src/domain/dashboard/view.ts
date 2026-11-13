import type { ExpenseCategory } from "../books/ledger";
import {
  type CheckinRow,
  type CheckinWeek,
  checkinWeeks,
  type DashboardSeasonRef,
  type EventTurnout,
  type EventTurnoutRow,
  eventTurnout,
  type MemberRow,
  membershipBySeason,
  type SeasonMembership,
  type TeamCompletion,
  type TeamCounts,
  teamCompletion,
} from "./metrics";
import {
  type ExpenseTotals,
  type PaymentTotals,
  type SeasonMoney,
  seasonMoney,
} from "./money";

/**
 * Everything the owner dashboard draws and its CSV lists, from the rows the
 * dashboard query returns. Plain data, so it can be cached as it is.
 */

export type DashboardInput = {
  seasons: readonly (DashboardSeasonRef & { endsOn: string })[];
  members: readonly MemberRow[];
  payments: readonly PaymentTotals[];
  credit: ReadonlyMap<string, number>;
  expenses: readonly ExpenseTotals[];
  permits: ReadonlyMap<string, number>;
  teams: readonly TeamCounts[];
  events: readonly EventTurnoutRow[];
  checkins: readonly CheckinRow[];
};

export type SeasonMoneyRow = SeasonMoney & { name: string; slug: string };

export type DashboardView = {
  /** Oldest season first, as the charts read left to right, top to bottom. */
  membership: SeasonMembership[];
  money: SeasonMoneyRow[];
  selected: {
    seasonId: string;
    membership: SeasonMembership | null;
    money: SeasonMoneyRow | null;
    teams: TeamCompletion[];
    events: EventTurnout[];
    checkins: CheckinWeek[];
  };
};

export function buildDashboardView(
  input: DashboardInput,
  selected: { id: string; startsOn: string; endsOn: string },
): DashboardView {
  const membership = membershipBySeason(input.seasons, input.members);
  const order = membership.map((m) => m.seasonId);
  const byId = new Map(input.seasons.map((s) => [s.id, s]));
  const money = order.flatMap((seasonId) => {
    const s = byId.get(seasonId);
    if (!s) return [];
    return [
      {
        ...seasonMoney({
          seasonId,
          payments: input.payments.filter((p) => p.seasonId === seasonId),
          creditCents: input.credit.get(seasonId) ?? 0,
          expenses: input.expenses.filter((e) => e.seasonId === seasonId),
          permitCostCents: input.permits.get(seasonId) ?? 0,
        }),
        name: s.name,
        slug: s.slug,
      },
    ];
  });
  return {
    membership,
    money,
    selected: {
      seasonId: selected.id,
      membership: membership.find((m) => m.seasonId === selected.id) ?? null,
      money: money.find((m) => m.seasonId === selected.id) ?? null,
      teams: teamCompletion(input.teams),
      events: eventTurnout(input.events),
      checkins: checkinWeeks(
        input.checkins,
        selected.startsOn,
        selected.endsOn,
      ),
    },
  };
}

/** The categories with money spent in any season shown, in the books' order. */
export function spentCategories(
  money: readonly SeasonMoney[],
): ExpenseCategory[] {
  const spent = new Set(
    money.flatMap((m) =>
      m.expenses.filter((e) => e.cents > 0).map((e) => e.category),
    ),
  );
  return (money[0]?.expenses ?? [])
    .map((e) => e.category)
    .filter((c) => spent.has(c));
}
