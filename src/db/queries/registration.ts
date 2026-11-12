import { and, eq, inArray, ne, notInArray } from "drizzle-orm";
import type {
  LeagueId,
  RegistrationId,
  SeasonId,
  TeamId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import {
  type PricedSeason,
  priceFor,
  registrationWindow,
} from "@/domain/registration/pricing";
import { err, ok, type Result } from "@/domain/result";
import { slugify } from "@/domain/slug";
import { season } from "../schema/season";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { waiverSignature } from "../schema/waiver";
import { recordAudit } from "./audit";
import type { Db } from "./schedule";

/** Season registration (roadmap week 4): teams and free agents, up to payment. */

export async function seasonForRegistration(
  db: Db,
  leagueId: LeagueId,
  slug: string,
) {
  const [found] = await db
    .select({
      id: season.id,
      name: season.name,
      slug: season.slug,
      startsOn: season.startsOn,
      status: season.status,
      feeModel: season.feeModel,
      teamFeeCents: season.teamFeeCents,
      playerFeeCents: season.playerFeeCents,
      freeAgentFeeCents: season.freeAgentFeeCents,
      earlyBirdEndsAt: season.earlyBirdEndsAt,
      earlyBirdDiscountCents: season.earlyBirdDiscountCents,
      registrationOpensAt: season.registrationOpensAt,
      registrationClosesAt: season.registrationClosesAt,
      paymentDeadlineAt: season.paymentDeadlineAt,
      maxTeams: season.maxTeams,
      rosterMin: season.rosterMin,
      rosterMax: season.rosterMax,
      waiverId: season.waiverId,
    })
    .from(season)
    .where(and(eq(season.leagueId, leagueId), eq(season.slug, slug)));
  return found ?? null;
}

export type SeasonForRegistration = NonNullable<
  Awaited<ReturnType<typeof seasonForRegistration>>
>;

/** Seasons a player can register for right now, soonest first. */
export async function openSeasons(db: Db, leagueId: LeagueId, now: Date) {
  const rows = await db
    .select({
      slug: season.slug,
      name: season.name,
      startsOn: season.startsOn,
      status: season.status,
      feeModel: season.feeModel,
      teamFeeCents: season.teamFeeCents,
      playerFeeCents: season.playerFeeCents,
      freeAgentFeeCents: season.freeAgentFeeCents,
      earlyBirdEndsAt: season.earlyBirdEndsAt,
      earlyBirdDiscountCents: season.earlyBirdDiscountCents,
      registrationOpensAt: season.registrationOpensAt,
      registrationClosesAt: season.registrationClosesAt,
    })
    .from(season)
    .where(
      and(
        eq(season.leagueId, leagueId),
        eq(season.status, "registration_open"),
      ),
    )
    .orderBy(season.startsOn);
  return rows.filter((s) => registrationWindow(s, now) === "open");
}

/** Teams still in the running take a spot; withdrawn ones do not. */
async function teamsEntered(db: Db, seasonId: SeasonId) {
  const rows = await db
    .select({ id: teamSeason.id })
    .from(teamSeason)
    .where(
      and(
        eq(teamSeason.seasonId, seasonId),
        notInArray(teamSeason.status, ["withdrawn", "waitlisted"]),
      ),
    );
  return rows.length;
}

/** Teams this person captained in the league before, to bring one back. */
export async function teamsCaptainedBy(
  db: Db,
  leagueId: LeagueId,
  userId: UserId,
) {
  const rows = await db
    .selectDistinct({ id: team.id, name: team.name, colorHex: team.colorHex })
    .from(rosterMembership)
    .innerJoin(
      registration,
      eq(rosterMembership.registrationId, registration.id),
    )
    .innerJoin(teamSeason, eq(rosterMembership.teamSeasonId, teamSeason.id))
    .innerJoin(team, eq(teamSeason.teamId, team.id))
    .where(
      and(
        eq(registration.userId, userId),
        inArray(rosterMembership.role, ["captain", "co_captain"]),
        eq(team.leagueId, leagueId),
      ),
    );
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export type RegisterError =
  | "closed"
  | "already_registered"
  | "no_price"
  | "season_full"
  | "bad_name"
  | "name_taken"
  | "bad_roster_size"
  | "bad_color";

async function alreadyRegistered(db: Db, seasonId: SeasonId, userId: UserId) {
  const [found] = await db
    .select({ id: registration.id })
    .from(registration)
    .where(
      and(
        eq(registration.seasonId, seasonId),
        eq(registration.userId, userId),
        ne(registration.status, "cancelled"),
      ),
    );
  return found !== undefined;
}

/**
 * The new registration's starting state: if the person already signed the
 * season's waiver, it skips straight to payment.
 */
export async function startingState(
  db: Db,
  s: SeasonForRegistration,
  userId: UserId,
) {
  if (!s.waiverId)
    return { status: "pending_waiver" as const, waiverSignatureId: null };
  const [signed] = await db
    .select({ id: waiverSignature.id })
    .from(waiverSignature)
    .where(
      and(
        eq(waiverSignature.waiverId, s.waiverId),
        eq(waiverSignature.seasonId, s.id),
        eq(waiverSignature.userId, userId),
      ),
    );
  return signed
    ? { status: "pending_payment" as const, waiverSignatureId: signed.id }
    : { status: "pending_waiver" as const, waiverSignatureId: null };
}

/** Joins the free-agent pool; an admin places free agents on teams later. */
export async function registerFreeAgent(
  db: Db,
  input: { season: SeasonForRegistration; userId: UserId; now: Date },
): Promise<Result<RegistrationId, RegisterError>> {
  const { season: s, userId, now } = input;
  if (registrationWindow(s, now) !== "open") return err("closed");
  if (await alreadyRegistered(db, s.id, userId))
    return err("already_registered");
  if (!priceFor(s, { kind: "free_agent" }, now).ok) return err("no_price");
  const [created] = await db
    .insert(registration)
    .values({
      seasonId: s.id,
      userId,
      kind: "free_agent",
      ...(await startingState(db, s, userId)),
      createdBy: userId,
    })
    .returning({ id: registration.id });
  return ok((created as { id: RegistrationId }).id);
}

export type TeamInput = {
  /** A team the person captained before, or null for a new team. */
  teamId: TeamId | null;
  name: string;
  colorHex: string | null;
  paymentMode: "full" | "split";
  rosterSize: number;
};

/**
 * Registers a team with the person as captain: the team (new, or one they
 * captained before), its season entry with the payment mode and fixed share,
 * their registration and their captain spot.
 */
export async function registerTeam(
  db: Db,
  input: {
    leagueId: LeagueId;
    season: SeasonForRegistration;
    userId: UserId;
    team: TeamInput;
    now: Date;
  },
): Promise<
  Result<
    { teamSeasonId: TeamSeasonId; shareCents: number | null },
    RegisterError
  >
> {
  const { season: s, userId, now, team: t } = input;
  if (registrationWindow(s, now) !== "open") return err("closed");
  if (await alreadyRegistered(db, s.id, userId))
    return err("already_registered");
  if (
    !Number.isInteger(t.rosterSize) ||
    t.rosterSize < s.rosterMin ||
    t.rosterSize > s.rosterMax
  )
    return err("bad_roster_size");
  if (t.colorHex !== null && !/^#[0-9A-Fa-f]{6}$/.test(t.colorHex))
    return err("bad_color");
  // Per player, everyone pays their own fee; there is nothing to split.
  const paymentMode = s.feeModel === "per_player" ? "full" : t.paymentMode;
  const price = priceFor(
    s,
    { kind: "captain", paymentMode, rosterSize: t.rosterSize },
    now,
  );
  if (!price.ok) return err("no_price");
  if (s.maxTeams !== null && (await teamsEntered(db, s.id)) >= s.maxTeams)
    return err("season_full");

  let teamId: TeamId;
  if (t.teamId) {
    const mine = await teamsCaptainedBy(db, input.leagueId, userId);
    const found = mine.find((m) => m.id === t.teamId);
    if (!found) return err("bad_name");
    const [entered] = await db
      .select({ id: teamSeason.id })
      .from(teamSeason)
      .where(
        and(eq(teamSeason.teamId, found.id), eq(teamSeason.seasonId, s.id)),
      );
    if (entered) return err("name_taken");
    teamId = found.id;
  } else {
    const name = t.name.trim().replace(/\s+/g, " ");
    const slug = slugify(name);
    if (!slug || name.length > 40) return err("bad_name");
    const [taken] = await db
      .select({ id: team.id })
      .from(team)
      .where(and(eq(team.leagueId, input.leagueId), eq(team.slug, slug)));
    if (taken) return err("name_taken");
    const [created] = await db
      .insert(team)
      .values({
        leagueId: input.leagueId,
        name,
        slug,
        colorHex: t.colorHex,
        createdBy: userId,
      })
      .returning({ id: team.id });
    teamId = (created as { id: TeamId }).id;
  }

  const [entry] = await db
    .insert(teamSeason)
    .values({
      teamId,
      seasonId: s.id,
      status: "forming",
      paymentMode,
      shareCents: price.shareCents,
      targetRosterSize: t.rosterSize,
      createdBy: userId,
    })
    .returning({ id: teamSeason.id });
  const teamSeasonId = (entry as { id: TeamSeasonId }).id;
  const [own] = await db
    .insert(registration)
    .values({
      seasonId: s.id,
      userId,
      kind: "team_member",
      ...(await startingState(db, s, userId)),
      createdBy: userId,
    })
    .returning({ id: registration.id });
  await db.insert(rosterMembership).values({
    teamSeasonId,
    registrationId: (own as { id: RegistrationId }).id,
    role: "captain",
    status: "active",
    startedAt: now,
    createdBy: userId,
  });
  await recordAudit(db, {
    actorId: userId,
    action: "team.register",
    entityType: "team_season",
    entityId: teamSeasonId,
    after: {
      teamId,
      seasonId: s.id,
      paymentMode,
      shareCents: price.shareCents,
      rosterSize: t.rosterSize,
    },
  });
  return ok({ teamSeasonId, shareCents: price.shareCents });
}

/** The person's registration for a season, with their team if any. */
export async function myRegistration(
  db: Db,
  seasonId: SeasonId,
  userId: UserId,
) {
  const [found] = await db
    .select({
      id: registration.id,
      kind: registration.kind,
      status: registration.status,
      waiverSignatureId: registration.waiverSignatureId,
    })
    .from(registration)
    .where(
      and(
        eq(registration.seasonId, seasonId),
        eq(registration.userId, userId),
        ne(registration.status, "cancelled"),
      ),
    );
  if (!found) return null;
  const [spot] = await db
    .select({
      teamSeasonId: teamSeason.id,
      role: rosterMembership.role,
      teamName: team.name,
      teamColor: team.colorHex,
      paymentMode: teamSeason.paymentMode,
      shareCents: teamSeason.shareCents,
      targetRosterSize: teamSeason.targetRosterSize,
    })
    .from(rosterMembership)
    .innerJoin(teamSeason, eq(rosterMembership.teamSeasonId, teamSeason.id))
    .innerJoin(team, eq(teamSeason.teamId, team.id))
    .where(
      and(
        eq(rosterMembership.registrationId, found.id),
        eq(rosterMembership.status, "active"),
      ),
    );
  return { ...found, team: spot ?? null };
}

export type MyRegistration = NonNullable<
  Awaited<ReturnType<typeof myRegistration>>
>;

/**
 * What this registration owes today, from the season's prices and its team.
 * A split share is fixed when the team registers; the amount actually paid
 * is fixed when checkout creates the purchase.
 */
export function amountOwed(s: PricedSeason, r: MyRegistration, now: Date) {
  if (r.kind === "free_agent") return priceFor(s, { kind: "free_agent" }, now);
  if (r.team?.role === "captain")
    return priceFor(
      s,
      {
        kind: "captain",
        paymentMode: r.team.paymentMode,
        rosterSize: r.team.targetRosterSize ?? 1,
      },
      now,
    );
  return priceFor(
    s,
    { kind: "teammate", shareCents: r.team?.shareCents ?? null },
    now,
  );
}
