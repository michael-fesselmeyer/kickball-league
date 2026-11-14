import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type {
  LeagueId,
  PrivateEventId,
  PurchaseId,
  SeasonId,
  UserId,
} from "@/domain/ids";
import {
  type Acceptance,
  privateSeasonSlug,
  type RequestInput,
} from "@/domain/private-events/request";
import { err, ok, type Result } from "@/domain/result";
import type { PrivateEventPayload } from "@/emails/private-event";
import { user } from "../schema/auth";
import { privateEvent } from "../schema/private-event";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { rosterMembership, team, teamSeason } from "../schema/team";
import { recordAudit } from "./audit";
import { enqueueMessages, type OutboxMessage } from "./outbox";
import { createPurchase } from "./payments";
import { consumeRateLimit } from "./rate-limit";
import { required } from "./rows";
import type { Db } from "./schedule";

/**
 * Private leagues and tournaments (ADR 0049). An organizer asks; an admin
 * accepts the request as an invite-only private season of the league, or
 * declines it; the organizer shares the invite link and, when the league
 * bills the organization, pays once for every team.
 */

/** Requests one organizer may send in a day. */
export const REQUESTS_PER_DAY = { windowSeconds: 86_400, max: 3 };

const notice = (
  userId: UserId,
  dedupeKey: string,
  payload: PrivateEventPayload,
  now: Date,
): OutboxMessage => ({
  userId,
  topic: "operations",
  template: "private_event",
  payload,
  dedupeKey,
  sendAfter: now,
});

export async function requestPrivateEvent(
  db: Db,
  input: {
    leagueId: LeagueId;
    organizerId: UserId;
    request: RequestInput;
    now: Date;
  },
): Promise<Result<{ id: PrivateEventId }, "too_many">> {
  const allowed = await consumeRateLimit(
    db,
    `private-event:${input.organizerId}`,
    REQUESTS_PER_DAY,
    input.now,
  );
  if (!allowed) return err("too_many");
  const [created] = await db
    .insert(privateEvent)
    .values({
      leagueId: input.leagueId,
      organizerId: input.organizerId,
      ...input.request,
    })
    .returning({ id: privateEvent.id });
  const id = required(created, "private event").id;
  await recordAudit(db, {
    actorId: input.organizerId,
    action: "private_event.request",
    entityType: "private_event",
    entityId: id,
    after: input.request,
  });
  await enqueueMessages(db, [
    notice(
      input.organizerId,
      `private-event:${id}:received`,
      {
        step: "received",
        organization: input.request.organization,
        kind: input.request.kind,
      },
      input.now,
    ),
  ]);
  return ok({ id });
}

const eventColumns = {
  id: privateEvent.id,
  organizerId: privateEvent.organizerId,
  kind: privateEvent.kind,
  status: privateEvent.status,
  organization: privateEvent.organization,
  teams: privateEvent.teams,
  preferredDates: privateEvent.preferredDates,
  note: privateEvent.note,
  payer: privateEvent.payer,
  priceCents: privateEvent.priceCents,
  paidAt: privateEvent.paidAt,
  createdAt: privateEvent.createdAt,
  seasonId: privateEvent.seasonId,
  seasonName: season.name,
  seasonSlug: season.slug,
  seasonStatus: season.status,
};

/** The signed-in organizer's own requests, newest first. */
export async function myPrivateEvents(
  db: Db,
  leagueId: LeagueId,
  organizerId: UserId,
) {
  return db
    .select(eventColumns)
    .from(privateEvent)
    .leftJoin(season, eq(season.id, privateEvent.seasonId))
    .where(
      and(
        eq(privateEvent.leagueId, leagueId),
        eq(privateEvent.organizerId, organizerId),
      ),
    )
    .orderBy(desc(privateEvent.createdAt));
}

/** The admins' queue: open requests first, oldest first, then the rest. */
export async function privateEventQueue(db: Db, leagueId: LeagueId) {
  const open = sql`(${privateEvent.status} = 'requested')`;
  return db
    .select({
      ...eventColumns,
      organizerName: user.name,
      organizerEmail: user.email,
      firstName: profile.firstName,
      lastName: profile.lastName,
    })
    .from(privateEvent)
    .innerJoin(user, eq(user.id, privateEvent.organizerId))
    .leftJoin(profile, eq(profile.userId, privateEvent.organizerId))
    .leftJoin(season, eq(season.id, privateEvent.seasonId))
    .where(eq(privateEvent.leagueId, leagueId))
    .orderBy(
      desc(open),
      sql`case when ${open} then ${privateEvent.createdAt} end asc`,
      desc(privateEvent.createdAt),
    )
    .limit(100);
}

