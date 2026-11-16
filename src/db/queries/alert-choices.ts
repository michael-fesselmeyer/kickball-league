import { and, count, eq, inArray, sql } from "drizzle-orm";
import type { LeagueId, UserId } from "@/domain/ids";
import {
  ALERT_CARDS,
  type AlertCard,
  CARD_COPY,
  type CardAnswer,
  type CardMoments,
  cardsForTopic,
  nextCard,
  type PastAnswer,
} from "@/domain/notifications/alert-cards";
import {
  NO_TURN_DOWNS,
  nextDigestAt,
  snoozeEnd,
  type TurnDowns,
} from "@/domain/notifications/limits";
import {
  DEFAULT_ENABLED,
  NEWS_TOPICS,
  SETTINGS_TOPICS,
  type Topic,
} from "@/domain/notifications/topics";
import { user } from "../schema/auth";
import { leagueMember } from "../schema/league";
import {
  alertCardResponse,
  alertSetting,
  message,
  notificationPreference,
  pushSubscription,
} from "../schema/message";
import { alertLimitsOf } from "./outbox";
import type { Db } from "./schedule";

/**
 * Helping people choose alerts without overloading them (issue #529): the
 * in-app alert cards, turning alerts down instead of off, and the counts
 * admins see. See docs/architecture.md, section 5.
 */

type Via = "settings" | "card" | "email_link";

/** Turns one topic on or off on one channel, and says where it was changed. */
export async function setTopic(
  db: Db,
  userId: UserId,
  topic: Topic,
  channel: "email" | "push",
  enabled: boolean,
  via: Via,
): Promise<void> {
  await db
    .insert(notificationPreference)
    .values({ userId, topic, channel, enabled, changedVia: via })
    .onConflictDoUpdate({
      target: [
        notificationPreference.userId,
        notificationPreference.topic,
        notificationPreference.channel,
      ],
      set: { enabled, changedVia: via },
    });
}

/** What has happened to the person: the moments the cards wait for. One query. */
export async function cardMomentsOf(
  db: Db,
  userId: UserId,
  now: Date,
): Promise<CardMoments> {
  // The person's active roster spots, with their season's status.
  const spots = sql`(
    select rm.team_season_id, s.status as season_status
    from roster_membership rm
    join registration r on r.id = rm.registration_id
    join season s on s.id = r.season_id
    where r.user_id = ${userId} and rm.status = 'active'
  )`;
  const [row] = await db
    .select({
      rsvped: sql<boolean>`exists (select 1 from game_rsvp where user_id = ${userId})`,
      onTeam: sql<boolean>`exists (select 1 from ${spots} spots where season_status <> 'completed')`,
      playedGame: sql<boolean>`exists (
        select 1 from game g
        join slot on slot.id = g.slot_id
        join ${spots} spots on spots.team_season_id in (g.team_a_id, g.team_b_id)
        where g.status in ('final', 'forfeit') and slot.starts_at < ${now}
      )`,
      seasonEnded: sql<boolean>`(
        exists (select 1 from ${spots} spots where season_status = 'completed')
        and not exists (select 1 from ${spots} spots where season_status <> 'completed')
      )`,
    })
    .from(user)
    .where(eq(user.id, userId));
  return {
    rsvped: row?.rsvped ?? false,
    onTeam: row?.onTeam ?? false,
    playedGame: row?.playedGame ?? false,
    seasonEnded: row?.seasonEnded ?? false,
  };
}

/** The cards whose offer is already on, so asking would be noise. */
async function cardsAlreadyOn(db: Db, userId: UserId): Promise<Set<AlertCard>> {
  const [choices, devices, [setting]] = await Promise.all([
    db
      .select({
        topic: notificationPreference.topic,
        channel: notificationPreference.channel,
        enabled: notificationPreference.enabled,
      })
      .from(notificationPreference)
      .where(eq(notificationPreference.userId, userId)),
    db
      .select({ n: count() })
      .from(pushSubscription)
      .where(eq(pushSubscription.userId, userId)),
    db
      .select({ weeklyNews: alertSetting.weeklyNews })
      .from(alertSetting)
      .where(eq(alertSetting.userId, userId)),
  ]);
  const on = (topic: Topic, channel: "email" | "push") =>
    choices.find((c) => c.topic === topic && c.channel === channel)?.enabled ??
    (channel === "email" ? DEFAULT_ENABLED[topic] : false);
  const hasDevice = (devices[0]?.n ?? 0) > 0;
  const already = new Set<AlertCard>();
  for (const card of ALERT_CARDS) {
    const { topic, channel } = CARD_COPY[card];
    if (channel === "push" && hasDevice && on(topic, "push")) already.add(card);
    if (channel === "email" && on(topic, "email")) already.add(card);
  }
  // The weekly roundup is on when news comes weekly, even if it's off now.
  if (setting?.weeklyNews) already.add("first_game");
  return already;
}

