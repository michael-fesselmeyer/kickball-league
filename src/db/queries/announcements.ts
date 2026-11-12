import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
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
 * announcement.
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
};

/**
 * Saves an announcement and queues one email per recipient. Run it in a
 * transaction, then send the queue.
 */
export async function sendAnnouncement(
  db: Db,
  input: AnnounceInput,
): Promise<Result<{ id: AnnouncementId; recipients: number }, AnnounceError>> {
  const subject = input.subject.trim();
  const body = input.body.trim();
  if (!subject || !body) return err("empty");
  if (subject.length > SUBJECT_MAX || body.length > BODY_MAX)
    return err("too_long");

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
    })
    .returning({ id: announcement.id });
  const id = required(created, "announcement").id;
  const payload: AnnouncementPayload = {
    subject,
    body,
    from: input.from,
    seasonName: input.seasonName,
    seasonSlug: input.seasonSlug,
    ...(input.team ? { teamName: input.team.name } : {}),
  };
  await enqueueMessages(
    db,
    recipients.map((userId) => ({
      userId,
      topic: "announcement",
      template: "announcement",
      payload,
      dedupeKey: `announcement/${id}/${userId}`,
      announcementId: id,
      sendAfter: input.now,
    })),
  );
  await recordAudit(db, {
    actorId: input.authorId,
    action: "announcement.send",
    entityType: "announcement",
    entityId: id,
    after: { teamSeasonId: teamId, subject, recipients: recipients.length },
  });
  return ok({ id, recipients: recipients.length });
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

/** A season's announcements, newest first, optionally only one team's. */
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
