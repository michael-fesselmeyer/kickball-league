import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  notInArray,
} from "drizzle-orm";
import type {
  AnnouncementId,
  SeasonId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import type { AnnouncementPayload } from "@/emails/announcement";
import { user } from "../schema/auth";
import { announcement, message } from "../schema/message";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { recordAudit } from "./audit";
import { enqueueMessages } from "./outbox";
import { required } from "./rows";
import type { Db } from "./schedule";

/**
 * Announcements (product-spec.md, "Notifications"): an admin writes to the
 * whole league or one team, a captain to their own team. Each recipient
 * gets one outbox message, written in the same transaction as the
 * announcement. An admin can schedule one instead (ADR 0052): the outbox
 * sweep queues its messages once it is due (`releaseDueAnnouncements`).
 */

/** Per author per day (architecture.md, "Rate limits"). */
export const DAILY_LIMIT = { admin: 10, captain: 3 } as const;

export const SUBJECT_MAX = 120;
export const BODY_MAX = 5000;

/** Everyone the announcement reaches: a team's active roster, or the season's registered players. */
export async function audienceOf(
  db: Db,
  seasonId: SeasonId,
  teamSeasonId: TeamSeasonId | null,
): Promise<UserId[]> {
  const rows = teamSeasonId
    ? await db
        .selectDistinct({ userId: registration.userId })
        .from(rosterMembership)
        .innerJoin(
          registration,
          eq(rosterMembership.registrationId, registration.id),
        )
        .where(
          and(
            eq(rosterMembership.teamSeasonId, teamSeasonId),
            eq(rosterMembership.status, "active"),
            eq(registration.seasonId, seasonId),
          ),
        )
    : await db
        .selectDistinct({ userId: registration.userId })
        .from(registration)
        .where(
          and(
            eq(registration.seasonId, seasonId),
            notInArray(registration.status, ["cancelled", "refunded"]),
          ),
        );
  return rows.map((r) => r.userId);
}

export type AnnounceError =
  "empty" | "too_long" | "rate_limited" | "no_recipients";

export type AnnounceInput = {
  authorId: UserId;
  role: keyof typeof DAILY_LIMIT;
  seasonId: SeasonId;
  seasonName: string;
  seasonSlug: string;
  /** Null for the whole league. */
  team: { id: TeamSeasonId; name: string } | null;
  from: string;
  subject: string;
  body: string;
  now: Date;
  /**
   * When to send it, for an admin's scheduled announcement (a sweep time
   * from src/domain/messaging/send-time.ts); null or absent sends it now.
   */
  sendAt?: Date | null;
};

/** The subject and body, trimmed, or why they can't be sent. */
function checkText(
  subject: string,
  body: string,
): Result<{ subject: string; body: string }, "empty" | "too_long"> {
  const s = subject.trim();
  const b = body.trim();
  if (!s || !b) return err("empty");
  if (s.length > SUBJECT_MAX || b.length > BODY_MAX) return err("too_long");
  return ok({ subject: s, body: b });
}

/**
 * Saves an announcement and queues one email per recipient, or, with a
 * `sendAt`, saves it to wait for the sweep. Run it in a transaction, then
 * send the queue.
 */
export async function sendAnnouncement(
  db: Db,
  input: AnnounceInput,
): Promise<Result<{ id: AnnouncementId; recipients: number }, AnnounceError>> {
  const text = checkText(input.subject, input.body);
  if (!text.ok) return text;
  const { subject, body } = text.value;

  const dayAgo = new Date(input.now.getTime() - 24 * 3_600_000);
  const [recent] = await db
    .select({ n: count() })
    .from(announcement)
    .where(
      and(
        eq(announcement.authorId, input.authorId),
        gte(announcement.createdAt, dayAgo),
      ),
    );
  if ((recent?.n ?? 0) >= DAILY_LIMIT[input.role]) return err("rate_limited");

  const teamId = input.team?.id ?? null;
  if (input.sendAt) {
    // The audience is read when it sends, so later sign-ups get it too.
    const [waiting] = await db
      .insert(announcement)
      .values({
        authorId: input.authorId,
        seasonId: input.seasonId,
        teamSeasonId: teamId,
        subject,
        body,
        recipientCount: 0,
        createdAt: input.now,
        sendAt: input.sendAt,
      })
      .returning({ id: announcement.id });
    const id = required(waiting, "announcement").id;
    await recordAudit(db, {
      actorId: input.authorId,
      action: "announcement.schedule",
      entityType: "announcement",
      entityId: id,
      after: { teamSeasonId: teamId, subject, sendAt: input.sendAt },
    });
    return ok({ id, recipients: 0 });
  }
  const recipients = await audienceOf(db, input.seasonId, teamId);
  if (recipients.length === 0) return err("no_recipients");

  const [created] = await db
    .insert(announcement)
    .values({
      authorId: input.authorId,
      seasonId: input.seasonId,
      teamSeasonId: teamId,
      subject,
      body,
      recipientCount: recipients.length,
      createdAt: input.now,
      sentAt: input.now,
    })
    .returning({ id: announcement.id });
  const id = required(created, "announcement").id;
  await queueAnnouncement(db, {
    id,
    recipients,
    payload: {
      subject,
      body,
      from: input.from,
      seasonName: input.seasonName,
      seasonSlug: input.seasonSlug,
      ...(input.team ? { teamName: input.team.name } : {}),
    },
    now: input.now,
  });
  await recordAudit(db, {
    actorId: input.authorId,
    action: "announcement.send",
    entityType: "announcement",
    entityId: id,
    after: { teamSeasonId: teamId, subject, recipients: recipients.length },
  });
  return ok({ id, recipients: recipients.length });
}

/** One outbox message per recipient, all pointing back to the announcement. */
async function queueAnnouncement(
  db: Db,
  input: {
    id: AnnouncementId;
    recipients: readonly UserId[];
    payload: AnnouncementPayload;
    now: Date;
  },
) {
  await enqueueMessages(
    db,
    input.recipients.map((userId) => ({
      userId,
      topic: "announcement",
      template: "announcement",
      payload: input.payload,
      dedupeKey: `announcement/${input.id}/${userId}`,
      announcementId: input.id,
      sendAfter: input.now,
    })),
  );
}

/** Scheduled announcements are an admin's, so they're signed as the admins. */
const SCHEDULED_FROM = "League admins";

/**
 * Queues the messages for every scheduled announcement that is due, for
 * its audience as it stands now, and marks it sent. The outbox sweep runs
 * this before it sends. Rows are claimed with SKIP LOCKED, so two sweeps
 * never send one twice; the dedupe keys would stop it anyway.
 */
export async function releaseDueAnnouncements(
  db: Db,
  now: Date,
): Promise<{ announcements: number; messages: number }> {
  const due = await db
    .select({
      id: announcement.id,
      seasonId: announcement.seasonId,
      teamSeasonId: announcement.teamSeasonId,
      subject: announcement.subject,
      body: announcement.body,
    })
    .from(announcement)
    .where(
      and(
        isNull(announcement.sentAt),
        isNull(announcement.cancelledAt),
        lte(announcement.sendAt, now),
      ),
    )
    .orderBy(asc(announcement.sendAt))
    .limit(20)
    .for("update", { skipLocked: true });
  if (due.length === 0) return { announcements: 0, messages: 0 };
  const seasons = await db
    .select({ id: season.id, name: season.name, slug: season.slug })
    .from(season)
    .where(inArray(season.id, [...new Set(due.map((a) => a.seasonId))]));
  const teamIds = due.flatMap((a) => a.teamSeasonId ?? []);
  const teams =
    teamIds.length === 0
      ? []
      : await db
          .select({ id: teamSeason.id, name: team.name })
          .from(teamSeason)
          .innerJoin(team, eq(teamSeason.teamId, team.id))
          .where(inArray(teamSeason.id, teamIds));
  let messages = 0;
  for (const a of due) {
    const s = seasons.find((x) => x.id === a.seasonId);
    const teamName = teams.find((t) => t.id === a.teamSeasonId)?.name;
    const recipients = await audienceOf(db, a.seasonId, a.teamSeasonId);
    if (s)
      await queueAnnouncement(db, {
        id: a.id,
        recipients,
        payload: {
          subject: a.subject,
          body: a.body,
          from: SCHEDULED_FROM,
          seasonName: s.name,
          seasonSlug: s.slug,
          ...(teamName ? { teamName } : {}),
        },
        now,
      });
    messages += recipients.length;
    await db
      .update(announcement)
      .set({ sentAt: now, recipientCount: recipients.length })
      .where(eq(announcement.id, a.id));
  }
  return { announcements: due.length, messages };
}

export type ScheduledAnnouncement = {
  id: AnnouncementId;
  subject: string;
  body: string;
  teamSeasonId: TeamSeasonId | null;
  sendAt: Date;
};

/** A season's announcements still waiting to send, soonest first. */
export async function scheduledAnnouncements(
  db: Db,
  seasonId: SeasonId,
): Promise<ScheduledAnnouncement[]> {
  const rows = await db
    .select({
      id: announcement.id,
      subject: announcement.subject,
      body: announcement.body,
      teamSeasonId: announcement.teamSeasonId,
      sendAt: announcement.sendAt,
    })
    .from(announcement)
    .where(
      and(
        eq(announcement.seasonId, seasonId),
        isNull(announcement.sentAt),
        isNull(announcement.cancelledAt),
      ),
    )
    .orderBy(asc(announcement.sendAt));
  return rows.flatMap((r) => (r.sendAt ? [{ ...r, sendAt: r.sendAt }] : []));
}

/** Only one still waiting to send can change; anything else says why. */
export type ScheduledChangeError = "empty" | "too_long" | "already_sent";

/** Edits a scheduled announcement's text and send time before it sends. */
export async function editScheduledAnnouncement(
  db: Db,
  input: {
    id: AnnouncementId;
    seasonId: SeasonId;
    actorId: UserId;
    subject: string;
    body: string;
    sendAt: Date;
  },
): Promise<Result<undefined, ScheduledChangeError>> {
  const text = checkText(input.subject, input.body);
  if (!text.ok) return text;
  const changed = await db
    .update(announcement)
    .set({ ...text.value, sendAt: input.sendAt })
    .where(
      and(
        eq(announcement.id, input.id),
        eq(announcement.seasonId, input.seasonId),
        isNull(announcement.sentAt),
        isNull(announcement.cancelledAt),
      ),
    )
    .returning({ id: announcement.id });
  if (changed.length === 0) return err("already_sent");
  await recordAudit(db, {
    actorId: input.actorId,
    action: "announcement.edit",
    entityType: "announcement",
    entityId: input.id,
    after: { subject: text.value.subject, sendAt: input.sendAt },
  });
  return ok(undefined);
}

/** Cancels a scheduled announcement before it sends. */
export async function cancelScheduledAnnouncement(
  db: Db,
  input: {
    id: AnnouncementId;
    seasonId: SeasonId;
    actorId: UserId;
    now: Date;
  },
): Promise<Result<undefined, "already_sent">> {
  const cancelled = await db
    .update(announcement)
    .set({ cancelledAt: input.now })
    .where(
      and(
        eq(announcement.id, input.id),
        eq(announcement.seasonId, input.seasonId),
        isNull(announcement.sentAt),
        isNull(announcement.cancelledAt),
      ),
    )
    .returning({ subject: announcement.subject });
  const row = cancelled[0];
  if (!row) return err("already_sent");
  await recordAudit(db, {
    actorId: input.actorId,
    action: "announcement.cancel",
    entityType: "announcement",
    entityId: input.id,
    after: { subject: row.subject },
  });
  return ok(undefined);
}

/** The season's teams an admin can write to, by name. */
export async function teamsToAnnounceTo(db: Db, seasonId: SeasonId) {
  return db
    .select({ id: teamSeason.id, name: team.name })
    .from(teamSeason)
    .innerJoin(team, eq(teamSeason.teamId, team.id))
    .where(
      and(
        eq(teamSeason.seasonId, seasonId),
        ne(teamSeason.status, "withdrawn"),
      ),
    )
    .orderBy(asc(team.name));
}

/** How the author signs a team announcement: their first name, else their account name. */
export async function authorName(db: Db, userId: UserId): Promise<string> {
  const [found] = await db
    .select({ firstName: profile.firstName, name: user.name })
    .from(user)
    .leftJoin(profile, eq(profile.userId, user.id))
    .where(eq(user.id, userId));
  return found?.firstName || found?.name || "Your captain";
}

export type AnnouncementSummary = {
  id: AnnouncementId;
  subject: string;
  body: string;
  teamSeasonId: TeamSeasonId | null;
  createdAt: Date;
  recipientCount: number;
  /** Message counts by status: sent, queued, sending, failed, suppressed. */
  delivery: Partial<Record<string, number>>;
};

/** A season's sent announcements, newest first, optionally only one team's. */
export async function announcementsOf(
  db: Db,
  seasonId: SeasonId,
  teamSeasonId?: TeamSeasonId,
  limit = 20,
): Promise<AnnouncementSummary[]> {
  const rows = await db
    .select({
      id: announcement.id,
      subject: announcement.subject,
      body: announcement.body,
      teamSeasonId: announcement.teamSeasonId,
      createdAt: announcement.createdAt,
      recipientCount: announcement.recipientCount,
    })
    .from(announcement)
    .where(
      and(
        eq(announcement.seasonId, seasonId),
        isNotNull(announcement.sentAt),
        teamSeasonId ? eq(announcement.teamSeasonId, teamSeasonId) : undefined,
      ),
    )
    .orderBy(desc(announcement.createdAt))
    .limit(limit);
  if (rows.length === 0) return [];
  const counts = await db
    .select({
      announcementId: message.announcementId,
      status: message.status,
      n: count(),
    })
    .from(message)
    .where(
      inArray(
        message.announcementId,
        rows.map((r) => r.id),
      ),
    )
    .groupBy(message.announcementId, message.status);
  return rows.map((r) => ({
    ...r,
    delivery: Object.fromEntries(
      counts
        .filter((c) => c.announcementId === r.id)
        .map((c) => [c.status, c.n]),
    ),
  }));
}