/** The person's past answers, newest first. */
async function answersOf(db: Db, userId: UserId): Promise<PastAnswer[]> {
  const rows = await db
    .select({
      card: alertCardResponse.card,
      answer: alertCardResponse.answer,
      at: alertCardResponse.answeredAt,
    })
    .from(alertCardResponse)
    .where(eq(alertCardResponse.userId, userId));
  return rows;
}

/**
 * The alert card to show this person now, or null. Push cards are skipped
 * when the league has no push key (`pushReady`).
 */
export async function alertCardFor(
  db: Db,
  userId: UserId,
  { now, pushReady }: { now: Date; pushReady: boolean },
): Promise<AlertCard | null> {
  const answers = await answersOf(db, userId);
  // Most visits end here: a recent answer keeps every card away.
  if (
    nextCard({ moments: ALL_MOMENTS, answers, alreadyOn: new Set(), now }) ===
    null
  )
    return null;
  const [moments, alreadyOn] = await Promise.all([
    cardMomentsOf(db, userId, now),
    cardsAlreadyOn(db, userId),
  ]);
  return nextCard({
    moments,
    answers,
    alreadyOn,
    unavailable: pushReady ? new Set() : new Set(["push"]),
    now,
  });
}

const ALL_MOMENTS: CardMoments = {
  rsvped: true,
  onTeam: true,
  playedGame: true,
  seasonEnded: true,
};

/**
 * Records an answer to a card and, for "yes", turns on what it offered:
 * the push topic (the caller saved the device first), or, when the browser
 * couldn't do push (`pushFailed`), the same topic by email; the email topic
 * for an email card, with news held for Sundays for the weekly roundup.
 * A card answers once: a second answer changes nothing. Returns whether
 * this answer was recorded.
 */
export async function answerAlertCard(
  db: Db,
  userId: UserId,
  card: AlertCard,
  answer: CardAnswer,
  { now, pushFailed = false }: { now: Date; pushFailed?: boolean },
): Promise<boolean> {
  const recorded = await db
    .insert(alertCardResponse)
    .values({ userId, card, answer, answeredAt: now })
    .onConflictDoNothing()
    .returning({ card: alertCardResponse.card });
  if (recorded.length === 0 || answer === "no") return recorded.length > 0;
  const { topic, channel } = CARD_COPY[card];
  await setTopic(
    db,
    userId,
    topic,
    channel === "push" && !pushFailed ? "push" : "email",
    true,
    "card",
  );
  if (card === "first_game")
    await saveTurnDowns(db, userId, { weeklyNews: true });
  return true;
}

/** A person's turn-downs: snooze, only my team and the weekly roundup. */
export async function turnDownsOf(db: Db, userId: UserId): Promise<TurnDowns> {
  const [row] = await db
    .select({
      snoozedUntil: alertSetting.snoozedUntil,
      teamOnly: alertSetting.teamOnly,
      weeklyNews: alertSetting.weeklyNews,
    })
    .from(alertSetting)
    .where(eq(alertSetting.userId, userId));
  return row ?? NO_TURN_DOWNS;
}

/** Saves some of a person's turn-downs, leaving their other limits as they are. */
export async function saveTurnDowns(
  db: Db,
  userId: UserId,
  changes: Partial<TurnDowns>,
): Promise<void> {
  if (Object.keys(changes).length === 0) return;
  await db
    .insert(alertSetting)
    .values({ userId, ...changes })
    .onConflictDoUpdate({ target: alertSetting.userId, set: changes });
}

/** The ways an email footer offers to turn alerts down instead of off. */
export const TURN_DOWNS = ["team", "weekly", "snooze"] as const;
export type TurnDown = (typeof TURN_DOWNS)[number];

/**
 * Applies one footer choice, from the email about `topic`:
 * - team: only my team's news (league-wide news is skipped);
 * - weekly: news emails come as one roundup on Sundays; from a non-news
 *   email, every non-urgent email comes in a weekly digest instead;
 * - snooze: non-urgent messages wait two weeks, then come as a digest.
 * Urgent messages about the person's own games and payments still come.
 */
export async function turnDown(
  db: Db,
  userId: UserId,
  choice: TurnDown,
  { topic, now, timeZone }: { topic: Topic; now: Date; timeZone: string },
): Promise<void> {
  if (choice === "team") {
    await saveTurnDowns(db, userId, { teamOnly: true });
    return;
  }
  if (choice === "snooze") {
    await snoozeAlerts(db, userId, { now, timeZone });
    return;
  }
  if (NEWS_TOPICS.has(topic)) {
    await saveTurnDowns(db, userId, { weeklyNews: true });
    return;
  }
  await db
    .insert(alertSetting)
    .values({ userId, dailyCap: 0, digest: "weekly" })
    .onConflictDoUpdate({
      target: alertSetting.userId,
      set: { dailyCap: 0, digest: "weekly" },
    });
}