export type QueueRow = Awaited<ReturnType<typeof privateEventQueue>>[number];

async function openRequest(db: Db, leagueId: LeagueId, id: PrivateEventId) {
  const [found] = await db
    .select({
      id: privateEvent.id,
      status: privateEvent.status,
      organizerId: privateEvent.organizerId,
      organization: privateEvent.organization,
      kind: privateEvent.kind,
      teams: privateEvent.teams,
    })
    .from(privateEvent)
    .where(and(eq(privateEvent.id, id), eq(privateEvent.leagueId, leagueId)))
    .for("update");
  if (!found) return err("not_found" as const);
  if (found.status !== "requested") return err("not_open" as const);
  return ok(found);
}

/** A season slug no other season of the league has. */
async function freeSlug(db: Db, leagueId: LeagueId, base: string) {
  const taken = new Set(
    (
      await db
        .select({ slug: season.slug })
        .from(season)
        .where(
          and(
            eq(season.leagueId, leagueId),
            sql`${season.slug} like ${`${base}%`}`,
          ),
        )
    ).map((s) => s.slug),
  );
  for (let n = 1; ; n += 1) {
    const slug = n === 1 ? base : `${base}-${n}`;
    if (!taken.has(slug)) return slug;
  }
}

/** The secret in an invite link: 144 random bits, URL-safe. */
const inviteToken = () => randomBytes(18).toString("base64url");

/**
 * Accepts a request as a private season, open for teams by invite. When
 * the organization pays, teams enter free and the organization pays the
 * price once; otherwise each player pays the fee, as in any season. The
 * season reuses the league's newest waiver.
 */
export async function acceptPrivateEvent(
  db: Db,
  input: {
    leagueId: LeagueId;
    eventId: PrivateEventId;
    actorId: UserId;
    acceptance: Acceptance;
    now: Date;
  },
): Promise<
  Result<{ seasonId: SeasonId; seasonSlug: string }, "not_found" | "not_open">
> {
  const found = await openRequest(db, input.leagueId, input.eventId);
  if (!found.ok) return found;
  const event = found.value;
  const a = input.acceptance;
  const [latest] = await db
    .select({ waiverId: season.waiverId })
    .from(season)
    .where(
      and(eq(season.leagueId, input.leagueId), eq(season.visibility, "league")),
    )
    .orderBy(desc(season.startsOn))
    .limit(1);
  const slug = await freeSlug(
    db,
    input.leagueId,
    privateSeasonSlug(event.organization, a.startsOn),
  );
  const organizationPays = a.payer === "organization";
  const [created] = await db
    .insert(season)
    .values({
      leagueId: input.leagueId,
      name: a.name,
      slug,
      visibility: "private",
      status: "registration_open",
      startsOn: a.startsOn,
      endsOn: a.endsOn,
      feeModel: organizationPays ? "per_team" : "per_player",
      teamFeeCents: organizationPays ? 0 : null,
      playerFeeCents: organizationPays ? null : a.playerFeeCents,
      maxTeams: event.teams,
      rosterMin: 1,
      rosterMax: 30,
      gamesPerTeamPerDay: a.gamesPerTeamPerDay,
      waiverId: latest?.waiverId ?? null,
      createdBy: input.actorId,
    })
    .returning({ id: season.id });
  const seasonId = required(created, "season").id;
  await db
    .update(privateEvent)
    .set({
      status: "accepted",
      seasonId,
      payer: a.payer,
      priceCents: a.priceCents,
      inviteToken: inviteToken(),
      decidedAt: input.now,
      decidedBy: input.actorId,
    })
    .where(eq(privateEvent.id, event.id));
  await recordAudit(db, {
    actorId: input.actorId,
    action: "private_event.accept",
    entityType: "private_event",
    entityId: event.id,
    after: { ...a, seasonId, slug },
  });
  await enqueueMessages(db, [
    notice(
      event.organizerId,
      `private-event:${event.id}:accepted`,
      {
        step: "accepted",
        organization: event.organization,
        kind: event.kind,
        seasonName: a.name,
        seasonSlug: slug,
      },
      input.now,
    ),
  ]);
  return ok({ seasonId, seasonSlug: slug });
}

