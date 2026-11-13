import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import type { ExpenseCategory, PaymentMethod } from "@/domain/books/ledger";
import {
  type CheckinRow,
  type EventTurnoutRow,
  type MemberRow,
  type TeamCounts,
} from "@/domain/dashboard/metrics";
import {
  type ExpenseTotals,
  type MoneySummary,
  type PaymentTotals,
} from "@/domain/dashboard/money";
import type { LeagueId, SeasonId, UserId } from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import { expense } from "../schema/books";
import { event, eventRsvp, eventTicket } from "../schema/event";
import { league } from "../schema/league";
import { payment, purchase } from "../schema/money";
import { moneySummary } from "../schema/money-summary";
import { permitWindow } from "../schema/schedule";
import { season } from "../schema/season";
import { checkin, sponsor } from "../schema/sponsor";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { recordAudit } from "./audit";
import type { Db } from "./schedule";

/**
 * The owner dashboard (product-spec.md, section 9) and the season money
 * summary (ADR 0035). Pages check `dashboard.view` or `money_summary.publish`
 * before calling anything here. Every number is added up in Postgres, one
 * grouped read per kind of number and all of them at once, never one read
 * per season, team or event.
 */

/** The statuses that make someone a member of a season. */
const MEMBER_STATUSES = [
  "pending_waiver",
  "pending_payment",
  "active",
] as const;

/** Narrows a league-wide total to one season when asked. */
const oneSeason = (only: SeasonId | undefined) =>
  only ? eq(season.id, only) : undefined;

/** The league's seasons past draft, newest first. */
export async function dashboardSeasons(db: Db, leagueId: LeagueId) {
  return db
    .select({
      id: season.id,
      slug: season.slug,
      name: season.name,
      status: season.status,
      startsOn: season.startsOn,
      endsOn: season.endsOn,
      feeModel: season.feeModel,
      teamFeeCents: season.teamFeeCents,
      playerFeeCents: season.playerFeeCents,
      freeAgentFeeCents: season.freeAgentFeeCents,
    })
    .from(season)
    .where(and(eq(season.leagueId, leagueId), ne(season.status, "draft")))
    .orderBy(desc(season.startsOn));
}

export type DashboardSeasonRow = Awaited<
  ReturnType<typeof dashboardSeasons>
>[number];

/** Every member of every season past draft: the rows retention is counted from. */
function memberRows(db: Db, leagueId: LeagueId): Promise<MemberRow[]> {
  return db
    .select({
      seasonId: registration.seasonId,
      userId: registration.userId,
      // As the registrations board reads them.
      signed: sql<boolean>`(${registration.waiverSignatureId} is not null or ${registration.status} <> 'pending_waiver')`,
      paid: sql<boolean>`(${registration.status} = 'active')`,
    })
    .from(registration)
    .innerJoin(season, eq(season.id, registration.seasonId))
    .where(
      and(
        eq(season.leagueId, leagueId),
        ne(season.status, "draft"),
        inArray(registration.status, [...MEMBER_STATUSES]),
      ),
    );
}

/**
 * Succeeded payments by season, method and kind. As the books count them
 * (ADR 0034): a purchase of the season, or a purchase with no season (an
 * event ticket) paid on a day the season was running, in league time.
 */
function paymentTotals(
  db: Db,
  leagueId: LeagueId,
  only?: SeasonId,
): Promise<PaymentTotals[]> {
  const day = sql`(${payment.paidAt} at time zone ${league.timezone})::date`;
  const ticket = sql<boolean>`exists (select 1 from purchase_item pi where pi.purchase_id = ${purchase.id} and pi.kind = 'event_ticket')`;
  return db
    .select({
      seasonId: season.id,
      method: sql<PaymentMethod>`${payment.method}`,
      ticket,
      amountCents: sql<number>`sum(${payment.amountCents})`.mapWith(Number),
      refundedCents: sql<number>`sum(${payment.refundedCents})`.mapWith(Number),
    })
    .from(payment)
    .innerJoin(purchase, eq(purchase.id, payment.purchaseId))
    .innerJoin(league, eq(league.id, leagueId))
    .innerJoin(
      season,
      and(
        eq(season.leagueId, league.id),
        or(
          eq(purchase.seasonId, season.id),
          and(
            isNull(purchase.seasonId),
            sql`${day} between ${season.startsOn} and ${season.endsOn}`,
          ),
        ),
      ),
    )
    .where(and(eq(payment.status, "succeeded"), oneSeason(only)))
    .groupBy(season.id, payment.method, ticket);
}

