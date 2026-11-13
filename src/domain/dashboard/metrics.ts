/**
 * The owner dashboard's numbers (product-spec.md, section 9, "A dashboard
 * for owners"). Pure: the queries hand over plain rows and these functions
 * count them, so the math is tested without a database.
 *
 * A season's members are the people with a registration in it that is not
 * cancelled, waitlisted or refunded: the same people the registrations
 * board lists, less those who never got a spot or left with their money.
 */

/** A part of a whole, from 0 to 1; null when the whole is empty. */
export function rate(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

/** "75%", or "–" when there is nothing to divide by. */
export function percent(value: number | null): string {
  return value === null ? "–" : `${Math.round(value * 100)}%`;
}

export type DashboardSeasonRef = {
  id: string;
  name: string;
  slug: string;
  /** YYYY-MM-DD. Seasons are ordered by it, oldest first. */
  startsOn: string;
};

/** One person's registration in one season. */
export type MemberRow = {
  seasonId: string;
  userId: string;
  /** The waiver is signed. */
  signed: boolean;
  /** The registration is paid up (status active). */
  paid: boolean;
};

export type SeasonMembership = {
  seasonId: string;
  name: string;
  slug: string;
  members: number;
  /** Members with no registration in any earlier season. */
  newMembers: number;
  /** Members who played in some earlier season. */
  returning: number;
  /** Members of the season just before who came back for this one. */
  retained: number;
  /** The season just before's member count; null for the first season. */
  previousMembers: number | null;
  /** retained / previousMembers; null for the first season or an empty one before. */
  retention: number | null;
  signed: number;
  paid: number;
};

const byStart = <S extends DashboardSeasonRef>(a: S, b: S) =>
  a.startsOn < b.startsOn ? -1 : a.startsOn > b.startsOn ? 1 : 0;

/**
 * New, returning and retained members for every season, oldest first.
 * Retention compares each season with the one that started just before it.
 */
export function membershipBySeason(
  seasons: readonly DashboardSeasonRef[],
  rows: readonly MemberRow[],
): SeasonMembership[] {
  const ordered = [...seasons].sort(byStart);
  const of = new Map<string, Map<string, MemberRow>>();
  for (const s of ordered) of.set(s.id, new Map());
  for (const row of rows) of.get(row.seasonId)?.set(row.userId, row);

  const seenBefore = new Set<string>();
  let previous: Map<string, MemberRow> | null = null;
  return ordered.map((s) => {
    const here = of.get(s.id) ?? new Map<string, MemberRow>();
    let newMembers = 0;
    let retained = 0;
    let signed = 0;
    let paid = 0;
    for (const [userId, row] of here) {
      if (!seenBefore.has(userId)) newMembers += 1;
      if (previous?.has(userId)) retained += 1;
      if (row.signed) signed += 1;
      if (row.paid) paid += 1;
    }
    const previousMembers = previous ? previous.size : null;
    const result: SeasonMembership = {
      seasonId: s.id,
      name: s.name,
      slug: s.slug,
      members: here.size,
      newMembers,
      returning: here.size - newMembers,
      retained,
      previousMembers,
      retention:
        previousMembers === null ? null : rate(retained, previousMembers),
      signed,
      paid,
    };
    for (const userId of here.keys()) seenBefore.add(userId);
    previous = here;
    return result;
  });
}

/** One team's counts for the season, as the query groups them. */
export type TeamCounts = {
  teamSeasonId: string | null;
  name: string;
  members: number;
  signed: number;
  paid: number;
  /** The roster size the team is aiming for; null when it has none. */
  target: number | null;
};

export type TeamCompletion = TeamCounts & {
  waiverRate: number | null;
  paymentRate: number | null;
  /** Members against the roster target, at most 1. */
  signUpRate: number | null;
};

/**
 * Waiver, payment and sign-up rates per team, teams by name with the
 * players not on a team yet (no team id) last. A team past its target is
 * full: its sign-up rate stops at 100%.
 */
export function teamCompletion(teams: readonly TeamCounts[]): TeamCompletion[] {
  return [...teams]
    .sort((a, b) =>
      (a.teamSeasonId === null) !== (b.teamSeasonId === null)
        ? a.teamSeasonId === null
          ? 1
          : -1
        : a.name.localeCompare(b.name),
    )
    .map((t) => ({
      ...t,
      waiverRate: rate(t.signed, t.members),
      paymentRate: rate(t.paid, t.members),
      signUpRate:
        t.target === null || t.teamSeasonId === null
          ? null
          : Math.min(1, rate(t.members, t.target) ?? 0),
    }));
}

/** An event's sign-ups and check-ins. */
export type EventTurnoutRow = {
  id: string;
  title: string;
  startsAt: Date;
  /** RSVPs marked going, plus tickets paid or held. */
  signedUp: number;
  /** Tickets scanned at the door; null for an event without tickets. */
  checkedIn: number | null;
};

export type EventTurnout = EventTurnoutRow & { turnout: number | null };

/** Check-ins against sign-ups; events without tickets have no turnout. */
export function eventTurnout(rows: readonly EventTurnoutRow[]): EventTurnout[] {
  return rows.map((e) => ({
    ...e,
    turnout: e.checkedIn === null ? null : rate(e.checkedIn, e.signedUp),
  }));
}

/** Check-ins at sponsor bars, grouped by week (Monday) and sponsor. */
export type CheckinRow = { weekOf: string; sponsor: string; checkins: number };

export type CheckinWeek = {
  /** The Monday that starts the week, YYYY-MM-DD. */
  weekOf: string;
  checkins: number;
  bySponsor: { sponsor: string; checkins: number }[];
};

/**
 * Every week from `from` to `to` (both YYYY-MM-DD, inside the season), with
 * the weeks nobody checked in as zero so a chart shows the gaps.
 */
export function checkinWeeks(
  rows: readonly CheckinRow[],
  from: string,
  to: string,
): CheckinWeek[] {
  const weeks = new Map<string, CheckinWeek>();
  for (let day = mondayOf(from); day <= to; day = addDays(day, 7))
    weeks.set(day, { weekOf: day, checkins: 0, bySponsor: [] });
  for (const row of rows) {
    const week = weeks.get(row.weekOf) ?? {
      weekOf: row.weekOf,
      checkins: 0,
      bySponsor: [],
    };
    week.checkins += row.checkins;
    week.bySponsor.push({ sponsor: row.sponsor, checkins: row.checkins });
    weeks.set(row.weekOf, week);
  }
  return [...weeks.values()]
    .sort((a, b) => (a.weekOf < b.weekOf ? -1 : 1))
    .map((w) => ({
      ...w,
      bySponsor: w.bySponsor.sort(
        (a, b) => b.checkins - a.checkins || a.sponsor.localeCompare(b.sponsor),
      ),
    }));
}

const day = (on: string) => new Date(`${on}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(on: string, days: number): string {
  const d = day(on);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
}

/** The Monday on or before a date, as Postgres' date_trunc('week') picks it. */
export function mondayOf(on: string): string {
  const weekday = (day(on).getUTCDay() + 6) % 7;
  return addDays(on, -weekday);
}