export async function declinePrivateEvent(
  db: Db,
  input: {
    leagueId: LeagueId;
    eventId: PrivateEventId;
    actorId: UserId;
    reason: string | null;
    now: Date;
  },
): Promise<Result<void, "not_found" | "not_open">> {
  const found = await openRequest(db, input.leagueId, input.eventId);
  if (!found.ok) return found;
  const event = found.value;
  await db
    .update(privateEvent)
    .set({
      status: "declined",
      decidedAt: input.now,
      decidedBy: input.actorId,
    })
    .where(eq(privateEvent.id, event.id));
  await recordAudit(db, {
    actorId: input.actorId,
    action: "private_event.decline",
    entityType: "private_event",
    entityId: event.id,
    after: { reason: input.reason },
  });
  await enqueueMessages(db, [
    notice(
      event.organizerId,
      `private-event:${event.id}:declined`,
      {
        step: "declined",
        organization: event.organization,
        kind: event.kind,
        reason: input.reason,
      },
      input.now,
    ),
  ]);
  return ok(undefined);
}

/**
 * A private season's event, by the season's slug, for its organizer page.
 * The caller checks that the viewer is its organizer or an admin.
 */
export async function privateEventBySeason(
  db: Db,
  leagueId: LeagueId,
  slug: string,
) {
  const [found] = await db
    .select({
      ...eventColumns,
      inviteToken: privateEvent.inviteToken,
      seasonStartsOn: season.startsOn,
      seasonEndsOn: season.endsOn,
      playerFeeCents: season.playerFeeCents,
    })
    .from(privateEvent)
    .innerJoin(season, eq(season.id, privateEvent.seasonId))
    .where(
      and(
        eq(privateEvent.leagueId, leagueId),
        eq(season.slug, slug),
        eq(season.visibility, "private"),
      ),
    );
  return found ?? null;
}

/** The teams entered in a private season, with their captain and size. */
export async function privateEventTeams(db: Db, seasonId: SeasonId) {
  const captains = db
    .select({
      teamSeasonId: rosterMembership.teamSeasonId,
      players: sql<number>`count(*)::int`.as("players"),
    })
    .from(rosterMembership)
    .where(eq(rosterMembership.status, "active"))
    .groupBy(rosterMembership.teamSeasonId)
    .as("sizes");
  return db
    .select({
      id: teamSeason.id,
      name: team.name,
      status: teamSeason.status,
      players: sql<number>`coalesce(${captains.players}, 0)::int`,
    })
    .from(teamSeason)
    .innerJoin(team, eq(team.id, teamSeason.teamId))
    .leftJoin(captains, eq(captains.teamSeasonId, teamSeason.id))
    .where(
      and(
        eq(teamSeason.seasonId, seasonId),
        inArray(teamSeason.status, ["forming", "pending_payment", "confirmed"]),
      ),
    )
    .orderBy(asc(team.name));
}

/**
 * The private season an invite link opens, while it takes teams. An
 * unknown or old link, or a season past registration, finds nothing.
 */
export async function seasonForInvite(db: Db, token: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const [found] = await db
    .select({
      seasonId: season.id,
      slug: season.slug,
      name: season.name,
      status: season.status,
      organization: privateEvent.organization,
    })
    .from(privateEvent)
    .innerJoin(season, eq(season.id, privateEvent.seasonId))
    .where(
      and(
        eq(privateEvent.inviteToken, token),
        eq(privateEvent.status, "accepted"),
      ),
    );
  return found ?? null;
}

/** Whether `token` is the invite for this private season. */
export async function inviteMatches(
  db: Db,
  seasonId: SeasonId,
  token: string | null,
): Promise<boolean> {
  if (!token) return false;
  const found = await seasonForInvite(db, token);
  return found?.seasonId === seasonId;
}

/**
 * The organization's one payment for every team: a purchase of the price,
 * settled by the Stripe webhook like any other. Null when there is nothing
 * to pay: players pay, it is already paid, or the price is zero.
 */
export async function organizerPurchase(
  db: Db,
  input: { eventId: PrivateEventId; userId: UserId },
): Promise<{ purchaseId: PurchaseId; totalCents: number } | null> {
  const [event] = await db
    .select({
      payer: privateEvent.payer,
      priceCents: privateEvent.priceCents,
      paidAt: privateEvent.paidAt,
      seasonId: privateEvent.seasonId,
      seasonName: season.name,
    })
    .from(privateEvent)
    .innerJoin(season, eq(season.id, privateEvent.seasonId))
    .where(eq(privateEvent.id, input.eventId))
    .for("update", { of: privateEvent });
  if (
    !event?.seasonId ||
    event.payer !== "organization" ||
    event.paidAt ||
    !event.priceCents
  )
    return null;
  const purchaseId = await createPurchase(db, {
    userId: input.userId,
    seasonId: event.seasonId,
    items: [
      {
        kind: "private_event",
        amountCents: event.priceCents,
        description: `${event.seasonName}: every team`,
        registrationId: null,
        teamSeasonId: null,
      },
    ],
  });
  return { purchaseId, totalCents: event.priceCents };
}