/**
 * League credit spent on the season's paid purchases, once per purchase
 * however many payments it had, as the books count it.
 */
async function creditTotals(
  db: Db,
  leagueId: LeagueId,
  only?: SeasonId,
): Promise<Map<string, number>> {
  const paid = db
    .selectDistinct({
      seasonId: purchase.seasonId,
      purchaseId: purchase.id,
      creditCents: purchase.creditAppliedCents,
    })
    .from(purchase)
    .innerJoin(payment, eq(payment.purchaseId, purchase.id))
    .innerJoin(season, eq(season.id, purchase.seasonId))
    .where(
      and(
        eq(season.leagueId, leagueId),
        eq(payment.status, "succeeded"),
        sql`${purchase.creditAppliedCents} > 0`,
        oneSeason(only),
      ),
    )
    .as("paid");
  const rows = await db
    .select({
      seasonId: paid.seasonId,
      cents: sql<number>`sum(${paid.creditCents})`.mapWith(Number),
    })
    .from(paid)
    .groupBy(paid.seasonId);
  return new Map(
    rows.flatMap((r) => (r.seasonId ? [[r.seasonId, r.cents]] : [])),
  );
}

function expenseTotals(
  db: Db,
  leagueId: LeagueId,
  only?: SeasonId,
): Promise<ExpenseTotals[]> {
  return db
    .select({
      seasonId: expense.seasonId,
      category: sql<ExpenseCategory>`${expense.category}`,
      amountCents: sql<number>`sum(${expense.amountCents})`.mapWith(Number),
    })
    .from(expense)
    .innerJoin(season, eq(season.id, expense.seasonId))
    .where(and(eq(season.leagueId, leagueId), oneSeason(only)))
    .groupBy(expense.seasonId, expense.category);
}

/** Each season's permit costs, which the books add to "Fields and permits". */
async function permitTotals(
  db: Db,
  leagueId: LeagueId,
  only?: SeasonId,
): Promise<Map<string, number>> {
  const rows = await db
    .select({
      seasonId: permitWindow.seasonId,
      cents: sql<number>`sum(${permitWindow.costCents})`.mapWith(Number),
    })
    .from(permitWindow)
    .innerJoin(season, eq(season.id, permitWindow.seasonId))
    .where(
      and(
        eq(season.leagueId, leagueId),
        isNotNull(permitWindow.costCents),
        oneSeason(only),
      ),
    )
    .groupBy(permitWindow.seasonId);
  return new Map(rows.map((r) => [r.seasonId, r.cents]));
}

/**
 * The season's members by team: those on a team's active roster under it,
 * the rest (free agents not placed yet) with no team id. A team aims for
 * its target roster size, or the season's largest roster without one.
 */
function teamCounts(db: Db, seasonId: SeasonId): Promise<TeamCounts[]> {
  const signed = sql`(${registration.waiverSignatureId} is not null or ${registration.status} <> 'pending_waiver')`;
  return db
    .select({
      teamSeasonId: teamSeason.id,
      name: sql<string>`coalesce(${team.name}, 'Not on a team yet')`,
      members: sql<number>`count(*)`.mapWith(Number),
      signed: sql<number>`count(*) filter (where ${signed})`.mapWith(Number),
      paid: sql<number>`count(*) filter (where ${registration.status} = 'active')`.mapWith(
        Number,
      ),
      target: sql<
        number | null
      >`case when ${teamSeason.id} is null then null else coalesce(${teamSeason.targetRosterSize}, ${season.rosterMax}) end`,
    })
    .from(registration)
    .innerJoin(season, eq(season.id, registration.seasonId))
    .leftJoin(
      rosterMembership,
      and(
        eq(rosterMembership.registrationId, registration.id),
        eq(rosterMembership.status, "active"),
      ),
    )
    .leftJoin(teamSeason, eq(teamSeason.id, rosterMembership.teamSeasonId))
    .leftJoin(team, eq(team.id, teamSeason.teamId))
    .where(
      and(
        eq(registration.seasonId, seasonId),
        inArray(registration.status, [...MEMBER_STATUSES]),
      ),
    )
    .groupBy(
      teamSeason.id,
      team.name,
      teamSeason.targetRosterSize,
      season.rosterMax,
    );
}

