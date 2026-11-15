import { and, count, desc, eq, inArray, max, sql } from "drizzle-orm";
import type {
  ConductCodeId,
  LeagueId,
  SeasonId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import {
  checkConductDraft,
  type ConductDraftErrors,
  hashConductBody,
  normalizeConductBody,
} from "@/domain/conduct/conduct";
import { err, ok, type Result } from "@/domain/result";
import { user } from "../schema/auth";
import { conductAcceptance, conductCode } from "../schema/conduct";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { rosterMembership, team, teamSeason } from "../schema/team";
import { registration } from "../schema/team";
import { recordAudit } from "./audit";
import { required } from "./rows";
import type { Db } from "./schedule";

const columns = {
  id: conductCode.id,
  version: conductCode.version,
  title: conductCode.title,
  bodyMd: conductCode.bodyMd,
  bodySha256: conductCode.bodySha256,
  createdAt: conductCode.createdAt,
};

/** The league's newest version, or null before one is published. */
export async function currentConductCode(db: Db, leagueId: LeagueId) {
  const [found] = await db
    .select(columns)
    .from(conductCode)
    .where(eq(conductCode.leagueId, leagueId))
    .orderBy(desc(conductCode.version))
    .limit(1);
  return found ?? null;
}

/** Every version, newest first, with how many people accepted each. */
export async function conductVersions(db: Db, leagueId: LeagueId) {
  const rows = await db
    .select({
      id: conductCode.id,
      version: conductCode.version,
      title: conductCode.title,
      bodySha256: conductCode.bodySha256,
      createdAt: conductCode.createdAt,
      accepted: count(conductAcceptance.id),
    })
    .from(conductCode)
    .leftJoin(conductAcceptance, eq(conductAcceptance.codeId, conductCode.id))
    .where(eq(conductCode.leagueId, leagueId))
    .groupBy(conductCode.id)
    .orderBy(desc(conductCode.version));
  return rows;
}

/** Publishes the text as the next version. Versions are never edited. */
export async function publishConductCode(
  db: Db,
  input: { leagueId: LeagueId; title: string; body: string },
  actorId: UserId,
): Promise<Result<{ id: ConductCodeId; version: number }, ConductDraftErrors>> {
  const errors = checkConductDraft(input.title, input.body);
  if (Object.keys(errors).length > 0) return err(errors);
  const [latest] = await db
    .select({ version: max(conductCode.version) })
    .from(conductCode)
    .where(eq(conductCode.leagueId, input.leagueId));
  const version = (latest?.version ?? 0) + 1;
  const bodyMd = normalizeConductBody(input.body);
  const [created] = await db
    .insert(conductCode)
    .values({
      leagueId: input.leagueId,
      version,
      title: input.title.trim(),
      bodyMd,
      bodySha256: hashConductBody(bodyMd),
      createdBy: actorId,
    })
    .returning({ id: conductCode.id });
  const id = required(created, "conduct code").id;
  await recordAudit(db, {
    actorId,
    action: "conduct.publish",
    entityType: "conduct_code",
    entityId: id,
    after: { version, title: input.title.trim() },
  });
  return ok({ id, version });
}

/**
 * The league's current code and whether the person accepted it, for the
 * waiver step. Null code: the league has none, so nothing is asked.
 */
export async function conductForPerson(
  db: Db,
  leagueId: LeagueId,
  userId: UserId,
) {
  const code = await currentConductCode(db, leagueId);
  if (!code) return null;
  const [accepted] = await db
    .select({ acceptedAt: conductAcceptance.acceptedAt })
    .from(conductAcceptance)
    .where(
      and(
        eq(conductAcceptance.codeId, code.id),
        eq(conductAcceptance.userId, userId),
      ),
    );
  return { code, acceptedAt: accepted?.acceptedAt ?? null };
}

export type ConductRefusal = "conduct_not_accepted" | "conduct_changed";

/**
 * Checks and records the acceptance that goes with signing a season's
 * waiver. Someone who accepted the current version before is not asked
 * again; otherwise they must tick the box for the version they were shown.
 * Returns the refusal, or ok. Call it inside the signing transaction, so a
 * refused acceptance signs nothing.
 */
export async function acceptConduct(
  db: Db,
  input: {
    leagueId: LeagueId;
    seasonId: SeasonId;
    userId: UserId;
    accepted: boolean;
    shownSha256: string;
  },
): Promise<Result<void, ConductRefusal>> {
  const code = await currentConductCode(db, input.leagueId);
  if (!code) return ok(undefined);
  const [already] = await db
    .select({ id: conductAcceptance.id })
    .from(conductAcceptance)
    .where(
      and(
        eq(conductAcceptance.codeId, code.id),
        eq(conductAcceptance.userId, input.userId),
      ),
    );
  if (already) return ok(undefined);
  // The page showed a version that has since been replaced.
  if (input.shownSha256 !== code.bodySha256) return err("conduct_changed");
  if (!input.accepted) return err("conduct_not_accepted");
  await db
    .insert(conductAcceptance)
    .values({
      codeId: code.id,
      userId: input.userId,
      seasonId: input.seasonId,
      bodySha256: code.bodySha256,
    })
    .onConflictDoNothing();
  return ok(undefined);
}

/**
 * Each team's players and whether each accepted the league's current
 * version, for one season. Active and invited players, captains first.
 */
export async function teamAcceptance(
  db: Db,
  leagueId: LeagueId,
  seasonId: SeasonId,
) {
  const code = await currentConductCode(db, leagueId);
  if (!code) return { code: null, teams: [] };
  const rows = await db
    .select({
      teamSeasonId: teamSeason.id,
      teamName: team.name,
      userId: registration.userId,
      first: profile.firstName,
      last: profile.lastName,
      email: user.email,
      role: rosterMembership.role,
      acceptedAt: conductAcceptance.acceptedAt,
    })
    .from(teamSeason)
    .innerJoin(team, eq(team.id, teamSeason.teamId))
    .innerJoin(
      rosterMembership,
      and(
        eq(rosterMembership.teamSeasonId, teamSeason.id),
        inArray(rosterMembership.status, ["active", "invited"]),
      ),
    )
    .innerJoin(
      registration,
      eq(registration.id, rosterMembership.registrationId),
    )
    .innerJoin(user, eq(user.id, registration.userId))
    .leftJoin(profile, eq(profile.userId, registration.userId))
    .leftJoin(
      conductAcceptance,
      and(
        eq(conductAcceptance.userId, registration.userId),
        eq(conductAcceptance.codeId, code.id),
      ),
    )
    .where(eq(teamSeason.seasonId, seasonId))
    .orderBy(team.name, sql`${rosterMembership.role} desc`, profile.lastName);
  const byTeam = new Map<
    TeamSeasonId,
    {
      teamSeasonId: TeamSeasonId;
      teamName: string;
      players: { userId: UserId; name: string; accepted: boolean }[];
    }
  >();
  for (const r of rows) {
    const entry = byTeam.get(r.teamSeasonId) ?? {
      teamSeasonId: r.teamSeasonId,
      teamName: r.teamName,
      players: [],
    };
    entry.players.push({
      userId: r.userId,
      name: r.first && r.last ? `${r.first} ${r.last}` : r.email,
      accepted: r.acceptedAt !== null,
    });
    byTeam.set(r.teamSeasonId, entry);
  }
  return { code, teams: [...byTeam.values()] };
}

/** A person's own acceptances, for their data export. */
export async function myConductAcceptances(db: Db, userId: UserId) {
  return db
    .select({
      code: conductCode.title,
      version: conductCode.version,
      acceptedAt: conductAcceptance.acceptedAt,
      season: season.name,
      textFingerprint: conductAcceptance.bodySha256,
    })
    .from(conductAcceptance)
    .innerJoin(conductCode, eq(conductCode.id, conductAcceptance.codeId))
    .innerJoin(season, eq(season.id, conductAcceptance.seasonId))
    .where(eq(conductAcceptance.userId, userId))
    .orderBy(desc(conductAcceptance.acceptedAt));
}
