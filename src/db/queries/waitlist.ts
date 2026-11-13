import { and, asc, count, eq, inArray, lt, lte, notInArray } from "drizzle-orm";
import type { SeasonId, UserId, WaitlistEntryId } from "@/domain/ids";
import { formatMoment } from "@/domain/money/credit";
import {
  mayRegisterTeam,
  offerExpiry,
  offerIsLive,
  offersToSend,
  type SeasonSpots,
} from "@/domain/money/waitlist";
import { err, ok, type Result } from "@/domain/result";
import type { WaitlistOfferPayload } from "@/emails/money";
import { user } from "../schema/auth";
import { league } from "../schema/league";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { registration, teamSeason } from "../schema/team";
import { waitlistEntry } from "../schema/waitlist";
import { enqueueMessages } from "./outbox";
import type { Db } from "./schedule";

/**
 * The team waitlist for full seasons (product-spec.md, "Waitlist for full
 * seasons, with timed offers"). See src/domain/money/waitlist.ts for the
 * rules. Offers expire by their own clock; the job only tidies up and
 * offers the next spot.
 */

/** Locks the season row so counting spots and taking one cannot interleave. */
export async function lockSeasonSpots(db: Db, seasonId: SeasonId) {
  await db
    .select({ id: season.id })
    .from(season)
    .where(eq(season.id, seasonId))
    .for("update");
}

/** How full a season is, and whether this person holds a live offer. */
export async function seasonSpots(
  db: Db,
  input: { seasonId: SeasonId; maxTeams: number | null; userId?: UserId },
  now: Date,
): Promise<SeasonSpots & { myOffer: WaitlistEntryId | null }> {
  const [entered, open] = await Promise.all([
    db
      .select({ n: count() })
      .from(teamSeason)
      .where(
        and(
          eq(teamSeason.seasonId, input.seasonId),
          notInArray(teamSeason.status, ["withdrawn", "waitlisted"]),
        ),
      ),
    db
      .select({
        id: waitlistEntry.id,
        userId: waitlistEntry.userId,
        status: waitlistEntry.status,
        offerExpiresAt: waitlistEntry.offerExpiresAt,
      })
      .from(waitlistEntry)
      .where(
        and(
          eq(waitlistEntry.seasonId, input.seasonId),
          inArray(waitlistEntry.status, ["waiting", "offered"]),
        ),
      ),
  ]);
  const live = open.filter((e) => offerIsLive(e, now));
  const mine = live.find((e) => e.userId === input.userId);
  return {
    maxTeams: input.maxTeams,
    entered: entered[0]?.n ?? 0,
    liveOffers: live.length,
    waiting: open.filter((e) => e.status === "waiting").length,
    myOffer: mine?.id ?? null,
  };
}

/**
 * Checks, under the season lock, that this person may take a team spot.
 * Returns false when the season is full for them, else the live offer they
 * hold, if any, to accept once the team is registered. Call inside the
 * transaction that registers the team.
 */
export async function checkTeamSpot(
  db: Db,
  input: { seasonId: SeasonId; maxTeams: number | null; userId: UserId },
  now: Date,
): Promise<false | { offerId: WaitlistEntryId | null }> {
  if (input.maxTeams === null) return { offerId: null };
  await lockSeasonSpots(db, input.seasonId);
  const spots = await seasonSpots(db, input, now);
  if (!mayRegisterTeam(spots, spots.myOffer !== null)) return false;
  return { offerId: spots.myOffer };
}

/** Marks an offer taken, once the team it held a spot for is registered. */
export async function acceptOffer(
  db: Db,
  offerId: WaitlistEntryId,
  now: Date,
): Promise<void> {
  await db
    .update(waitlistEntry)
    .set({ status: "accepted", decidedAt: now })
    .where(
      and(eq(waitlistEntry.id, offerId), eq(waitlistEntry.status, "offered")),
    );
}

export type JoinWaitlistError =
  "already_registered" | "already_waiting" | "spot_open" | "closed";

/** A captain joins the line for a full season. */
export async function joinWaitlist(
  db: Db,
  input: {
    seasonId: SeasonId;
    maxTeams: number | null;
    userId: UserId;
    teamName: string;
    open: boolean;
  },
  now: Date,
): Promise<Result<WaitlistEntryId, JoinWaitlistError>> {
  if (!input.open) return err("closed");
  const [registered] = await db
    .select({ id: registration.id })
    .from(registration)
    .where(
      and(
        eq(registration.seasonId, input.seasonId),
        eq(registration.userId, input.userId),
        notInArray(registration.status, ["cancelled"]),
      ),
    );
  if (registered) return err("already_registered");
  await lockSeasonSpots(db, input.seasonId);
  const spots = await seasonSpots(db, input, now);
  if (spots.myOffer) return err("already_waiting");
  if (mayRegisterTeam(spots, false)) return err("spot_open");
  const name = input.teamName.trim().replace(/\s+/g, " ").slice(0, 40);
  const [created] = await db
    .insert(waitlistEntry)
    .values({
      seasonId: input.seasonId,
      userId: input.userId,
      teamName: name || null,
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: waitlistEntry.id });
  return created ? ok(created.id) : err("already_waiting");
}

/** Leaves the line, or turns down an offer, which passes it on. */
export async function leaveWaitlist(
  db: Db,
  input: { seasonId: SeasonId; userId: UserId },
  now: Date,
): Promise<boolean> {
  const left = await db
    .update(waitlistEntry)
    .set({ status: "left", decidedAt: now })
    .where(
      and(
        eq(waitlistEntry.seasonId, input.seasonId),
        eq(waitlistEntry.userId, input.userId),
        inArray(waitlistEntry.status, ["waiting", "offered"]),
      ),
    )
    .returning({ id: waitlistEntry.id });
  return left.length > 0;
}

