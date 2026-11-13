import { asc, eq, inArray } from "drizzle-orm";
import type { LeagueId, UserId } from "@/domain/ids";
import {
  type Feature,
  type GrantableRole,
  type SiteStatus,
} from "@/domain/platform/operator";
import { err, ok, type Result } from "@/domain/result";
import { user } from "../schema/auth";
import { field, game, scoreReport, venue } from "../schema/game";
import { league } from "../schema/league";
import { payment, purchase } from "../schema/money";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { recordAudit } from "./audit";
import { booksExport } from "./books";
import type { Db } from "./schedule";

export type SiteSettings = {
  leagueId: LeagueId;
  name: string;
  status: SiteStatus;
  disabledFeatures: string[];
};

/** The league's site status and switched-off features (one league per deployment). */
export async function siteSettings(db: Db): Promise<SiteSettings | null> {
  const [row] = await db
    .select({
      leagueId: league.id,
      name: league.name,
      status: league.siteStatus,
      disabledFeatures: league.disabledFeatures,
    })
    .from(league)
    .orderBy(asc(league.createdAt))
    .limit(1);
  return row ?? null;
}

/** The operator opens, freezes or pauses the site. Run in a transaction. */
export async function setSiteStatus(
  db: Db,
  input: { leagueId: LeagueId; status: SiteStatus; actorId: UserId },
): Promise<void> {
  const [before] = await db
    .select({ status: league.siteStatus })
    .from(league)
    .where(eq(league.id, input.leagueId))
    .for("update");
  await db
    .update(league)
    .set({ siteStatus: input.status })
    .where(eq(league.id, input.leagueId));
  await recordAudit(db, {
    actorId: input.actorId,
    action: "operator.site_status",
    entityType: "league",
    entityId: input.leagueId,
    before: { status: before?.status ?? null },
    after: { status: input.status },
  });
}

/** The operator switches one feature on or off. Run in a transaction. */
export async function setFeature(
  db: Db,
  input: { leagueId: LeagueId; feature: Feature; on: boolean; actorId: UserId },
): Promise<void> {
  const [row] = await db
    .select({ disabled: league.disabledFeatures })
    .from(league)
    .where(eq(league.id, input.leagueId))
    .for("update");
  const before = row?.disabled ?? [];
  const after = input.on
    ? before.filter((f) => f !== input.feature)
    : [...new Set([...before, input.feature])].sort();
  await db
    .update(league)
    .set({ disabledFeatures: after })
    .where(eq(league.id, input.leagueId));
  await recordAudit(db, {
    actorId: input.actorId,
    action: "operator.feature",
    entityType: "league",
    entityId: input.leagueId,
    before: { disabled: before },
    after: { disabled: after },
  });
}

/**
 * The operator makes a person a player, an admin or an owner. Owners can't
 * use this, and it can't make anyone the operator: that is set only in the
 * server's environment.
 */
export async function setGlobalRole(
  db: Db,
  input: { email: string; role: GrantableRole; actorId: UserId },
): Promise<Result<{ userId: UserId; before: GrantableRole }, "no_account">> {
  const [person] = await db
    .select({ userId: user.id, role: profile.globalRole })
    .from(user)
    .innerJoin(profile, eq(profile.userId, user.id))
    .where(eq(user.email, input.email.trim().toLowerCase()))
    .for("update", { of: profile });
  if (!person) return err("no_account");
  await db
    .update(profile)
    .set({ globalRole: input.role })
    .where(eq(profile.userId, person.userId));
  await recordAudit(db, {
    actorId: input.actorId,
    action: "operator.role",
    entityType: "user",
    entityId: person.userId,
    before: { role: person.role },
    after: { role: input.role },
  });
  return ok({ userId: person.userId, before: person.role });
}

/** People with an admin or owner role, for the console. */
export async function staff(db: Db) {
  return db
    .select({
      userId: user.id,
      email: user.email,
      firstName: profile.firstName,
      lastName: profile.lastName,
      role: profile.globalRole,
    })
    .from(profile)
    .innerJoin(user, eq(user.id, profile.userId))
    .where(inArray(profile.globalRole, ["admin", "owner"]))
    .orderBy(asc(profile.globalRole), asc(user.email));
}

/**
 * Everything the league needs to run elsewhere: its seasons, places, teams,
 * rosters, games, scores and payments. The owners can download it too, so
 * league data is never held back.
 */
export async function leagueExport(db: Db, leagueId: LeagueId) {
  const [lg] = await db
    .select({
      name: league.name,
      slug: league.slug,
      timezone: league.timezone,
      contact: league.contact,
    })
    .from(league)
    .where(eq(league.id, leagueId));
  const seasons = await db
    .select()
    .from(season)
    .where(eq(season.leagueId, leagueId))
    .orderBy(asc(season.startsOn));
  const seasonIds = seasons.map((s) => s.id);
  const anySeason = seasonIds.length > 0;
  const venues = await db
    .select()
    .from(venue)
    .where(eq(venue.leagueId, leagueId));
  const fields = venues.length
    ? await db
        .select()
        .from(field)
        .where(
          inArray(
            field.venueId,
            venues.map((v) => v.id),
          ),
        )
    : [];
  const teams = await db.select().from(team).where(eq(team.leagueId, leagueId));
  const teamSeasons = anySeason
    ? await db
        .select()
        .from(teamSeason)
        .where(inArray(teamSeason.seasonId, seasonIds))
    : [];
  const players = anySeason
    ? await db
        .select({
          registrationId: registration.id,
          seasonId: registration.seasonId,
          kind: registration.kind,
          status: registration.status,
          email: user.email,
          firstName: profile.firstName,
          lastName: profile.lastName,
        })
        .from(registration)
        .innerJoin(user, eq(user.id, registration.userId))
        .leftJoin(profile, eq(profile.userId, registration.userId))
        .where(inArray(registration.seasonId, seasonIds))
    : [];
  const rosters = teamSeasons.length
    ? await db
        .select({
          teamSeasonId: rosterMembership.teamSeasonId,
          registrationId: rosterMembership.registrationId,
          role: rosterMembership.role,
          status: rosterMembership.status,
        })
        .from(rosterMembership)
        .where(
          inArray(
            rosterMembership.teamSeasonId,
            teamSeasons.map((t) => t.id),
          ),
        )
    : [];
  const games = anySeason
    ? await db.select().from(game).where(inArray(game.seasonId, seasonIds))
    : [];
  const scores = games.length
    ? await db
        .select()
        .from(scoreReport)
        .where(
          inArray(
            scoreReport.gameId,
            games.map((g) => g.id),
          ),
        )
    : [];
  const purchases = anySeason
    ? await db
        .select()
        .from(purchase)
        .where(inArray(purchase.seasonId, seasonIds))
    : [];
  const payments = purchases.length
    ? await db
        .select()
        .from(payment)
        .where(
          inArray(
            payment.purchaseId,
            purchases.map((p) => p.id),
          ),
        )
    : [];
  return {
    exportedAt: new Date().toISOString(),
    league: lg ?? null,
    seasons,
    venues,
    fields,
    teams,
    teamSeasons,
    players,
    rosters,
    games,
    scores,
    purchases,
    payments,
    // Expenses, permit details, insurance and file details (not the files).
    books: await booksExport(db, leagueId),
  };
}
