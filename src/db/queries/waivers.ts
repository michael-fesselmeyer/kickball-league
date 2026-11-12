import { and, desc, eq, max } from "drizzle-orm";
import type {
  LeagueId,
  SeasonId,
  UserId,
  WaiverId,
  WaiverSignatureId,
} from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import {
  checkWaiverDraft,
  hashWaiverBody,
  normalizeWaiverBody,
  signatureMatches,
  type WaiverDraftErrors,
} from "@/domain/waiver/waiver";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { registration } from "../schema/team";
import { waiver, waiverSignature } from "../schema/waiver";
import { recordAudit } from "./audit";
import type { Db } from "./schedule";

/** The league's waiver versions, newest first. */
export async function waiversOf(db: Db, leagueId: LeagueId) {
  return db
    .select({
      id: waiver.id,
      version: waiver.version,
      title: waiver.title,
      bodySha256: waiver.bodySha256,
      effectiveAt: waiver.effectiveAt,
    })
    .from(waiver)
    .where(eq(waiver.leagueId, leagueId))
    .orderBy(desc(waiver.version));
}

/** Publishes the text as the next version. Versions are never edited. */
export async function publishWaiver(
  db: Db,
  input: { leagueId: LeagueId; title: string; body: string },
  actorId: UserId,
): Promise<Result<{ id: WaiverId; version: number }, WaiverDraftErrors>> {
  const errors = checkWaiverDraft(input.title, input.body);
  if (Object.keys(errors).length > 0) return err(errors);
  const [latest] = await db
    .select({ version: max(waiver.version) })
    .from(waiver)
    .where(eq(waiver.leagueId, input.leagueId));
  const version = (latest?.version ?? 0) + 1;
  const bodyMd = normalizeWaiverBody(input.body);
  const [created] = await db
    .insert(waiver)
    .values({
      leagueId: input.leagueId,
      version,
      title: input.title.trim(),
      bodyMd,
      bodySha256: hashWaiverBody(bodyMd),
      createdBy: actorId,
    })
    .returning({ id: waiver.id });
  const id = (created as { id: WaiverId }).id;
  await recordAudit(db, {
    actorId,
    action: "waiver.publish",
    entityType: "waiver",
    entityId: id,
    after: { version, title: input.title.trim() },
  });
  return ok({ id, version });
}

/**
 * Sets which waiver version a season's players sign. Anyone who signed an
 * older version signs again; their earlier signature is kept.
 */
export async function assignWaiver(
  db: Db,
  input: { leagueId: LeagueId; seasonId: SeasonId; waiverId: WaiverId | null },
  actorId: UserId,
): Promise<Result<void, "unknown_season" | "unknown_waiver">> {
  const [found] = await db
    .select({ waiverId: season.waiverId })
    .from(season)
    .where(
      and(eq(season.id, input.seasonId), eq(season.leagueId, input.leagueId)),
    );
  if (!found) return err("unknown_season");
  if (input.waiverId !== null) {
    const [own] = await db
      .select({ id: waiver.id })
      .from(waiver)
      .where(
        and(eq(waiver.id, input.waiverId), eq(waiver.leagueId, input.leagueId)),
      );
    if (!own) return err("unknown_waiver");
  }
  if (found.waiverId === input.waiverId) return ok(undefined);
  await db
    .update(season)
    .set({ waiverId: input.waiverId })
    .where(eq(season.id, input.seasonId));
  await recordAudit(db, {
    actorId,
    action: "season.assign_waiver",
    entityType: "season",
    entityId: input.seasonId,
    before: { waiverId: found.waiverId },
    after: { waiverId: input.waiverId },
  });
  return ok(undefined);
}

/** A season's current waiver, and the person's signature of it if any. */
export async function waiverForSeason(
  db: Db,
  input: { leagueId: LeagueId; slug: string; userId: UserId },
) {
  const [found] = await db
    .select({
      seasonId: season.id,
      seasonName: season.name,
      waiverId: waiver.id,
      version: waiver.version,
      title: waiver.title,
      bodyMd: waiver.bodyMd,
      bodySha256: waiver.bodySha256,
    })
    .from(season)
    .leftJoin(waiver, eq(season.waiverId, waiver.id))
    .where(
      and(eq(season.leagueId, input.leagueId), eq(season.slug, input.slug)),
    );
  if (!found) return null;
  const [signature] = found.waiverId
    ? await db
        .select({
          signedName: waiverSignature.signedName,
          signedAt: waiverSignature.signedAt,
        })
        .from(waiverSignature)
        .where(
          and(
            eq(waiverSignature.waiverId, found.waiverId),
            eq(waiverSignature.userId, input.userId),
            eq(waiverSignature.seasonId, found.seasonId),
          ),
        )
    : [];
  return { ...found, signature: signature ?? null };
}

export type SignError =
  | "no_waiver"
  | "changed"
  | "not_agreed"
  | "profile_incomplete"
  | "name_mismatch"
  | "already_signed";

/**
 * Records a signature. `shownSha256` is the hash of the text the page showed;
 * if the season's waiver changed since, nothing is signed. A registration
 * waiting on the waiver moves on to payment in the same transaction.
 */
export async function signWaiver(
  db: Db,
  input: {
    userId: UserId;
    seasonId: SeasonId;
    shownSha256: string;
    agreed: boolean;
    signedName: string;
    ip: string | null;
    userAgent: string | null;
  },
): Promise<Result<WaiverSignatureId, SignError>> {
  const [current] = await db
    .select({ id: waiver.id, bodySha256: waiver.bodySha256 })
    .from(season)
    .innerJoin(waiver, eq(season.waiverId, waiver.id))
    .where(eq(season.id, input.seasonId));
  if (!current) return err("no_waiver");
  if (current.bodySha256 !== input.shownSha256) return err("changed");
  if (!input.agreed) return err("not_agreed");
  const [person] = await db
    .select({ firstName: profile.firstName, lastName: profile.lastName })
    .from(profile)
    .where(eq(profile.userId, input.userId));
  if (!person?.firstName || !person.lastName) return err("profile_incomplete");
  if (!signatureMatches(input.signedName, person.firstName, person.lastName))
    return err("name_mismatch");
  const [created] = await db
    .insert(waiverSignature)
    .values({
      waiverId: current.id,
      userId: input.userId,
      seasonId: input.seasonId,
      signedName: input.signedName.trim().replace(/\s+/g, " "),
      ip: input.ip,
      userAgent: input.userAgent?.slice(0, 512) ?? null,
      bodySha256: current.bodySha256,
    })
    .onConflictDoNothing()
    .returning({ id: waiverSignature.id });
  if (!created) return err("already_signed");
  await db
    .update(registration)
    .set({ waiverSignatureId: created.id, status: "pending_payment" })
    .where(
      and(
        eq(registration.seasonId, input.seasonId),
        eq(registration.userId, input.userId),
        eq(registration.status, "pending_waiver"),
      ),
    );
  return ok(created.id);
}

/** Whether the person signed the season's current waiver; gates payment. */
export async function hasSignedSeasonWaiver(
  db: Db,
  userId: UserId,
  seasonId: SeasonId,
): Promise<boolean> {
  const [found] = await db
    .select({ id: waiverSignature.id })
    .from(waiverSignature)
    .innerJoin(season, eq(season.waiverId, waiverSignature.waiverId))
    .where(
      and(
        eq(season.id, seasonId),
        eq(waiverSignature.seasonId, seasonId),
        eq(waiverSignature.userId, userId),
      ),
    );
  return found !== undefined;
}
