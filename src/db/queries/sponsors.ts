import { and, asc, desc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import type {
  CheckinId,
  DealId,
  LeagueId,
  SeasonId,
  SponsorId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import { newCheckinSecret } from "@/domain/sponsors/checkin-code";
import { dealApplies, type DealTerms } from "@/domain/sponsors/deals";
import type { DealCount, WeekCounts } from "@/domain/sponsors/report";
import { user } from "../schema/auth";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import {
  checkin,
  deal,
  dealRedemption,
  sponsor,
  sponsorMember,
  teamOfWeek,
} from "../schema/sponsor";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { recordAudit } from "./audit";
import type { Db } from "./schedule";

/**
 * Sponsors, their deals, check-ins at the bar and the team of the week
 * (docs/data-model.md, section 2.5). The check-in secret is read only by
 * `sponsorForCheckIn`; nothing public selects it.
 */

const live = isNull(sponsor.deletedAt);

export type SponsorKind = (typeof sponsor.$inferSelect)["kind"];

export type PublicDeal = DealTerms & {
  id: DealId;
  /** YYYY-MM-DD in the league's time zone. */
  confirmedOn: string;
};

export type PublicSponsor = {
  id: SponsorId;
  name: string;
  slug: string;
  kind: SponsorKind;
  isHomeBar: boolean;
  blurb: string | null;
  address: string | null;
  url: string | null;
  deals: PublicDeal[];
};

export type PublicTeamOfWeek = {
  weekOf: string;
  seasonName: string;
  teamName: string;
  teamSlug: string;
  reason: string;
  tabCents: number | null;
  sponsorSlug: string | null;
  sponsorName: string | null;
};

const dealTerms = {
  id: deal.id,
  sponsorId: deal.sponsorId,
  title: deal.title,
  terms: deal.terms,
  validDays: deal.validDays,
  validFrom: deal.validFrom,
  validTo: deal.validTo,
};

/**
 * Every sponsor shown to the public, home bar first, with its active deals,
 * and the latest team of the week. Three queries, run together.
 */
export async function sponsorDirectory(
  db: Db,
  leagueId: LeagueId,
  timeZone: string,
): Promise<{ sponsors: PublicSponsor[]; teamOfWeek: PublicTeamOfWeek | null }> {
  const [sponsors, deals, honors] = await Promise.all([
    db
      .select({
        id: sponsor.id,
        name: sponsor.name,
        slug: sponsor.slug,
        kind: sponsor.kind,
        isHomeBar: sponsor.isHomeBar,
        blurb: sponsor.blurb,
        address: sponsor.address,
        url: sponsor.url,
      })
      .from(sponsor)
      .where(and(eq(sponsor.leagueId, leagueId), live))
      .orderBy(desc(sponsor.isHomeBar), asc(sponsor.name)),
    db
      .select({
        ...dealTerms,
        confirmedOn: sql<string>`to_char(${deal.confirmedAt} at time zone ${timeZone}, 'YYYY-MM-DD')`,
      })
      .from(deal)
      .innerJoin(sponsor, eq(deal.sponsorId, sponsor.id))
      .where(and(eq(sponsor.leagueId, leagueId), live, eq(deal.active, true)))
      .orderBy(asc(deal.createdAt), asc(deal.id)),
    db
      .select({
        weekOf: teamOfWeek.weekOf,
        seasonName: season.name,
        teamName: team.name,
        teamSlug: team.slug,
        reason: teamOfWeek.reason,
        tabCents: teamOfWeek.tabCents,
        sponsorSlug: sponsor.slug,
        sponsorName: sponsor.name,
      })
      .from(teamOfWeek)
      .innerJoin(season, eq(teamOfWeek.seasonId, season.id))
      .innerJoin(teamSeason, eq(teamOfWeek.teamSeasonId, teamSeason.id))
      .innerJoin(team, eq(teamSeason.teamId, team.id))
      .leftJoin(
        sponsor,
        and(eq(teamOfWeek.sponsorId, sponsor.id), isNull(sponsor.deletedAt)),
      )
      .where(and(eq(season.leagueId, leagueId), ne(season.status, "draft")))
      .orderBy(desc(teamOfWeek.weekOf))
      .limit(1),
  ]);
  return {
    sponsors: sponsors.map((s) => ({
      ...s,
      deals: deals
        .filter((d) => d.sponsorId === s.id)
        .map(({ sponsorId: _, ...d }) => d),
    })),
    teamOfWeek: honors[0] ?? null,
  };
}

/** The sponsors this person may manage: all of them for an admin. */
export async function managedSponsors(
  db: Db,
  leagueId: LeagueId,
  only: readonly string[] | "all",
) {
  if (only !== "all" && only.length === 0) return [];
  return db
    .select({
      id: sponsor.id,
      name: sponsor.name,
      slug: sponsor.slug,
      isHomeBar: sponsor.isHomeBar,
    })
    .from(sponsor)
    .where(
      and(
        eq(sponsor.leagueId, leagueId),
        live,
        only === "all"
          ? undefined
          : inArray(sponsor.id, only as readonly SponsorId[]),
      ),
    )
    .orderBy(desc(sponsor.isHomeBar), asc(sponsor.name));
}

/** The sponsor ids a person is a member of. */
export async function sponsorIdsOf(db: Db, userId: UserId): Promise<string[]> {
  const rows = await db
    .select({ id: sponsorMember.sponsorId })
    .from(sponsorMember)
    .innerJoin(sponsor, eq(sponsorMember.sponsorId, sponsor.id))
    .where(and(eq(sponsorMember.userId, userId), live))
    .orderBy(asc(sponsorMember.sponsorId));
  return rows.map((r) => r.id);
}

/** A sponsor by slug, for its portal pages. No secret. */
export async function sponsorBySlug(db: Db, slug: string) {
  const [found] = await db
    .select({
      id: sponsor.id,
      leagueId: sponsor.leagueId,
      name: sponsor.name,
      slug: sponsor.slug,
      kind: sponsor.kind,
      isHomeBar: sponsor.isHomeBar,
      blurb: sponsor.blurb,
      address: sponsor.address,
      url: sponsor.url,
    })
    .from(sponsor)
    .where(and(eq(sponsor.slug, slug), live));
  return found ?? null;
}

/** A sponsor and its secret, for making and checking check-in codes. */
export async function sponsorForCheckIn(db: Db, slug: string) {
  const [found] = await db
    .select({
      id: sponsor.id,
      name: sponsor.name,
      slug: sponsor.slug,
      secret: sponsor.checkinSecret,
    })
    .from(sponsor)
    .where(and(eq(sponsor.slug, slug), live));
  return found ?? null;
}

/** Every deal of a sponsor, turned-off ones last, for its portal. */
export async function sponsorDeals(db: Db, sponsorId: SponsorId) {
  return db
    .select({
      ...dealTerms,
      active: deal.active,
      confirmedAt: deal.confirmedAt,
    })
    .from(deal)
    .where(eq(deal.sponsorId, sponsorId))
    .orderBy(desc(deal.active), asc(deal.createdAt), asc(deal.id));
}

/** The people who manage a sponsor. */
export async function sponsorMembers(db: Db, sponsorId: SponsorId) {
  return db
    .select({
      userId: sponsorMember.userId,
      email: user.email,
      name: sql<string>`coalesce(nullif(trim(concat_ws(' ', ${profile.firstName}, ${profile.lastName})), ''), ${user.name})`,
    })
    .from(sponsorMember)
    .innerJoin(user, eq(sponsorMember.userId, user.id))
    .leftJoin(profile, eq(profile.userId, user.id))
    .where(eq(sponsorMember.sponsorId, sponsorId))
    .orderBy(asc(user.email));
}

export type SponsorDetails = {
  name: string;
  slug: string;
  kind: SponsorKind;
  isHomeBar: boolean;
  blurb: string | null;
  address: string | null;
  url: string | null;
};

export type SponsorSaveError = "slug_taken";

const isUniqueViolation = (error: unknown, constraint: string) =>
  typeof error === "object" &&
  error !== null &&
  "constraint" in error &&
  (error as { constraint?: unknown }).constraint === constraint;

/** Clears the home-bar mark from every other sponsor in the league. */
async function oneHomeBar(db: Db, leagueId: LeagueId, keep: SponsorId | null) {
  await db
    .update(sponsor)
    .set({ isHomeBar: false })
    .where(
      and(
        eq(sponsor.leagueId, leagueId),
        eq(sponsor.isHomeBar, true),
        keep ? ne(sponsor.id, keep) : undefined,
      ),
    );
}

/** Adds a sponsor. Marking it the home bar takes the mark from the old one. */
export async function createSponsor(
  db: Db,
  input: SponsorDetails & { leagueId: LeagueId; actorId: UserId },
): Promise<Result<SponsorId, SponsorSaveError>> {
  const taken = await db
    .select({ id: sponsor.id })
    .from(sponsor)
    .where(
      and(eq(sponsor.leagueId, input.leagueId), eq(sponsor.slug, input.slug)),
    );
  if (taken.length > 0) return err("slug_taken");
  if (input.isHomeBar) await oneHomeBar(db, input.leagueId, null);
  const { actorId, ...details } = input;
  const [created] = await db
    .insert(sponsor)
    .values({
      ...details,
      checkinSecret: newCheckinSecret(),
      createdBy: actorId,
    })
    .returning({ id: sponsor.id });
  if (!created) throw new Error("The sponsor was not created");
  await recordAudit(db, {
    actorId,
    action: "sponsor.create",
    entityType: "sponsor",
    entityId: created.id,
    after: details,
  });
  return ok(created.id);
}

/**
 * Changes a sponsor's details. Only an admin changes its slug, kind or the
 * home-bar mark; a sponsor's own people change what players read.
 */
export async function updateSponsor(
  db: Db,
  input: {
    sponsorId: SponsorId;
    details: SponsorDetails;
    asAdmin: boolean;
    actorId: UserId;
  },
): Promise<Result<void, SponsorSaveError | "not_found">> {
  const [before] = await db
    .select({
      leagueId: sponsor.leagueId,
      name: sponsor.name,
      slug: sponsor.slug,
      kind: sponsor.kind,
      isHomeBar: sponsor.isHomeBar,
      blurb: sponsor.blurb,
      address: sponsor.address,
      url: sponsor.url,
    })
    .from(sponsor)
    .where(and(eq(sponsor.id, input.sponsorId), live));
  if (!before) return err("not_found");
  const { leagueId, ...old } = before;
  const next: SponsorDetails = input.asAdmin
    ? input.details
    : {
        ...input.details,
        slug: old.slug,
        kind: old.kind,
        isHomeBar: old.isHomeBar,
      };
  if (next.slug !== old.slug) {
    const taken = await db
      .select({ id: sponsor.id })
      .from(sponsor)
      .where(and(eq(sponsor.leagueId, leagueId), eq(sponsor.slug, next.slug)));
    if (taken.length > 0) return err("slug_taken");
  }
  if (next.isHomeBar && !old.isHomeBar)
    await oneHomeBar(db, leagueId, input.sponsorId);
  try {
    await db.update(sponsor).set(next).where(eq(sponsor.id, input.sponsorId));
  } catch (error) {
    if (isUniqueViolation(error, "sponsor_league_slug_unique"))
      return err("slug_taken");
    throw error;
  }
  await recordAudit(db, {
    actorId: input.actorId,
    action: "sponsor.update",
    entityType: "sponsor",
    entityId: input.sponsorId,
    before: old,
    after: next,
  });
  return ok(undefined);
}

/** Hides a sponsor from the public and its people; its numbers stay. */
export async function removeSponsor(
  db: Db,
  input: { sponsorId: SponsorId; actorId: UserId; now: Date },
): Promise<void> {
  await db
    .update(sponsor)
    .set({ deletedAt: input.now, isHomeBar: false })
    .where(and(eq(sponsor.id, input.sponsorId), live));
  await recordAudit(db, {
    actorId: input.actorId,
    action: "sponsor.remove",
    entityType: "sponsor",
    entityId: input.sponsorId,
  });
}

/** Gives a person with an account the sponsor's portal. */
export async function addSponsorMember(
  db: Db,
  input: { sponsorId: SponsorId; email: string; actorId: UserId },
): Promise<Result<void, "no_account" | "already_member">> {
  const [person] = await db
    .select({ id: user.id })
    .from(user)
    .where(sql`lower(${user.email}) = lower(${input.email.trim()})`);
  if (!person) return err("no_account");
  const added = await db
    .insert(sponsorMember)
    .values({ sponsorId: input.sponsorId, userId: person.id })
    .onConflictDoNothing()
    .returning({ id: sponsorMember.id });
  if (added.length === 0) return err("already_member");
  await recordAudit(db, {
    actorId: input.actorId,
    action: "sponsor.add_member",
    entityType: "sponsor",
    entityId: input.sponsorId,
    after: { userId: person.id },
  });
  return ok(undefined);
}

export async function removeSponsorMember(
  db: Db,
  input: { sponsorId: SponsorId; userId: UserId; actorId: UserId },
): Promise<void> {
  const removed = await db
    .delete(sponsorMember)
    .where(
      and(
        eq(sponsorMember.sponsorId, input.sponsorId),
        eq(sponsorMember.userId, input.userId),
      ),
    )
    .returning({ id: sponsorMember.id });
  if (removed.length === 0) return;
  await recordAudit(db, {
    actorId: input.actorId,
    action: "sponsor.remove_member",
    entityType: "sponsor",
    entityId: input.sponsorId,
    before: { userId: input.userId },
  });
}

/**
 * Adds a deal, or changes one of this sponsor's deals. Saving a deal
 * confirms it is current.
 */
export async function saveDeal(
  db: Db,
  input: {
    sponsorId: SponsorId;
    dealId: DealId | null;
    terms: DealTerms;
    actorId: UserId;
    now: Date;
  },
): Promise<Result<DealId, "not_found">> {
  const values = {
    title: input.terms.title,
    terms: input.terms.terms,
    validDays: [...input.terms.validDays],
    validFrom: input.terms.validFrom,
    validTo: input.terms.validTo,
    confirmedAt: input.now,
  };
  if (input.dealId === null) {
    const [created] = await db
      .insert(deal)
      .values({
        ...values,
        sponsorId: input.sponsorId,
        createdBy: input.actorId,
      })
      .returning({ id: deal.id });
    if (!created) throw new Error("The deal was not created");
    await recordAudit(db, {
      actorId: input.actorId,
      action: "deal.create",
      entityType: "deal",
      entityId: created.id,
      after: input.terms,
    });
    return ok(created.id);
  }
  const [before] = await db
    .select({
      title: deal.title,
      terms: deal.terms,
      validDays: deal.validDays,
      validFrom: deal.validFrom,
      validTo: deal.validTo,
    })
    .from(deal)
    .where(and(eq(deal.id, input.dealId), eq(deal.sponsorId, input.sponsorId)));
  if (!before) return err("not_found");
  await db.update(deal).set(values).where(eq(deal.id, input.dealId));
  await recordAudit(db, {
    actorId: input.actorId,
    action: "deal.update",
    entityType: "deal",
    entityId: input.dealId,
    before,
    after: input.terms,
  });
  return ok(input.dealId);
}

/** Turns a deal off or back on. Turning one on confirms it. */
export async function setDealActive(
  db: Db,
  input: {
    sponsorId: SponsorId;
    dealId: DealId;
    active: boolean;
    actorId: UserId;
    now: Date;
  },
): Promise<Result<void, "not_found">> {
  const changed = await db
    .update(deal)
    .set(
      input.active
        ? { active: true, confirmedAt: input.now }
        : { active: false },
    )
    .where(and(eq(deal.id, input.dealId), eq(deal.sponsorId, input.sponsorId)))
    .returning({ id: deal.id });
  if (changed.length === 0) return err("not_found");
  await recordAudit(db, {
    actorId: input.actorId,
    action: input.active ? "deal.turn_on" : "deal.turn_off",
    entityType: "deal",
    entityId: input.dealId,
  });
  return ok(undefined);
}

/** "Still current": stamps every active deal as confirmed now. */
export async function confirmDeals(
  db: Db,
  input: { sponsorId: SponsorId; actorId: UserId; now: Date },
): Promise<number> {
  const confirmed = await db
    .update(deal)
    .set({ confirmedAt: input.now })
    .where(and(eq(deal.sponsorId, input.sponsorId), eq(deal.active, true)))
    .returning({ id: deal.id });
  if (confirmed.length > 0)
    await recordAudit(db, {
      actorId: input.actorId,
      action: "deal.confirm",
      entityType: "sponsor",
      entityId: input.sponsorId,
      after: { deals: confirmed.length },
    });
  return confirmed.length;
}

/** The team a player is on in a season being played, if any. */
async function currentTeamOf(
  db: Db,
  userId: UserId,
): Promise<TeamSeasonId | null> {
  const [found] = await db
    .select({ teamSeasonId: rosterMembership.teamSeasonId })
    .from(rosterMembership)
    .innerJoin(
      registration,
      eq(rosterMembership.registrationId, registration.id),
    )
    .innerJoin(season, eq(registration.seasonId, season.id))
    .where(
      and(
        eq(registration.userId, userId),
        eq(rosterMembership.status, "active"),
        inArray(season.status, ["in_progress", "playoffs"]),
      ),
    )
    .orderBy(desc(season.startsOn))
    .limit(1);
  return found?.teamSeasonId ?? null;
}

/**
 * Checks a player in at a sponsor for the day. A second scan on the same
 * day keeps the first check-in.
 */
export async function checkIn(
  db: Db,
  input: { sponsorId: SponsorId; userId: UserId; onDate: string; now: Date },
): Promise<{ checkinId: CheckinId; first: boolean }> {
  const teamSeasonId = await currentTeamOf(db, input.userId);
  const [created] = await db
    .insert(checkin)
    .values({
      sponsorId: input.sponsorId,
      userId: input.userId,
      teamSeasonId,
      onDate: input.onDate,
      checkedInAt: input.now,
    })
    .onConflictDoNothing()
    .returning({ id: checkin.id });
  if (created) return { checkinId: created.id, first: true };
  const visit = await todaysVisit(db, input);
  if (!visit) throw new Error("The check-in is missing");
  return { checkinId: visit.checkinId, first: false };
}

/** A player's check-in at a sponsor today, with the deals they used. */
export async function todaysVisit(
  db: Db,
  input: { sponsorId: SponsorId; userId: UserId; onDate: string },
) {
  const [visit] = await db
    .select({ checkinId: checkin.id, checkedInAt: checkin.checkedInAt })
    .from(checkin)
    .where(
      and(
        eq(checkin.sponsorId, input.sponsorId),
        eq(checkin.userId, input.userId),
        eq(checkin.onDate, input.onDate),
      ),
    );
  if (!visit) return null;
  const used = await db
    .select({ dealId: dealRedemption.dealId, at: dealRedemption.redeemedAt })
    .from(dealRedemption)
    .where(eq(dealRedemption.checkinId, visit.checkinId));
  return { ...visit, used };
}

export type RedeemError = "not_checked_in" | "not_available" | "already_used";

/**
 * Uses a deal on today's check-in: the deal must be this sponsor's, turned
 * on and good right now. Once per deal per visit.
 */
export async function redeemDeal(
  db: Db,
  input: {
    sponsorId: SponsorId;
    dealId: DealId;
    userId: UserId;
    /** Local date and HH:MM in the league's time zone. */
    onDate: string;
    time: string;
    now: Date;
  },
): Promise<Result<void, RedeemError>> {
  const visit = await todaysVisit(db, input);
  if (!visit) return err("not_checked_in");
  const [offered] = await db
    .select({
      validDays: deal.validDays,
      validFrom: deal.validFrom,
      validTo: deal.validTo,
    })
    .from(deal)
    .where(
      and(
        eq(deal.id, input.dealId),
        eq(deal.sponsorId, input.sponsorId),
        eq(deal.active, true),
      ),
    );
  if (!offered || !dealApplies(offered, input.onDate, input.time))
    return err("not_available");
  const used = await db
    .insert(dealRedemption)
    .values({
      dealId: input.dealId,
      checkinId: visit.checkinId,
      userId: input.userId,
      redeemedAt: input.now,
    })
    .onConflictDoNothing()
    .returning({ id: dealRedemption.id });
  return used.length > 0 ? ok(undefined) : err("already_used");
}

/**
 * The sponsor's numbers by week (Monday start) from `from` on: check-ins,
 * different players, teams and deals used, and each deal's count. Two
 * grouped queries, run together.
 */
export async function sponsorWeeklyCounts(
  db: Db,
  sponsorId: SponsorId,
  from: string,
): Promise<{ weeks: WeekCounts[]; deals: DealCount[] }> {
  const week = sql<string>`to_char(date_trunc('week', ${checkin.onDate}), 'YYYY-MM-DD')`;
  const [weeks, deals] = await Promise.all([
    db
      .select({
        weekOf: week,
        checkIns: sql<number>`count(distinct ${checkin.id})::int`,
        players: sql<number>`count(distinct ${checkin.userId})::int`,
        teams: sql<number>`count(distinct ${checkin.teamSeasonId})::int`,
        dealsUsed: sql<number>`count(${dealRedemption.id})::int`,
      })
      .from(checkin)
      .leftJoin(dealRedemption, eq(dealRedemption.checkinId, checkin.id))
      .where(and(eq(checkin.sponsorId, sponsorId), gte(checkin.onDate, from)))
      .groupBy(week),
    db
      .select({
        weekOf: week,
        dealId: dealRedemption.dealId,
        count: sql<number>`count(*)::int`,
      })
      .from(dealRedemption)
      .innerJoin(checkin, eq(dealRedemption.checkinId, checkin.id))
      .where(and(eq(checkin.sponsorId, sponsorId), gte(checkin.onDate, from)))
      .groupBy(week, dealRedemption.dealId),
  ]);
  return { weeks, deals };
}

/** The teams that came in most over the same weeks. */
export async function sponsorTopTeams(
  db: Db,
  sponsorId: SponsorId,
  from: string,
  limit = 5,
) {
  return db
    .select({
      name: team.name,
      checkIns: sql<number>`count(*)::int`,
    })
    .from(checkin)
    .innerJoin(teamSeason, eq(checkin.teamSeasonId, teamSeason.id))
    .innerJoin(team, eq(teamSeason.teamId, team.id))
    .where(and(eq(checkin.sponsorId, sponsorId), gte(checkin.onDate, from)))
    .groupBy(team.id, team.name)
    .orderBy(desc(sql`count(*)`), asc(team.name))
    .limit(limit);
}

/** A season's teams of the week, newest first. */
export async function teamsOfWeek(db: Db, seasonId: SeasonId) {
  return db
    .select({
      weekOf: teamOfWeek.weekOf,
      teamSeasonId: teamOfWeek.teamSeasonId,
      teamName: team.name,
      sponsorName: sponsor.name,
      tabCents: teamOfWeek.tabCents,
      reason: teamOfWeek.reason,
    })
    .from(teamOfWeek)
    .innerJoin(teamSeason, eq(teamOfWeek.teamSeasonId, teamSeason.id))
    .innerJoin(team, eq(teamSeason.teamId, team.id))
    .leftJoin(sponsor, eq(teamOfWeek.sponsorId, sponsor.id))
    .where(eq(teamOfWeek.seasonId, seasonId))
    .orderBy(desc(teamOfWeek.weekOf));
}

/** Names (or renames) the team of the week for a game day. */
export async function setTeamOfWeek(
  db: Db,
  input: {
    seasonId: SeasonId;
    weekOf: string;
    teamSeasonId: TeamSeasonId;
    sponsorId: SponsorId | null;
    tabCents: number | null;
    reason: string;
    actorId: UserId;
  },
): Promise<Result<void, "not_in_season">> {
  const [entry] = await db
    .select({ id: teamSeason.id })
    .from(teamSeason)
    .where(
      and(
        eq(teamSeason.id, input.teamSeasonId),
        eq(teamSeason.seasonId, input.seasonId),
      ),
    );
  if (!entry) return err("not_in_season");
  const values = {
    teamSeasonId: input.teamSeasonId,
    sponsorId: input.sponsorId,
    tabCents: input.tabCents,
    reason: input.reason,
  };
  await db
    .insert(teamOfWeek)
    .values({
      ...values,
      seasonId: input.seasonId,
      weekOf: input.weekOf,
      createdBy: input.actorId,
    })
    .onConflictDoUpdate({
      target: [teamOfWeek.seasonId, teamOfWeek.weekOf],
      set: values,
    });
  await recordAudit(db, {
    actorId: input.actorId,
    action: "team_of_week.set",
    entityType: "season",
    entityId: input.seasonId,
    after: { weekOf: input.weekOf, ...values },
  });
  return ok(undefined);
}

export async function removeTeamOfWeek(
  db: Db,
  input: { seasonId: SeasonId; weekOf: string; actorId: UserId },
): Promise<void> {
  const removed = await db
    .delete(teamOfWeek)
    .where(
      and(
        eq(teamOfWeek.seasonId, input.seasonId),
        eq(teamOfWeek.weekOf, input.weekOf),
      ),
    )
    .returning({ id: teamOfWeek.id });
  if (removed.length === 0) return;
  await recordAudit(db, {
    actorId: input.actorId,
    action: "team_of_week.remove",
    entityType: "season",
    entityId: input.seasonId,
    before: { weekOf: input.weekOf },
  });
}

/** Every public sponsor page, for the sitemap and the build's prerendering. */
export async function publicSponsorPages(db: Db) {
  return db
    .select({ slug: sponsor.slug, updatedAt: sponsor.updatedAt })
    .from(sponsor)
    .where(live)
    .orderBy(asc(sponsor.slug));
}