type SeasonSpan = { id: SeasonId; startsOn: string; endsOn: string };

/**
 * Events that started during the season, in league time, with their going
 * RSVPs (a paid ticket comes with one) and, for ticketed events, the
 * tickets checked in at the door. Theme weeks, called-off and removed
 * events are left out.
 */
function eventRows(
  db: Db,
  leagueId: LeagueId,
  s: SeasonSpan,
): Promise<EventTurnoutRow[]> {
  const day = sql`(${event.startsAt} at time zone ${league.timezone})::date`;
  return db
    .select({
      id: event.id,
      title: event.title,
      startsAt: event.startsAt,
      signedUp:
        sql<number>`(select count(*) from ${eventRsvp} where ${eventRsvp.eventId} = ${event.id} and ${eventRsvp.status} = 'going')`.mapWith(
          Number,
        ),
      checkedIn: sql<
        number | null
      >`case when ${event.ticketPriceCents} is null then null else (select count(*) from ${eventTicket} where ${eventTicket.eventId} = ${event.id} and ${eventTicket.checkedInAt} is not null)::int end`,
    })
    .from(event)
    .innerJoin(league, eq(league.id, event.leagueId))
    .where(
      and(
        eq(event.leagueId, leagueId),
        isNull(event.deletedAt),
        isNull(event.cancelledAt),
        // A theme week marks game days; there is nothing to go to.
        ne(event.kind, "theme_week"),
        sql`${day} between ${s.startsOn}::date and ${s.endsOn}::date`,
      ),
    )
    .orderBy(asc(event.startsAt));
}

/** Check-ins at sponsor bars during the season, by week and sponsor. */
function checkinRows(
  db: Db,
  leagueId: LeagueId,
  s: SeasonSpan,
): Promise<CheckinRow[]> {
  const week = sql<string>`to_char(date_trunc('week', ${checkin.onDate}), 'YYYY-MM-DD')`;
  return db
    .select({
      weekOf: week,
      sponsor: sponsor.name,
      checkins: sql<number>`count(*)`.mapWith(Number),
    })
    .from(checkin)
    .innerJoin(sponsor, eq(sponsor.id, checkin.sponsorId))
    .where(
      and(
        eq(sponsor.leagueId, leagueId),
        sql`${checkin.onDate} between ${s.startsOn}::date and ${s.endsOn}::date`,
      ),
    )
    .groupBy(week, sponsor.name);
}

/** A season's published summary, or null when none is published. */
export async function publishedSummary(db: Db, seasonId: SeasonId) {
  const [row] = await db
    .select()
    .from(moneySummary)
    .where(eq(moneySummary.seasonId, seasonId));
  return row ?? null;
}

export type DashboardData = {
  seasons: DashboardSeasonRow[];
  members: MemberRow[];
  payments: PaymentTotals[];
  credit: Map<string, number>;
  expenses: ExpenseTotals[];
  permits: Map<string, number>;
  teams: TeamCounts[];
  events: EventTurnoutRow[];
  checkins: CheckinRow[];
  published: Awaited<ReturnType<typeof publishedSummary>>;
};

/**
 * Everything the dashboard shows for the league, with the detail of one
 * season: ten grouped reads, all at once.
 */