/** This person's place on a season's waitlist, if they are on it. */
export async function myWaitlistEntry(
  db: Db,
  seasonId: SeasonId,
  userId: UserId,
  now: Date,
) {
  const [entry] = await db
    .select({
      id: waitlistEntry.id,
      status: waitlistEntry.status,
      teamName: waitlistEntry.teamName,
      offerExpiresAt: waitlistEntry.offerExpiresAt,
      createdAt: waitlistEntry.createdAt,
    })
    .from(waitlistEntry)
    .where(
      and(
        eq(waitlistEntry.seasonId, seasonId),
        eq(waitlistEntry.userId, userId),
        inArray(waitlistEntry.status, ["waiting", "offered"]),
      ),
    );
  if (!entry) return null;
  if (entry.status === "offered")
    return offerIsLive(entry, now)
      ? { ...entry, state: "offered" as const, position: 0 }
      : { ...entry, state: "expired" as const, position: 0 };
  const [ahead] = await db
    .select({ n: count() })
    .from(waitlistEntry)
    .where(
      and(
        eq(waitlistEntry.seasonId, seasonId),
        eq(waitlistEntry.status, "waiting"),
        lt(waitlistEntry.createdAt, entry.createdAt),
      ),
    );
  return {
    ...entry,
    state: "waiting" as const,
    position: (ahead?.n ?? 0) + 1,
  };
}

/**
 * Expires offers whose time ran out and offers each free spot to the next
 * person in line, in seasons still open for registration. One season when
 * `seasonId` is given (an admin's "Offer now"), else every season. Safe to
 * run any number of times. Returns how many offers went out.
 */
export async function sendWaitlistOffers(
  db: Db,
  now: Date,
  seasonId?: SeasonId,
): Promise<{ expired: number; offered: number }> {
  const expired = await db
    .update(waitlistEntry)
    .set({ status: "expired", decidedAt: now })
    .where(
      and(
        eq(waitlistEntry.status, "offered"),
        lte(waitlistEntry.offerExpiresAt, now),
        ...(seasonId ? [eq(waitlistEntry.seasonId, seasonId)] : []),
      ),
    )
    .returning({ id: waitlistEntry.id });

  const seasons = await db
    .selectDistinct({
      id: season.id,
      name: season.name,
      slug: season.slug,
      maxTeams: season.maxTeams,
      closesAt: season.registrationClosesAt,
      timeZone: league.timezone,
    })
    .from(season)
    .innerJoin(league, eq(season.leagueId, league.id))
    .innerJoin(waitlistEntry, eq(waitlistEntry.seasonId, season.id))
    .where(
      and(
        eq(season.status, "registration_open"),
        eq(waitlistEntry.status, "waiting"),
        ...(seasonId ? [eq(season.id, seasonId)] : []),
      ),
    );

  let offered = 0;
  for (const s of seasons) {
    if (s.closesAt && now >= s.closesAt) continue;
    await lockSeasonSpots(db, s.id);
    const spots = await seasonSpots(
      db,
      { seasonId: s.id, maxTeams: s.maxTeams },
      now,
    );
    const n = offersToSend(spots);
    if (n === 0) continue;
    const next = await db
      .select({ id: waitlistEntry.id, userId: waitlistEntry.userId })
      .from(waitlistEntry)
      .where(
        and(
          eq(waitlistEntry.seasonId, s.id),
          eq(waitlistEntry.status, "waiting"),
        ),
      )
      .orderBy(asc(waitlistEntry.createdAt), asc(waitlistEntry.id))
      .limit(n);
    const expiresAt = offerExpiry(now);
    // An offer never outlives registration.
    const until = s.closesAt && s.closesAt < expiresAt ? s.closesAt : expiresAt;
    for (const entry of next) {
      await db
        .update(waitlistEntry)
        .set({ status: "offered", offeredAt: now, offerExpiresAt: until })
        .where(eq(waitlistEntry.id, entry.id));
      const payload: WaitlistOfferPayload = {
        seasonName: s.name,
        seasonSlug: s.slug,
        expires: formatMoment(until, s.timeZone),
      };
      await enqueueMessages(db, [
        {
          userId: entry.userId,
          topic: "payment",
          template: "waitlist_offer",
          payload,
          dedupeKey: `waitlist-offer/${entry.id}`,
          sendAfter: now,
        },
      ]);
      offered += 1;
    }
  }
  return { expired: expired.length, offered };
}

/** The admin's view of a season's line, in order. */
export async function waitlistBoard(db: Db, seasonId: SeasonId, now: Date) {
  const rows = await db
    .select({
      id: waitlistEntry.id,
      email: user.email,
      firstName: profile.firstName,
      lastName: profile.lastName,
      name: user.name,
      teamName: waitlistEntry.teamName,
      status: waitlistEntry.status,
      offerExpiresAt: waitlistEntry.offerExpiresAt,
      createdAt: waitlistEntry.createdAt,
    })
    .from(waitlistEntry)
    .innerJoin(user, eq(waitlistEntry.userId, user.id))
    .leftJoin(profile, eq(profile.userId, user.id))
    .where(eq(waitlistEntry.seasonId, seasonId))
    .orderBy(asc(waitlistEntry.createdAt), asc(waitlistEntry.id));
  return rows.map((r) => ({
    ...r,
    displayName:
      [r.firstName, r.lastName].filter(Boolean).join(" ").trim() || r.name,
    live:
      r.status === "offered" &&
      offerIsLive({ status: r.status, offerExpiresAt: r.offerExpiresAt }, now),
  }));
}