/**
 * Snoozes non-urgent messages for two weeks, or ends a snooze early
 * (`end`). Messages already held move to the first digest after the snooze,
 * or, when it ends, to the next digest.
 */
export async function snoozeAlerts(
  db: Db,
  userId: UserId,
  {
    now,
    timeZone,
    end = false,
  }: { now: Date; timeZone: string; end?: boolean },
): Promise<void> {
  const until = end ? null : snoozeEnd(now);
  await saveTurnDowns(db, userId, { snoozedUntil: until });
  const limits = await alertLimitsOf(db, [userId]);
  await db
    .update(message)
    .set({
      sendAfter: nextDigestAt(
        until ?? now,
        timeZone,
        limits.get(userId)?.digest ?? "daily",
      ),
    })
    .where(and(eq(message.userId, userId), eq(message.status, "held")));
}

export type TopicCounts = {
  topic: Topic;
  label: string;
  /** Members who get it by email. */
  email: number;
  /** Members who turned its push on. */
  push: number;
  /** "No thanks" to a card offering it. */
  turnedDown: number;
  /** Turned off from an email's unsubscribe link. */
  unsubscribed: number;
};

export type AlertChoiceCounts = {
  members: number;
  topics: TopicCounts[];
  /** Members who turned alerts down instead of off. */
  snoozed: number;
  teamOnly: number;
  weeklyNews: number;
};

/**
 * What admins see about alert choices: counts per topic for the league's
 * members, nothing per person. Four queries, run in parallel.
 */
export async function alertChoiceCounts(
  db: Db,
  leagueId: LeagueId,
  now: Date,
): Promise<AlertChoiceCounts> {
  const members = db
    .select({ userId: leagueMember.userId })
    .from(leagueMember)
    .where(eq(leagueMember.leagueId, leagueId));
  const [[total], prefs, cards, [downs]] = await Promise.all([
    db
      .select({ n: count() })
      .from(leagueMember)
      .where(eq(leagueMember.leagueId, leagueId)),
    db
      .select({
        topic: notificationPreference.topic,
        channel: notificationPreference.channel,
        on: sql<number>`count(*) filter (where ${notificationPreference.enabled})::int`,
        off: sql<number>`count(*) filter (where not ${notificationPreference.enabled})::int`,
        unsubscribed: sql<number>`count(*) filter (where not ${notificationPreference.enabled} and ${notificationPreference.changedVia} = 'email_link')::int`,
      })
      .from(notificationPreference)
      .where(inArray(notificationPreference.userId, members))
      .groupBy(notificationPreference.topic, notificationPreference.channel),
    db
      .select({ card: alertCardResponse.card, n: count() })
      .from(alertCardResponse)
      .where(
        and(
          inArray(alertCardResponse.userId, members),
          eq(alertCardResponse.answer, "no"),
        ),
      )
      .groupBy(alertCardResponse.card),
    db
      .select({
        snoozed: sql<number>`count(*) filter (where ${alertSetting.snoozedUntil} > ${now})::int`,
        teamOnly: sql<number>`count(*) filter (where ${alertSetting.teamOnly})::int`,
        weeklyNews: sql<number>`count(*) filter (where ${alertSetting.weeklyNews})::int`,
      })
      .from(alertSetting)
      .where(inArray(alertSetting.userId, members)),
  ]);
  const memberCount = total?.n ?? 0;
  const pref = (topic: Topic, channel: "email" | "push") =>
    prefs.find((p) => p.topic === topic && p.channel === channel);
  return {
    members: memberCount,
    topics: SETTINGS_TOPICS.map(({ topic, label }) => {
      const email = pref(topic, "email");
      const turnedDown = cardsForTopic(topic).reduce(
        (sum, card) => sum + (cards.find((c) => c.card === card)?.n ?? 0),
        0,
      );
      return {
        topic,
        label,
        email: DEFAULT_ENABLED[topic]
          ? memberCount - (email?.off ?? 0)
          : (email?.on ?? 0),
        push: pref(topic, "push")?.on ?? 0,
        turnedDown,
        unsubscribed: email?.unsubscribed ?? 0,
      };
    }),
    snoozed: downs?.snoozed ?? 0,
    teamOnly: downs?.teamOnly ?? 0,
    weeklyNews: downs?.weeklyNews ?? 0,
  };
}