export async function ownerDashboard(
  db: Db,
  leagueId: LeagueId,
  selected: SeasonSpan,
): Promise<DashboardData> {
  const [
    seasons,
    members,
    payments,
    credit,
    expenses,
    permits,
    teams,
    events,
    checkins,
    published,
  ] = await Promise.all([
    dashboardSeasons(db, leagueId),
    memberRows(db, leagueId),
    paymentTotals(db, leagueId),
    creditTotals(db, leagueId),
    expenseTotals(db, leagueId),
    permitTotals(db, leagueId),
    teamCounts(db, selected.id),
    eventRows(db, leagueId, selected),
    checkinRows(db, leagueId, selected),
    publishedSummary(db, selected.id),
  ]);
  return {
    seasons,
    members,
    payments,
    credit,
    expenses,
    permits,
    teams,
    events,
    checkins,
    published,
  };
}

/**
 * What a season's summary is built from: its money in and out (the same
 * totals as the dashboard, for this season only) and its member count,
 * which decides whether it may be published. Six reads, all at once.
 */
export async function summaryInputs(
  db: Db,
  leagueId: LeagueId,
  seasonId: SeasonId,
) {
  const [payments, credit, expenses, permits, [members], published] =
    await Promise.all([
      paymentTotals(db, leagueId, seasonId),
      creditTotals(db, leagueId, seasonId),
      expenseTotals(db, leagueId, seasonId),
      permitTotals(db, leagueId, seasonId),
      db
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(registration)
        .where(
          and(
            eq(registration.seasonId, seasonId),
            inArray(registration.status, [...MEMBER_STATUSES]),
          ),
        ),
      publishedSummary(db, seasonId),
    ]);
  return {
    payments,
    creditCents: credit.get(seasonId) ?? 0,
    expenses,
    permitCostCents: permits.get(seasonId) ?? 0,
    members: members?.count ?? 0,
    published,
  };
}

/** Publishes (or republishes) a season's summary, as previewed. */
export async function publishSummary(
  db: Db,
  input: {
    seasonId: SeasonId;
    folded: readonly ExpenseCategory[];
    summary: MoneySummary;
  },
  actorId: UserId,
  now = new Date(),
): Promise<void> {
  const folded = [...new Set(input.folded)].filter((c) => c !== "other");
  const values = {
    seasonId: input.seasonId,
    folded,
    summary: input.summary,
    publishedAt: now,
    publishedBy: actorId,
  };
  await db
    .insert(moneySummary)
    .values(values)
    .onConflictDoUpdate({ target: moneySummary.seasonId, set: values });
  await recordAudit(db, {
    actorId,
    action: "money_summary.publish",
    entityType: "season",
    entityId: input.seasonId,
    after: {
      folded,
      collectedCents: input.summary.collectedCents,
      spentCents: input.summary.spentCents,
    },
  });
}

/** Takes a season's summary down. */
export async function unpublishSummary(
  db: Db,
  seasonId: SeasonId,
  actorId: UserId,
): Promise<Result<null, "not_published">> {
  const removed = await db
    .delete(moneySummary)
    .where(eq(moneySummary.seasonId, seasonId))
    .returning({ seasonId: moneySummary.seasonId });
  if (removed.length === 0) return err("not_published");
  await recordAudit(db, {
    actorId,
    action: "money_summary.unpublish",
    entityType: "season",
    entityId: seasonId,
  });
  return ok(null);
}

/**
 * A public season (not a draft) and its published summary, null when it has
 * none. The season comes back either way, so the page can tag its cache
 * with the season and show the summary as soon as one is published.
 */
export async function publicSummary(db: Db, slug: string) {
  const [row] = await db
    .select({
      seasonId: season.id,
      slug: season.slug,
      name: season.name,
      timeZone: league.timezone,
      summary: moneySummary.summary,
      publishedAt: moneySummary.publishedAt,
    })
    .from(season)
    .innerJoin(league, eq(league.id, season.leagueId))
    .leftJoin(moneySummary, eq(moneySummary.seasonId, season.id))
    .where(and(eq(season.slug, slug), ne(season.status, "draft")));
  return row ?? null;
}

/** Seasons with a published summary, for the sitemap and static params. */
export async function publishedSummarySeasons(db: Db) {
  return db
    .select({ slug: season.slug, publishedAt: moneySummary.publishedAt })
    .from(moneySummary)
    .innerJoin(season, eq(season.id, moneySummary.seasonId))
    .where(ne(season.status, "draft"))
    .orderBy(desc(season.startsOn));
}
