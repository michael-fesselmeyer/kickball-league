import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import type { SchedulerInput } from "@/domain/scheduler/types";
import { can } from "@/domain/authz/permissions";
import type { TeamId, TeamSeasonId } from "@/domain/ids";
import { DAILY_UPLOADS } from "@/domain/member-photos/limits";
import { processPhoto } from "@/lib/member-photos/process-photo";
import { auditLog } from "../schema/audit";
import { event } from "../schema/event";
import { memberPhoto } from "../schema/member-photo";
import { message } from "../schema/message";
import { profile } from "../schema/profile";
import { gamePlacement, scheduleVersion } from "../schema/schedule";
import { teamSeason } from "../schema/team";
import { messagingWorld } from "../test/messaging-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import { deleteAccount } from "./account";
import {
  approvedPhotos,
  deleteMemberPhoto,
  memberPhotoFile,
  myPhotos,
  photoStorage,
  reviewMemberPhoto,
  reviewQueue,
  type UploadInput,
  uploadMemberPhoto,
  uploadTargets,
} from "./member-photos";
import { required } from "./rows";
import type { Db } from "./schedule";
import { loadSubject } from "./subject";

afterAll(closePool);

const NOW = new Date("2026-10-20T22:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

/** A generated test image, processed the way an upload is. */
async function testPhoto(seed = 1) {
  const input = await sharp({
    create: {
      width: 80,
      height: 60,
      channels: 3,
      background: { r: 40 * seed, g: 120, b: 200 },
    },
  })
    .jpeg()
    .toBuffer();
  const result = await processPhoto(input);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

/**
 * The messaging world's two teams, with an admin, a published game two
 * days ago and one two months ago, and three events: a public one last
 * week, a members-only one and one next week.
 */
async function photoWorld(db: Db) {
  const w = await messagingWorld(db);
  const admin = await w.person("admin");
  await db.insert(profile).values([
    { userId: admin.userId, globalRole: "admin" },
    // Signed-in people have a profile, which permissions read.
    ...[w.aces.captain, w.aces.players[0]!, w.freeAgent].map((p) => ({
      userId: p.userId,
    })),
  ]);
  const version = required(
    (
      await db
        .insert(scheduleVersion)
        .values({
          seasonId: w.season.id,
          versionNo: 1,
          status: "published",
          publishedAt: ago(90),
          origin: "manual_edit",
          inputSnapshot: {} as SchedulerInput,
        })
        .returning({ id: scheduleVersion.id })
    )[0],
    "version",
  );
  const place = async (endsAt: Date) => {
    const g = await w.gameEnding(endsAt);
    await db.insert(gamePlacement).values({
      scheduleVersionId: version.id,
      gameId: g.gameId,
      slotId: g.slotId,
    });
    return g.gameId;
  };
  const recentGame = await place(ago(2));
  const oldGame = await place(ago(60));
  const addEvent = async (
    slug: string,
    startsAt: Date,
    audience: "public" | "members" = "public",
  ) =>
    required(
      (
        await db
          .insert(event)
          .values({
            leagueId: w.leagueId,
            title: slug,
            slug: `${slug}-${w.tag}`,
            startsAt,
            endsAt: new Date(startsAt.getTime() + 3 * 60 * 60 * 1000),
            audience,
          })
          .returning({ id: event.id })
      )[0],
      "event",
    ).id;
  const barNight = await addEvent("bar-night", ago(7));
  const membersBbq = await addEvent("members-bbq", ago(5), "members");
  const nextWeek = await addEvent("next-week", ago(-7));
  const teamOf = async (id: TeamSeasonId): Promise<TeamId> =>
    required(
      (
        await db
          .select({ id: teamSeason.teamId })
          .from(teamSeason)
          .where(eq(teamSeason.id, id))
      )[0],
      "team",
    ).id;
  return {
    ...w,
    admin,
    player: w.aces.players[0]!,
    acesTeam: await teamOf(w.aces.id),
    beesTeam: await teamOf(w.bees.id),
    recentGame,
    oldGame,
    barNight,
    membersBbq,
    nextWeek,
  };
}

type World = Awaited<ReturnType<typeof photoWorld>>;

async function upload(db: Db, w: World, over: Partial<UploadInput> = {}) {
  return uploadMemberPhoto(db, {
    leagueId: w.leagueId,
    uploaderId: w.player.userId,
    photo: await testPhoto(),
    gameId: null,
    eventId: null,
    teamId: w.acesTeam,
    caption: "Diving catch in the third",
    consent: true,
    now: NOW,
    ...over,
  });
}

async function uploaded(db: Db, w: World, over: Partial<UploadInput> = {}) {
  const result = await upload(db, w, over);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe("who may upload", () => {
  it("lets players on a team upload, and not a free agent off the rosters", () =>
    inRolledBackDb(async (db) => {
      const w = await photoWorld(db);
      expect(can(await loadSubject(db, w.player.userId), "photos.upload")).toBe(
        true,
      );
      expect(
        can(await loadSubject(db, w.aces.captain.userId), "photos.upload"),
      ).toBe(true);
      expect(
        can(await loadSubject(db, w.freeAgent.userId), "photos.upload"),
      ).toBe(false);
      expect(can(await loadSubject(db, w.player.userId), "photos.manage")).toBe(
        false,
      );
      expect(can(await loadSubject(db, w.admin.userId), "photos.manage")).toBe(
        true,
      );
    }));

  it("offers their own teams, their recent games and recent public events", () =>
    inRolledBackDb(async (db) => {
      const w = await photoWorld(db);
      const t = await uploadTargets(db, {
        leagueId: w.leagueId,
        userId: w.player.userId,
        now: NOW,
      });
      expect(t.teams.map((x) => x.id)).toEqual([w.acesTeam]);
      expect(t.games.map((g) => [g.id, g.teamId])).toEqual([
        [w.recentGame, w.acesTeam],
      ]);
      expect(t.events.map((e) => e.id)).toEqual([w.barNight]);
    }));

  it("refuses tags the uploader may not use", () =>
    inRolledBackDb(async (db) => {
      const w = await photoWorld(db);
      for (const over of [
        { teamId: w.beesTeam },
        { teamId: null, gameId: w.oldGame },
        { teamId: null, eventId: w.membersBbq },
        { teamId: null, eventId: w.nextWeek },
      ])
        expect(await upload(db, w, over)).toEqual({
          ok: false,
          error: "bad_target",
        });
      // A bees player may tag the game the aces played them in.
      expect(
        (
          await upload(db, w, {
            uploaderId: w.bees.captain.userId,
            teamId: w.beesTeam,
            gameId: w.recentGame,
          })
        ).ok,
      ).toBe(true);
      // Nobody on a roster has nothing to tag but public events.
      expect(await upload(db, w, { uploaderId: w.freeAgent.userId })).toEqual({
        ok: false,
        error: "bad_target",
      });
    }));

  it("needs the repost consent, a tag and a short caption", () =>
    inRolledBackDb(async (db) => {
      const w = await photoWorld(db);
      expect(await upload(db, w, { consent: false })).toEqual({
        ok: false,
        error: "no_consent",
      });
      expect(await upload(db, w, { teamId: null })).toEqual({
        ok: false,
        error: "no_target",
      });
      expect(await upload(db, w, { caption: "x".repeat(201) })).toEqual({
        ok: false,
        error: "caption_too_long",
      });
      expect(await photoStorage(db, w.leagueId)).toEqual({
        usedBytes: 0,
        pending: 0,
      });
    }));
});

describe("uploading", () => {
  it("stores one waiting copy with the consent time, for its uploader only", () =>
    inRolledBackDb(async (db) => {
      const w = await photoWorld(db);
      const photo = await testPhoto();
      const id = await uploaded(db, w, {
        photo,
        gameId: w.recentGame,
        eventId: w.barNight,
        caption: "  Diving catch  ",
      });
      const [row] = await db
        .select()
        .from(memberPhoto)
        .where(eq(memberPhoto.id, id));
      expect(row).toMatchObject({
        status: "pending",
        caption: "Diving catch",
        repostConsentAt: NOW,
        contentType: "image/jpeg",
        byteSize: photo.bytes.length,
        width: 80,
        height: 60,
        reviewedAt: null,
      });
      expect(await photoStorage(db, w.leagueId)).toEqual({
        usedBytes: photo.bytes.length,
        pending: 1,
      });
      const mine = await myPhotos(db, w.player.userId);
      expect(mine.map((p) => [p.id, p.status, p.teamName])).toEqual([
        [id, "pending", "Aces"],
      ]);
      // Not on any public page until approved.
      expect(await approvedPhotos(db, { teamId: w.acesTeam })).toEqual([]);
    }));

  it(`takes ${DAILY_UPLOADS} photos a day from one person, then waits a day`, () =>
    inRolledBackDb(async (db) => {
      const w = await photoWorld(db);
      const photo = await testPhoto();
      // One from yesterday no longer counts.
      await uploaded(db, w, {
        photo,
        now: new Date(NOW.getTime() - DAY - 1000),
      });
      for (let i = 0; i < DAILY_UPLOADS; i++)
        await uploaded(db, w, { photo, now: new Date(NOW.getTime() - i) });
      expect(await upload(db, w, { photo })).toEqual({
        ok: false,
        error: "daily_cap",
      });
      // Someone else still can.
      expect(
        (await upload(db, w, { photo, uploaderId: w.aces.captain.userId })).ok,
      ).toBe(true);
    }));

  it("stops at the league's cap, and a rejection frees its space", () =>
    inRolledBackDb(async (db) => {
      const w = await photoWorld(db);
      const photo = await testPhoto();
      const size = photo.bytes.length;
      const capBytes = size * 2;
      const first = await uploaded(db, w, { photo, capBytes });
      await uploaded(db, w, { photo, capBytes });
      expect(await upload(db, w, { photo, capBytes })).toEqual({
        ok: false,
        error: "league_full",
      });
      await reviewMemberPhoto(db, {
        leagueId: w.leagueId,
        photoId: first,
        decision: "reject",
        note: null,
        actorId: w.admin.userId,
        now: NOW,
      });
      expect((await photoStorage(db, w.leagueId)).usedBytes).toBe(size);
      expect((await upload(db, w, { photo, capBytes })).ok).toBe(true);
    }));
});

describe("reviewing", () => {
  it("approves: the photo shows on its pages, is audited and the uploader hears", () =>
    inRolledBackDb(async (db) => {
      const w = await photoWorld(db);
      const id = await uploaded(db, w, { gameId: w.recentGame });
      expect(
        (await reviewQueue(db, w.leagueId)).pending.map((p) => p.id),
      ).toEqual([id]);
      expect(
        await reviewMemberPhoto(db, {
          leagueId: w.leagueId,
          photoId: id,
          decision: "approve",
          note: "ignored on approval",
          actorId: w.admin.userId,
          now: NOW,
        }),
      ).toEqual({ ok: true, value: undefined });
      const shown = [
        { id, caption: "Diving catch in the third", width: 80, height: 60 },
      ];
      expect(await approvedPhotos(db, { teamId: w.acesTeam })).toEqual(shown);
      expect(await approvedPhotos(db, { gameId: w.recentGame })).toEqual(shown);
      expect(await approvedPhotos(db, { teamId: w.beesTeam })).toEqual([]);
      expect((await memberPhotoFile(db, id))?.status).toBe("approved");
      const queue = await reviewQueue(db, w.leagueId);
      expect(queue.pending).toEqual([]);
      expect(queue.approved.map((p) => [p.id, p.uploaderName])).toEqual([
        [id, "ace-1"],
      ]);

      const audit = await db
        .select({ action: auditLog.action, actorId: auditLog.actorId })
        .from(auditLog)
        .where(eq(auditLog.entityId, id));
      expect(audit).toEqual([
        { action: "member_photo.approve", actorId: w.admin.userId },
      ]);
      const sent = await db
        .select({
          userId: message.userId,
          topic: message.topic,
          template: message.template,
          payload: message.payload,
        })
        .from(message)
        .where(eq(message.dedupeKey, `photo_review:${id}`));
      expect(sent).toEqual([
        {
          userId: w.player.userId,
          topic: "photos",
          template: "photo_review",
          payload: {
            kind: "approved",
            where: "the team page for Aces",
            path: expect.stringMatching(/^\/teams\/aces-/),
          },
        },
      ]);
    }));

  it("rejects: the bytes go at once, the note stays private", () =>
    inRolledBackDb(async (db) => {
      const w = await photoWorld(db);
      const id = await uploaded(db, w);
      await reviewMemberPhoto(db, {
        leagueId: w.leagueId,
        photoId: id,
        decision: "reject",
        note: "  Blurry, and someone's mid-sip  ",
        actorId: w.admin.userId,
        now: NOW,
      });
      const [row] = await db
        .select({
          status: memberPhoto.status,
          bytes: memberPhoto.bytes,
          byteSize: memberPhoto.byteSize,
          reviewNote: memberPhoto.reviewNote,
        })
        .from(memberPhoto)
        .where(eq(memberPhoto.id, id));
      expect(row).toEqual({
        status: "rejected",
        bytes: null,
        byteSize: null,
        reviewNote: "Blurry, and someone's mid-sip",
      });
      expect(await memberPhotoFile(db, id)).toBe(null);
      expect(await approvedPhotos(db, { teamId: w.acesTeam })).toEqual([]);
      const [sent] = await db
        .select({ payload: message.payload })
        .from(message)
        .where(eq(message.dedupeKey, `photo_review:${id}`));
      expect(sent?.payload).toEqual({ kind: "rejected" });
      expect(JSON.stringify(sent?.payload)).not.toContain("Blurry");
      expect(
        (
          await db
            .select({ action: auditLog.action })
            .from(auditLog)
            .where(eq(auditLog.entityId, id))
        ).map((a) => a.action),
      ).toEqual(["member_photo.reject"]);
    }));

  it("reviews a photo once, and only in its own league", () =>
    inRolledBackDb(async (db) => {
      const w = await photoWorld(db);
      const other = await photoWorld(db);
      const id = await uploaded(db, w);
      const review = (leagueId = w.leagueId) =>
        reviewMemberPhoto(db, {
          leagueId,
          photoId: id,
          decision: "approve",
          note: null,
          actorId: w.admin.userId,
          now: NOW,
        });
      expect(await review(other.leagueId)).toEqual({
        ok: false,
        error: "not_found",
      });
      expect((await review()).ok).toBe(true);
      expect(await review()).toEqual({
        ok: false,
        error: "already_reviewed",
      });
    }));
});

describe("deleting", () => {
  it("lets the uploader delete their own photo, and nobody else's", () =>
    inRolledBackDb(async (db) => {
      const w = await photoWorld(db);
      const id = await uploaded(db, w);
      const del = (actorId: typeof w.admin.userId, asAdmin = false) =>
        deleteMemberPhoto(db, {
          leagueId: w.leagueId,
          photoId: id,
          actorId,
          asAdmin,
        });
      expect(await del(w.aces.captain.userId)).toEqual({
        ok: false,
        error: "not_found",
      });
      expect(await del(w.player.userId)).toEqual({
        ok: true,
        value: { wasShown: false },
      });
      expect(await myPhotos(db, w.player.userId)).toEqual([]);
      const [audit] = await db
        .select({ action: auditLog.action, after: auditLog.after })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.entityId, id),
            eq(auditLog.action, "member_photo.delete"),
          ),
        );
      expect(audit).toEqual({
        action: "member_photo.delete",
        after: { by: "uploader" },
      });
    }));

  it("lets an admin take down an approved photo", () =>
    inRolledBackDb(async (db) => {
      const w = await photoWorld(db);
      const id = await uploaded(db, w);
      await reviewMemberPhoto(db, {
        leagueId: w.leagueId,
        photoId: id,
        decision: "approve",
        note: null,
        actorId: w.admin.userId,
        now: NOW,
      });
      expect(
        await deleteMemberPhoto(db, {
          leagueId: w.leagueId,
          photoId: id,
          actorId: w.admin.userId,
          asAdmin: true,
        }),
      ).toEqual({ ok: true, value: { wasShown: true } });
      expect(await approvedPhotos(db, { teamId: w.acesTeam })).toEqual([]);
      expect(await memberPhotoFile(db, id)).toBe(null);
    }));

  it("deletes every photo a person uploaded with their account", () =>
    inRolledBackDb(async (db) => {
      const w = await photoWorld(db);
      const shown = await uploaded(db, w);
      await uploaded(db, w);
      const theirs = await uploaded(db, w, {
        uploaderId: w.aces.captain.userId,
      });
      await reviewMemberPhoto(db, {
        leagueId: w.leagueId,
        photoId: shown,
        decision: "approve",
        note: null,
        actorId: w.admin.userId,
        now: NOW,
      });
      const result = await deleteAccount(db, w.player.userId, NOW);
      expect(result.ok).toBe(true);
      const left = await db
        .select({ id: memberPhoto.id })
        .from(memberPhoto)
        .where(eq(memberPhoto.leagueId, w.leagueId));
      expect(left).toEqual([{ id: theirs }]);
      expect(await approvedPhotos(db, { teamId: w.acesTeam })).toEqual([]);
    }));
});
