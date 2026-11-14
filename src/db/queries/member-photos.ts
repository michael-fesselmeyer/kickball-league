import {
  aliasedTable,
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import type {
  EventId,
  GameId,
  LeagueId,
  MemberPhotoId,
  TeamId,
  UserId,
} from "@/domain/ids";
import {
  fitsLeagueCap,
  underDailyLimit,
  type UploadProblem,
} from "@/domain/member-photos/limits";
import { err, ok, type Result } from "@/domain/result";
import type { PhotoReviewPayload } from "@/emails/photo-review";
import type { ProcessedPhoto } from "@/lib/member-photos/process-photo";
import { user } from "../schema/auth";
import { event } from "../schema/event";
import { game, slot } from "../schema/game";
import { memberPhoto } from "../schema/member-photo";
import { gamePlacement, scheduleVersion } from "../schema/schedule";
import { season } from "../schema/season";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { recordAudit } from "./audit";
import { enqueueMessages } from "./outbox";
import type { Db } from "./schedule";

/**
 * Photos members upload for the league's socials (ADR 0039;
 * docs/architecture.md, section 18): what a member may tag, the upload with
 * its limits, the admins' review queue, and what public pages show.
 */

/** How far back a game day or an event can still get photos. */
const RECENT_DAYS = 30;
/** How far ahead: today's game or event, before it starts. */
const AHEAD_HOURS = 12;

const DAY_MS = 24 * 60 * 60 * 1000;

export type UploadTargets = {
  teams: { id: TeamId; name: string; slug: string }[];
  games: {
    id: GameId;
    startsAt: Date;
    teamA: string;
    teamB: string;
    /** The member's own team in the game. */
    teamId: TeamId;
  }[];
  events: { id: EventId; title: string; slug: string; startsAt: Date }[];
};

const entryA = aliasedTable(teamSeason, "entry_a");
const entryB = aliasedTable(teamSeason, "entry_b");
const teamA = aliasedTable(team, "team_a");
const teamB = aliasedTable(team, "team_b");

/**
 * What a member may tag a photo to: the teams they are on, those teams'
 * published games from the last 30 days through today, and public events
 * in the same window. Admins tag the same way as anyone.
 */
export async function uploadTargets(
  db: Db,
  input: { leagueId: LeagueId; userId: UserId; now: Date },
): Promise<UploadTargets> {
  const from = new Date(input.now.getTime() - RECENT_DAYS * DAY_MS);
  const to = new Date(input.now.getTime() + AHEAD_HOURS * 60 * 60 * 1000);
  const mine = await db
    .selectDistinct({
      teamSeasonId: teamSeason.id,
      teamId: team.id,
      name: team.name,
      slug: team.slug,
    })
    .from(rosterMembership)
    .innerJoin(
      registration,
      eq(rosterMembership.registrationId, registration.id),
    )
    .innerJoin(teamSeason, eq(rosterMembership.teamSeasonId, teamSeason.id))
    .innerJoin(team, eq(teamSeason.teamId, team.id))
    .where(
      and(
        eq(registration.userId, input.userId),
        eq(rosterMembership.status, "active"),
        eq(team.leagueId, input.leagueId),
      ),
    );
  const entries = mine.map((m) => m.teamSeasonId);
  const [games, events] = await Promise.all([
    entries.length === 0
      ? []
      : db
          .select({
            id: game.id,
            startsAt: slot.startsAt,
            teamA: teamA.name,
            teamB: teamB.name,
            teamAEntry: game.teamAId,
            teamAId: teamA.id,
            teamBId: teamB.id,
          })
          .from(gamePlacement)
          .innerJoin(
            scheduleVersion,
            and(
              eq(gamePlacement.scheduleVersionId, scheduleVersion.id),
              eq(scheduleVersion.status, "published"),
            ),
          )
          .innerJoin(game, eq(gamePlacement.gameId, game.id))
          .innerJoin(season, eq(game.seasonId, season.id))
          .innerJoin(slot, eq(gamePlacement.slotId, slot.id))
          .innerJoin(entryA, eq(game.teamAId, entryA.id))
          .innerJoin(teamA, eq(entryA.teamId, teamA.id))
          .innerJoin(entryB, eq(game.teamBId, entryB.id))
          .innerJoin(teamB, eq(entryB.teamId, teamB.id))
          .where(
            and(
              eq(season.leagueId, input.leagueId),
              ne(season.status, "draft"),
              or(
                inArray(game.teamAId, entries),
                inArray(game.teamBId, entries),
              ),
              ne(game.status, "cancelled"),
              ne(slot.status, "cancelled"),
              gte(slot.startsAt, from),
              lte(slot.startsAt, to),
            ),
          )
          .orderBy(desc(slot.startsAt)),
    db
      .select({
        id: event.id,
        title: event.title,
        slug: event.slug,
        startsAt: event.startsAt,
      })
      .from(event)
      .where(
        and(
          eq(event.leagueId, input.leagueId),
          eq(event.audience, "public"),
          isNull(event.deletedAt),
          isNull(event.cancelledAt),
          lte(event.startsAt, to),
          gte(event.endsAt, from),
        ),
      )
      .orderBy(desc(event.startsAt)),
  ]);
  const teams = new Map(mine.map((m) => [m.teamId, m]));
  return {
    teams: [...teams.values()].map(({ teamId, name, slug }) => ({
      id: teamId,
      name,
      slug,
    })),
    games: games.map((g) => ({
      id: g.id,
      startsAt: g.startsAt,
      teamA: g.teamA,
      teamB: g.teamB,
      teamId: entries.includes(g.teamAEntry) ? g.teamAId : g.teamBId,
    })),
    events,
  };
}

/** Stored bytes and photos waiting for review, for the league. */
export async function photoStorage(
  db: Db,
  leagueId: LeagueId,
): Promise<{ usedBytes: number; pending: number }> {
  const [row] = await db
    .select({
      usedBytes: sql<string>`coalesce(sum(${memberPhoto.byteSize}), 0)`,
      pending: sql<number>`count(*) filter (where ${memberPhoto.status} = 'pending')::int`,
    })
    .from(memberPhoto)
    .where(eq(memberPhoto.leagueId, leagueId));
  return {
    usedBytes: Number(row?.usedBytes ?? 0),
    pending: row?.pending ?? 0,
  };
}

export type UploadInput = {
  leagueId: LeagueId;
  uploaderId: UserId;
  photo: ProcessedPhoto;
  gameId: GameId | null;
  eventId: EventId | null;
  teamId: TeamId | null;
  caption: string | null;
  /** The uploader ticked "The league may repost this on its socials". */
  consent: boolean;
  now: Date;
  /** The league's storage cap; tests pass a small one. */
  capBytes?: number;
};

/**
 * Stores an upload for review, after checking the tags against what the
 * uploader may tag and the person's and the league's limits. The league's
 * uploads take turns (a transaction lock), so two at once can't both fit
 * the last space under the cap.
 */
export async function uploadMemberPhoto(
  db: Db,
  input: UploadInput,
): Promise<Result<MemberPhotoId, UploadProblem>> {
  if (!input.consent) return err("no_consent");
  if (!input.gameId && !input.eventId && !input.teamId) return err("no_target");
  const caption = input.caption?.trim() || null;
  if (caption && caption.length > 200) return err("caption_too_long");

  const targets = await uploadTargets(db, {
    leagueId: input.leagueId,
    userId: input.uploaderId,
    now: input.now,
  });
  const allowed =
    (!input.gameId || targets.games.some((g) => g.id === input.gameId)) &&
    (!input.eventId || targets.events.some((e) => e.id === input.eventId)) &&
    (!input.teamId || targets.teams.some((t) => t.id === input.teamId));
  if (!allowed) return err("bad_target");

  await db.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`member_photo:${input.leagueId}`}))`,
  );
  const [recent] = await db
    .select({ n: count() })
    .from(memberPhoto)
    .where(
      and(
        eq(memberPhoto.uploaderId, input.uploaderId),
        gte(memberPhoto.createdAt, new Date(input.now.getTime() - DAY_MS)),
      ),
    );
  if (!underDailyLimit(recent?.n ?? 0)) return err("daily_cap");
  const { usedBytes } = await photoStorage(db, input.leagueId);
  if (!fitsLeagueCap(usedBytes, input.photo.bytes.length, input.capBytes))
    return err("league_full");

  const [row] = await db
    .insert(memberPhoto)
    .values({
      leagueId: input.leagueId,
      uploaderId: input.uploaderId,
      gameId: input.gameId,
      eventId: input.eventId,
      teamId: input.teamId,
      caption,
      repostConsentAt: input.now,
      bytes: input.photo.bytes,
      byteSize: input.photo.bytes.length,
      width: input.photo.width,
      height: input.photo.height,
      sha256: input.photo.sha256,
      createdAt: input.now,
    })
    .returning({ id: memberPhoto.id });
  if (!row) throw new Error("member photo not stored");
  return ok(row.id);
}

/** A photo's fields every list shows, never its bytes. */
const LISTED = {
  id: memberPhoto.id,
  status: memberPhoto.status,
  caption: memberPhoto.caption,
  width: memberPhoto.width,
  height: memberPhoto.height,
  createdAt: memberPhoto.createdAt,
  teamName: team.name,
  teamSlug: team.slug,
  eventTitle: event.title,
  eventSlug: event.slug,
  gameId: memberPhoto.gameId,
};

export type ListedPhoto = {
  id: MemberPhotoId;
  status: "pending" | "approved" | "rejected";
  caption: string | null;
  width: number;
  height: number;
  createdAt: Date;
  teamName: string | null;
  teamSlug: string | null;
  eventTitle: string | null;
  eventSlug: string | null;
  gameId: GameId | null;
};

/** The uploader's own photos, newest first, with whether each was used. */
export function myPhotos(db: Db, userId: UserId): Promise<ListedPhoto[]> {
  return db
    .select(LISTED)
    .from(memberPhoto)
    .leftJoin(team, eq(memberPhoto.teamId, team.id))
    .leftJoin(event, eq(memberPhoto.eventId, event.id))
    .where(eq(memberPhoto.uploaderId, userId))
    .orderBy(desc(memberPhoto.createdAt))
    .limit(60);
}

export type QueuedPhoto = ListedPhoto & {
  uploaderName: string | null;
  reviewNote: string | null;
};

/**
 * The admins' review queue: photos waiting, oldest first, then the most
 * recently approved (to download or take down) and rejected (with their
 * private notes).
 */
export async function reviewQueue(
  db: Db,
  leagueId: LeagueId,
): Promise<{
  pending: QueuedPhoto[];
  approved: QueuedPhoto[];
  rejected: QueuedPhoto[];
}> {
  const fields = {
    ...LISTED,
    uploaderName: user.name,
    reviewNote: memberPhoto.reviewNote,
  };
  const base = (status: "pending" | "approved" | "rejected") =>
    db
      .select(fields)
      .from(memberPhoto)
      .innerJoin(user, eq(memberPhoto.uploaderId, user.id))
      .leftJoin(team, eq(memberPhoto.teamId, team.id))
      .leftJoin(event, eq(memberPhoto.eventId, event.id))
      .where(
        and(eq(memberPhoto.leagueId, leagueId), eq(memberPhoto.status, status)),
      );
  const [pending, approved, rejected] = await Promise.all([
    base("pending").orderBy(asc(memberPhoto.createdAt)).limit(24),
    base("approved").orderBy(desc(memberPhoto.reviewedAt)).limit(24),
    base("rejected").orderBy(desc(memberPhoto.reviewedAt)).limit(10),
  ]);
  return { pending, approved, rejected };
}

/** Where an approved photo shows, for the uploader's message. */
function shownOn(row: {
  teamName: string | null;
  teamSlug: string | null;
  eventTitle: string | null;
  eventSlug: string | null;
  gameId: GameId | null;
}): { where: string; path: string } | null {
  if (row.teamSlug && row.teamName)
    return {
      where: `the team page for ${row.teamName}`,
      path: `/teams/${row.teamSlug}`,
    };
  if (row.eventSlug && row.eventTitle)
    return {
      where: `the event page for ${row.eventTitle}`,
      path: `/events/${row.eventSlug}`,
    };
  if (row.gameId)
    return { where: "the game's page", path: `/games/${row.gameId}` };
  return null;
}

export type ReviewError = "not_found" | "already_reviewed";

/**
 * Approves or rejects a waiting photo. A rejected photo's bytes are deleted
 * at once; the private note stays with the row for admins. The uploader
 * hears either way, without the note.
 */
export async function reviewMemberPhoto(
  db: Db,
  input: {
    leagueId: LeagueId;
    photoId: MemberPhotoId;
    decision: "approve" | "reject";
    note: string | null;
    actorId: UserId;
    now: Date;
  },
): Promise<Result<void, ReviewError>> {
  const [row] = await db
    .select({
      ...LISTED,
      uploaderId: memberPhoto.uploaderId,
    })
    .from(memberPhoto)
    .leftJoin(team, eq(memberPhoto.teamId, team.id))
    .leftJoin(event, eq(memberPhoto.eventId, event.id))
    .where(
      and(
        eq(memberPhoto.id, input.photoId),
        eq(memberPhoto.leagueId, input.leagueId),
      ),
    )
    .for("update", { of: memberPhoto });
  if (!row) return err("not_found");
  if (row.status !== "pending") return err("already_reviewed");
  const note = input.note?.trim().slice(0, 500) || null;
  const approve = input.decision === "approve";
  await db
    .update(memberPhoto)
    .set(
      approve
        ? {
            status: "approved",
            reviewedBy: input.actorId,
            reviewedAt: input.now,
          }
        : {
            status: "rejected",
            reviewedBy: input.actorId,
            reviewedAt: input.now,
            reviewNote: note,
            bytes: null,
            byteSize: null,
          },
    )
    .where(eq(memberPhoto.id, input.photoId));
  await recordAudit(db, {
    actorId: input.actorId,
    action: approve ? "member_photo.approve" : "member_photo.reject",
    entityType: "member_photo",
    entityId: input.photoId,
    before: { status: "pending" },
    after: approve ? { status: "approved" } : { status: "rejected", note },
  });
  const shown = shownOn(row);
  const payload: PhotoReviewPayload =
    approve && shown
      ? { kind: "approved", ...shown }
      : approve
        ? { kind: "approved", where: "the league's site", path: "/app/photos" }
        : { kind: "rejected" };
  await enqueueMessages(db, [
    {
      userId: row.uploaderId,
      topic: "photos",
      template: "photo_review",
      payload,
      dedupeKey: `photo_review:${input.photoId}`,
      sendAfter: input.now,
    },
  ]);
  return ok(undefined);
}

/**
 * Deletes a photo: the uploader's own at any time, or any in the league by
 * an admin. Says whether it was shown, so the caller can refresh the pages.
 */
export async function deleteMemberPhoto(
  db: Db,
  input: {
    leagueId: LeagueId;
    photoId: MemberPhotoId;
    actorId: UserId;
    /** An admin may delete anyone's; anyone else only their own. */
    asAdmin: boolean;
  },
): Promise<Result<{ wasShown: boolean }, "not_found">> {
  const [row] = await db
    .delete(memberPhoto)
    .where(
      and(
        eq(memberPhoto.id, input.photoId),
        eq(memberPhoto.leagueId, input.leagueId),
        input.asAdmin ? undefined : eq(memberPhoto.uploaderId, input.actorId),
      ),
    )
    .returning({
      status: memberPhoto.status,
      uploaderId: memberPhoto.uploaderId,
    });
  if (!row) return err("not_found");
  await recordAudit(db, {
    actorId: input.actorId,
    action: "member_photo.delete",
    entityType: "member_photo",
    entityId: input.photoId,
    before: { status: row.status },
    after: { by: row.uploaderId === input.actorId ? "uploader" : "admin" },
  });
  return ok({ wasShown: row.status === "approved" });
}

/**
 * Deletes every photo a person uploaded, when they delete their account.
 * Says how many were shown, so the public pages can be refreshed.
 */
export async function deletePhotosOf(
  db: Db,
  userId: UserId,
): Promise<{ deleted: number; shown: number }> {
  const rows = await db
    .delete(memberPhoto)
    .where(eq(memberPhoto.uploaderId, userId))
    .returning({ status: memberPhoto.status });
  return {
    deleted: rows.length,
    shown: rows.filter((r) => r.status === "approved").length,
  };
}

/** A stored copy, for its routes, with who may see it. */
export async function memberPhotoFile(db: Db, photoId: MemberPhotoId) {
  const [row] = await db
    .select({
      leagueId: memberPhoto.leagueId,
      uploaderId: memberPhoto.uploaderId,
      status: memberPhoto.status,
      contentType: memberPhoto.contentType,
      bytes: memberPhoto.bytes,
      sha256: memberPhoto.sha256,
      createdAt: memberPhoto.createdAt,
    })
    .from(memberPhoto)
    .where(eq(memberPhoto.id, photoId));
  if (!row?.bytes) return null;
  return { ...row, bytes: row.bytes };
}

export type ApprovedPhoto = {
  id: MemberPhotoId;
  caption: string | null;
  width: number;
  height: number;
};

const APPROVED = {
  id: memberPhoto.id,
  caption: memberPhoto.caption,
  width: memberPhoto.width,
  height: memberPhoto.height,
};

/** The newest approved photos tagged to one team, event or game. */
export function approvedPhotos(
  db: Db,
  tag: { teamId: TeamId } | { eventId: EventId } | { gameId: GameId },
  limit = 8,
): Promise<ApprovedPhoto[]> {
  const where =
    "teamId" in tag
      ? eq(memberPhoto.teamId, tag.teamId)
      : "eventId" in tag
        ? eq(memberPhoto.eventId, tag.eventId)
        : eq(memberPhoto.gameId, tag.gameId);
  return db
    .select(APPROVED)
    .from(memberPhoto)
    .where(and(where, eq(memberPhoto.status, "approved")))
    .orderBy(desc(memberPhoto.createdAt))
    .limit(limit);
}
