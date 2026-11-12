import { and, desc, eq, ne } from "drizzle-orm";
import type {
  RegistrationId,
  SeasonId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import { user } from "../schema/auth";
import { payment, purchase, purchaseItem } from "../schema/money";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { recordAudit } from "./audit";
import { settleCoveredRegistrations } from "./payments";
import type { Db } from "./schedule";

/**
 * The admin view of a season's registrations: every team with its roster,
 * waiver and payment status, and the free-agent pool (roadmap week 4 and
 * product-spec.md, "League admin").
 */

export type BoardPerson = {
  registrationId: RegistrationId;
  userId: UserId;
  name: string;
  email: string;
  role: "captain" | "co_captain" | "player" | null;
  status: string;
  signed: boolean;
  paid: boolean;
  /** How they paid, when they did: "stripe", "cash", "venmo" or "other". */
  paidBy: string | null;
};

export type BoardTeam = {
  teamSeasonId: TeamSeasonId;
  name: string;
  colorHex: string | null;
  status: string;
  paymentMode: "full" | "split";
  shareCents: number | null;
  targetRosterSize: number | null;
  members: BoardPerson[];
};

const ROLE_ORDER = { captain: 0, co_captain: 1, player: 2 } as const;

export async function registrationsBoard(
  db: Db,
  seasonId: SeasonId,
): Promise<{
  feeModel: "per_team" | "per_player";
  teams: BoardTeam[];
  freeAgents: BoardPerson[];
}> {
  const [settings] = await db
    .select({ feeModel: season.feeModel })
    .from(season)
    .where(eq(season.id, seasonId));
  const people = await db
    .select({
      registrationId: registration.id,
      userId: registration.userId,
      kind: registration.kind,
      status: registration.status,
      waiverSignatureId: registration.waiverSignatureId,
      firstName: profile.firstName,
      lastName: profile.lastName,
      accountName: user.name,
      email: user.email,
    })
    .from(registration)
    .innerJoin(user, eq(registration.userId, user.id))
    .leftJoin(profile, eq(profile.userId, user.id))
    .where(
      and(
        eq(registration.seasonId, seasonId),
        ne(registration.status, "cancelled"),
      ),
    );
  const spots = await db
    .select({
      registrationId: rosterMembership.registrationId,
      teamSeasonId: rosterMembership.teamSeasonId,
      role: rosterMembership.role,
    })
    .from(rosterMembership)
    .innerJoin(teamSeason, eq(rosterMembership.teamSeasonId, teamSeason.id))
    .where(
      and(
        eq(teamSeason.seasonId, seasonId),
        eq(rosterMembership.status, "active"),
      ),
    );
  const paidBy = await db
    .select({
      registrationId: purchaseItem.registrationId,
      method: payment.method,
    })
    .from(purchaseItem)
    .innerJoin(purchase, eq(purchaseItem.purchaseId, purchase.id))
    .innerJoin(payment, eq(payment.purchaseId, purchase.id))
    .where(and(eq(purchase.seasonId, seasonId), eq(purchase.status, "paid")))
    .orderBy(desc(payment.createdAt));
  const entries = await db
    .select({
      teamSeasonId: teamSeason.id,
      name: team.name,
      colorHex: team.colorHex,
      status: teamSeason.status,
      paymentMode: teamSeason.paymentMode,
      shareCents: teamSeason.shareCents,
      targetRosterSize: teamSeason.targetRosterSize,
    })
    .from(teamSeason)
    .innerJoin(team, eq(teamSeason.teamId, team.id))
    .where(
      and(
        eq(teamSeason.seasonId, seasonId),
        ne(teamSeason.status, "withdrawn"),
      ),
    );

  const spotOf = new Map(spots.map((s) => [s.registrationId, s]));
  const methodOf = new Map<string, string>();
  for (const p of paidBy)
    if (p.registrationId && !methodOf.has(p.registrationId))
      methodOf.set(p.registrationId, p.method);

  const toPerson = (p: (typeof people)[number]): BoardPerson => ({
    registrationId: p.registrationId,
    userId: p.userId,
    name:
      p.firstName && p.lastName
        ? `${p.firstName} ${p.lastName}`
        : p.accountName || p.email,
    email: p.email,
    role: spotOf.get(p.registrationId)?.role ?? null,
    status: p.status,
    signed: p.waiverSignatureId !== null || p.status !== "pending_waiver",
    paid: p.status === "active",
    paidBy: methodOf.get(p.registrationId) ?? null,
  });

  const teams = entries
    .map((e) => ({
      ...e,
      members: people
        .filter(
          (p) => spotOf.get(p.registrationId)?.teamSeasonId === e.teamSeasonId,
        )
        .map(toPerson)
        .sort(
          (a, b) =>
            ROLE_ORDER[a.role ?? "player"] - ROLE_ORDER[b.role ?? "player"] ||
            a.name.localeCompare(b.name),
        ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const freeAgents = people
    .filter((p) => !spotOf.has(p.registrationId))
    .map(toPerson)
    .sort((a, b) => a.name.localeCompare(b.name));
  return { feeModel: settings?.feeModel ?? "per_player", teams, freeAgents };
}

export type PlaceError =
  "unknown_registration" | "already_on_team" | "unknown_team" | "full";

/** Puts a free agent on a team in the same season (free_agents.place). */
export async function placeFreeAgent(
  db: Db,
  input: {
    seasonId: SeasonId;
    registrationId: RegistrationId;
    teamSeasonId: TeamSeasonId;
    actorId: UserId;
    now: Date;
  },
): Promise<Result<void, PlaceError>> {
  const [entry] = await db
    .select({ id: registration.id })
    .from(registration)
    .where(
      and(
        eq(registration.id, input.registrationId),
        eq(registration.seasonId, input.seasonId),
        ne(registration.status, "cancelled"),
      ),
    );
  if (!entry) return err("unknown_registration");
  const [spot] = await db
    .select({ id: rosterMembership.id })
    .from(rosterMembership)
    .where(
      and(
        eq(rosterMembership.registrationId, input.registrationId),
        eq(rosterMembership.status, "active"),
      ),
    );
  if (spot) return err("already_on_team");
  const [target] = await db
    .select({ rosterMax: season.rosterMax })
    .from(teamSeason)
    .innerJoin(season, eq(teamSeason.seasonId, season.id))
    .where(
      and(
        eq(teamSeason.id, input.teamSeasonId),
        eq(teamSeason.seasonId, input.seasonId),
        ne(teamSeason.status, "withdrawn"),
      ),
    );
  if (!target) return err("unknown_team");
  const members = await db
    .select({ id: rosterMembership.id })
    .from(rosterMembership)
    .where(
      and(
        eq(rosterMembership.teamSeasonId, input.teamSeasonId),
        eq(rosterMembership.status, "active"),
      ),
    );
  if (members.length >= target.rosterMax) return err("full");

  await db
    .update(registration)
    .set({ kind: "team_member" })
    .where(eq(registration.id, input.registrationId));
  await db.insert(rosterMembership).values({
    teamSeasonId: input.teamSeasonId,
    registrationId: input.registrationId,
    role: "player",
    status: "active",
    startedAt: input.now,
    createdBy: input.actorId,
  });
  await settleCoveredRegistrations(db, input.teamSeasonId);
  await recordAudit(db, {
    actorId: input.actorId,
    action: "free_agents.place",
    entityType: "registration",
    entityId: input.registrationId,
    after: { teamSeasonId: input.teamSeasonId },
  });
  return ok(undefined);
}

/** A registration with what checkout needs, for recording an off-app payment. */
export async function registrationForPayment(
  db: Db,
  seasonId: SeasonId,
  registrationId: RegistrationId,
) {
  const [found] = await db
    .select({
      id: registration.id,
      userId: registration.userId,
      kind: registration.kind,
      status: registration.status,
    })
    .from(registration)
    .where(
      and(
        eq(registration.id, registrationId),
        eq(registration.seasonId, seasonId),
      ),
    );
  if (!found) return null;
  const [spot] = await db
    .select({
      teamSeasonId: teamSeason.id,
      teamName: team.name,
      role: rosterMembership.role,
      paymentMode: teamSeason.paymentMode,
      shareCents: teamSeason.shareCents,
      targetRosterSize: teamSeason.targetRosterSize,
    })
    .from(rosterMembership)
    .innerJoin(teamSeason, eq(rosterMembership.teamSeasonId, teamSeason.id))
    .innerJoin(team, eq(teamSeason.teamId, team.id))
    .where(
      and(
        eq(rosterMembership.registrationId, registrationId),
        eq(rosterMembership.status, "active"),
      ),
    );
  return { ...found, team: spot ?? null };
}
