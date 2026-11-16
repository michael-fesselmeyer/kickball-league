import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { UserId } from "@/domain/ids";
import { ok } from "@/domain/result";
import { rendererFor } from "@/emails/templates";
import type { Email, EmailSender } from "@/services/email";
import { game, gameRsvp } from "../schema/game";
import { leagueMember } from "../schema/league";
import {
  alertCardResponse,
  alertSetting,
  announcement,
  message,
  notificationPreference,
} from "../schema/message";
import { season } from "../schema/season";
import { messagingWorld } from "../test/messaging-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import {
  alertCardFor,
  alertChoiceCounts,
  answerAlertCard,
  cardMomentsOf,
  snoozeAlerts,
  turnDown,
  turnDownsOf,
} from "./alert-choices";
import {
  emailSettingsOf,
  saveEmailSettings,
  startWithNewsOff,
  turnOffEmailTopic,
} from "./notifications";
import { drainOutbox, enqueueMessages, type OutboxMessage } from "./outbox";
import { currentRules, publishRuleChange } from "./rules";
import type { Db } from "./schedule";
import { remindMissingSizes } from "./shirt-order";
import { openSurvey } from "./surveys";

afterAll(closePool);

// A Monday afternoon in New York, outside quiet hours.
const NOW = new Date("2026-09-14T17:00:00Z");
const NY = "America/New_York";
const DAY = 24 * 60 * 60 * 1000;
const render = rendererFor({ siteUrl: "https://league.example.test" });

/** Drains the outbox, returning the emails sent to `to`. */
async function sentTo(db: Db, to: string, now = NOW): Promise<Email[]> {
  const sent: Email[] = [];
  const send: EmailSender = async (email) => {
    sent.push(email);
    return ok({ id: `email-${sent.length}` });
  };
  await drainOutbox(db, { send, render, now, limit: 200 });
  return sent.filter((e) => e.to === to);
}

const statusOf = async (db: Db, dedupeKey: string) =>
  (
    await db
      .select({ status: message.status, reason: message.suppressReason })
      .from(message)
      .where(eq(message.dedupeKey, dedupeKey))
  )[0];

describe("#521: kinds that aren't league news reach new accounts", () => {
  it("sends a rule change to an account that started with news off", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const newcomer = w.aces.players[0];
      if (!newcomer) throw new Error("player");
      await startWithNewsOff(db, newcomer.userId);
      const lineups = {
        id: null,
        title: "Lineups",
        body: "Sample rule.",
        remove: false,
      };
      const first = await publishRuleChange(db, {
        leagueId: w.leagueId,
        actorId: w.aces.captain.userId,
        sections: [lineups],
        version: "",
        summary: "The first rules",
        effectiveOn: "",
        notice: false,
        today: "2026-09-14",
        rulesPath: "/rules",
      });
      if (!first.ok) throw new Error(first.error);
      const [saved] = await currentRules(db, w.leagueId);
      if (!saved) throw new Error("sections");
      const changed = await publishRuleChange(db, {
        leagueId: w.leagueId,
        actorId: w.aces.captain.userId,
        sections: [{ ...saved, body: "Sample: changed.", remove: false }],
        version: first.value.id,
        summary: "A new lineup rule",
        effectiveOn: "2026-09-20",
        notice: true,
        today: "2026-09-14",
        rulesPath: "/rules",
      });
      if (!changed.ok) throw new Error(changed.error);
      const [queued] = await db
        .select({ topic: message.topic })
        .from(message)
        .where(
          and(
            eq(message.template, "rule_change"),
            eq(message.userId, newcomer.userId),
          ),
        );
      expect(queued?.topic).toBe("rules");
      await db
        .update(message)
        .set({ sendAfter: NOW })
        .where(eq(message.template, "rule_change"));
      const mine = await sentTo(db, newcomer.email);
      expect(mine).toHaveLength(1);
    });
  });

  it("sends the shirt size reminder to an account that started with news off", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const newcomer = w.aces.players[0];
      if (!newcomer) throw new Error("player");
      await startWithNewsOff(db, newcomer.userId);
      expect(
        await remindMissingSizes(db, {
          seasonId: w.season.id,
          actorId: w.aces.captain.userId,
          now: NOW,
        }),
      ).toBeGreaterThan(0);
      const [queued] = await db
        .select({ topic: message.topic })
        .from(message)
        .where(
          and(
            eq(message.template, "shirt_size_reminder"),
            eq(message.userId, newcomer.userId),
          ),
        );
      expect(queued?.topic).toBe("payment");
      expect(await sentTo(db, newcomer.email)).toHaveLength(1);
    });
  });

  it("keeps the survey invitation as news, which the season-end card turns on", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const [newcomer, chose] = w.aces.players;
      if (!newcomer || !chose) throw new Error("players");
      await startWithNewsOff(db, newcomer.userId);
      await startWithNewsOff(db, chose.userId);
      await db
        .update(season)
        .set({ status: "completed" })
        .where(eq(season.id, w.season.id));
      // The season-end card is offered to the one with news off.
      expect(
        await alertCardFor(db, chose.userId, { now: NOW, pushReady: false }),
      ).toBe("season_end");
      await answerAlertCard(db, chose.userId, "season_end", "yes", {
        now: NOW,
      });
      const opened = await openSurvey(db, {
        seasonId: w.season.id,
        actorId: w.aces.captain.userId,
        now: NOW,
      });
      expect(opened.ok).toBe(true);
      // Queued for "now"; due at the test's clock.
      await db
        .update(message)
        .set({ sendAfter: NOW })
        .where(eq(message.template, "survey_invite"));
      await sentTo(db, newcomer.email);
      const rows = await db
        .select({ userId: message.userId, status: message.status })
        .from(message)
        .where(eq(message.template, "survey_invite"));
      const of = (id: UserId) => rows.find((r) => r.userId === id)?.status;
      expect(of(newcomer.userId)).toBe("suppressed");
      expect(of(chose.userId)).toBe("sent");
    });
  });
});

describe("cardMomentsOf", () => {
  it("finds each moment as it happens", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const loner = await w.person("loner");
      expect(await cardMomentsOf(db, loner.userId, NOW)).toEqual({
        rsvped: false,
        onTeam: false,
        playedGame: false,
        seasonEnded: false,
      });
      const p = w.aces.players[0];
      if (!p) throw new Error("player");
      expect(await cardMomentsOf(db, p.userId, NOW)).toMatchObject({
        onTeam: true,
        rsvped: false,
        playedGame: false,
      });
      const { gameId } = await w.gameEnding(new Date(NOW.getTime() - DAY));
      await db.insert(gameRsvp).values({
        gameId,
        userId: p.userId,
        teamSeasonId: w.aces.id,
        status: "in",
      });
      expect((await cardMomentsOf(db, p.userId, NOW)).rsvped).toBe(true);
      // A game is only played once it is final or a forfeit.
      expect((await cardMomentsOf(db, p.userId, NOW)).playedGame).toBe(false);
      await db
        .update(game)
        .set({ status: "final", scoreA: 5, scoreB: 3, finalizedAt: NOW })
        .where(eq(game.id, gameId));
      expect((await cardMomentsOf(db, p.userId, NOW)).playedGame).toBe(true);
      await db
        .update(season)
        .set({ status: "completed" })
        .where(eq(season.id, w.season.id));
      expect(await cardMomentsOf(db, p.userId, NOW)).toMatchObject({
        onTeam: false,
        seasonEnded: true,
      });
    });
  });
});

describe("alertCardFor and answerAlertCard", () => {
  it("offers one card at a time and follows the cooldowns", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const p = w.aces.players[0];
      if (!p) throw new Error("player");
      await startWithNewsOff(db, p.userId);
      const { gameId } = await w.gameEnding(new Date(NOW.getTime() - DAY));
      await db.insert(gameRsvp).values({
        gameId,
        userId: p.userId,
        teamSeasonId: w.aces.id,
        status: "in",
      });
      const at = (now: Date) =>
        alertCardFor(db, p.userId, { now, pushReady: true });
      expect(await at(NOW)).toBe("first_rsvp");
      await answerAlertCard(db, p.userId, "first_rsvp", "no", { now: NOW });
      // A month of quiet after "No thanks".
      expect(await at(new Date(NOW.getTime() + 29 * DAY))).toBeNull();
      expect(await at(new Date(NOW.getTime() + 30 * DAY))).toBe("joined_team");
      // Without push, the push cards are skipped.
      expect(
        await alertCardFor(db, p.userId, {
          now: new Date(NOW.getTime() + 30 * DAY),
          pushReady: false,
        }),
      ).toBeNull();
    });
  });

  it("turns on push for a push card, or email when the browser can't", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const [a, b] = w.aces.players;
      if (!a || !b) throw new Error("players");
      await answerAlertCard(db, a.userId, "first_rsvp", "yes", { now: NOW });
      await answerAlertCard(db, b.userId, "first_rsvp", "yes", {
        now: NOW,
        pushFailed: true,
      });
      const prefs = await db
        .select({
          userId: notificationPreference.userId,
          channel: notificationPreference.channel,
          enabled: notificationPreference.enabled,
          via: notificationPreference.changedVia,
        })
        .from(notificationPreference)
        .where(eq(notificationPreference.topic, "rainout"));
      expect(prefs.filter((r) => r.userId === a.userId)).toEqual([
        { userId: a.userId, channel: "push", enabled: true, via: "card" },
      ]);
      expect(prefs.filter((r) => r.userId === b.userId)).toEqual([
        { userId: b.userId, channel: "email", enabled: true, via: "card" },
      ]);
    });
  });

  it("answers once: a second answer changes nothing", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const p = w.aces.players[0];
      if (!p) throw new Error("player");
      await startWithNewsOff(db, p.userId);
      expect(
        await answerAlertCard(db, p.userId, "first_game", "no", { now: NOW }),
      ).toBe(true);
      expect(
        await answerAlertCard(db, p.userId, "first_game", "yes", { now: NOW }),
      ).toBe(false);
      const news = (await emailSettingsOf(db, p.userId)).find(
        (t) => t.topic === "announcement",
      );
      expect(news?.enabled).toBe(false);
      const rows = await db
        .select({ answer: alertCardResponse.answer })
        .from(alertCardResponse)
        .where(eq(alertCardResponse.userId, p.userId));
      expect(rows).toEqual([{ answer: "no" }]);
    });
  });

  it("turns on the weekly roundup from the first-game card", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const p = w.aces.players[0];
      if (!p) throw new Error("player");
      await startWithNewsOff(db, p.userId);
      await answerAlertCard(db, p.userId, "first_game", "yes", { now: NOW });
      const news = (await emailSettingsOf(db, p.userId)).find(
        (t) => t.topic === "announcement",
      );
      expect(news?.enabled).toBe(true);
      expect((await turnDownsOf(db, p.userId)).weeklyNews).toBe(true);
    });
  });

  it("skips the roundup card for someone who already gets news", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const p = w.aces.players[0];
      if (!p) throw new Error("player");
      const { gameId } = await w.gameEnding(new Date(NOW.getTime() - DAY));
      await db
        .update(game)
        .set({ status: "final", scoreA: 1, scoreB: 0, finalizedAt: NOW })
        .where(eq(game.id, gameId));
      // An older account: news is on by default. Sub requests are on by
      // email but not push, so that card is still offered first.
      expect(
        await alertCardFor(db, p.userId, { now: NOW, pushReady: false }),
      ).toBeNull();
    });
  });
});

/** A league-wide or one-team announcement for `userId`, queued now. */
async function announce(
  db: Db,
  w: Awaited<ReturnType<typeof messagingWorld>>,
  userId: UserId,
  key: string,
  teamSeasonId: (typeof w)["aces"]["id"] | null,
): Promise<string> {
  const [a] = await db
    .insert(announcement)
    .values({
      seasonId: w.season.id,
      teamSeasonId,
      subject: "Sample news",
      body: "Sample body.",
      recipientCount: 1,
      sentAt: NOW,
    })
    .returning({ id: announcement.id });
  if (!a) throw new Error("announcement");
  const dedupeKey = `alert-choices/${key}/${w.tag}`;
  const m: OutboxMessage = {
    userId,
    topic: "announcement",
    template: "announcement",
    payload: {
      subject: "Sample news",
      body: "Sample body.",
      from: "League admins",
      seasonName: "Fall",
      seasonSlug: "fall",
    },
    dedupeKey,
    sendAfter: NOW,
    announcementId: a.id,
  };
  await enqueueMessages(db, [m]);
  return dedupeKey;
}

describe("turning down instead of off", () => {
  it("only my team: skips league-wide news, keeps the team's", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const p = w.aces.players[0];
      if (!p) throw new Error("player");
      await turnDown(db, p.userId, "team", {
        topic: "announcement",
        now: NOW,
        timeZone: NY,
      });
      const league = await announce(db, w, p.userId, "league", null);
      const team = await announce(db, w, p.userId, "team", w.aces.id);
      await sentTo(db, p.email);
      expect(await statusOf(db, league)).toEqual({
        status: "suppressed",
        reason: "team_only",
      });
      expect((await statusOf(db, team))?.status).toBe("sent");
    });
  });

  it("weekly from a news email holds news for Sunday's roundup", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const p = w.aces.players[0];
      if (!p) throw new Error("player");
      await turnDown(db, p.userId, "weekly", {
        topic: "announcement",
        now: NOW,
        timeZone: NY,
      });
      expect((await turnDownsOf(db, p.userId)).weeklyNews).toBe(true);
      const key = await announce(db, w, p.userId, "weekly", null);
      expect(await sentTo(db, p.email)).toHaveLength(0);
      const [held] = await db
        .select({ status: message.status, sendAfter: message.sendAfter })
        .from(message)
        .where(eq(message.dedupeKey, key));
      // Sunday, September 20, 6 pm in New York.
      expect(held).toEqual({
        status: "held",
        sendAfter: new Date("2026-09-20T22:00:00Z"),
      });
    });
  });

  it("weekly from any other email makes everything that can wait weekly", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const p = w.aces.players[0];
      if (!p) throw new Error("player");
      await turnDown(db, p.userId, "weekly", {
        topic: "score",
        now: NOW,
        timeZone: NY,
      });
      const [row] = await db
        .select({ cap: alertSetting.dailyCap, digest: alertSetting.digest })
        .from(alertSetting)
        .where(eq(alertSetting.userId, p.userId));
      expect(row).toEqual({ cap: 0, digest: "weekly" });
    });
  });

  it("snooze holds what can wait, sends what can't, and can end early", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const p = w.aces.players[0];
      if (!p) throw new Error("player");
      await turnDown(db, p.userId, "snooze", {
        topic: "announcement",
        now: NOW,
        timeZone: NY,
      });
      expect((await turnDownsOf(db, p.userId)).snoozedUntil).toEqual(
        new Date(NOW.getTime() + 14 * DAY),
      );
      const news = await announce(db, w, p.userId, "snoozed", null);
      await enqueueMessages(db, [
        {
          userId: p.userId,
          topic: "rainout",
          template: "rainout_notice",
          payload: {
            was: "Sun, Sep 13, 7:00 PM, Field 2",
            teams: "Aces vs Bees",
            makeup: "Sun, Sep 20, 7:00 PM, Field 2",
            seasonName: "Fall",
            seasonSlug: "fall",
          },
          dedupeKey: `alert-choices/rain/${w.tag}`,
          sendAfter: NOW,
        },
      ]);
      const mine = await sentTo(db, p.email);
      expect(mine.map((e) => e.subject)).toEqual([
        expect.stringContaining("Rain"),
      ]);
      const [held] = await db
        .select({ status: message.status, sendAfter: message.sendAfter })
        .from(message)
        .where(eq(message.dedupeKey, news));
      // The first daily digest after the snooze: Monday, September 28.
      expect(held).toEqual({
        status: "held",
        sendAfter: new Date("2026-09-28T22:00:00Z"),
      });
      await snoozeAlerts(db, p.userId, { now: NOW, timeZone: NY, end: true });
      expect((await turnDownsOf(db, p.userId)).snoozedUntil).toBeNull();
      const [back] = await db
        .select({ sendAfter: message.sendAfter })
        .from(message)
        .where(eq(message.dedupeKey, news));
      expect(back?.sendAfter).toEqual(new Date("2026-09-14T22:00:00Z"));
    });
  });

  it("keeps the person's other limits when turning down", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const p = w.aces.players[0];
      if (!p) throw new Error("player");
      await db
        .insert(alertSetting)
        .values({ userId: p.userId, dailyCap: 1, quietStartHour: 21 });
      await turnDown(db, p.userId, "team", {
        topic: "announcement",
        now: NOW,
        timeZone: NY,
      });
      const [row] = await db
        .select({
          cap: alertSetting.dailyCap,
          quiet: alertSetting.quietStartHour,
          teamOnly: alertSetting.teamOnly,
        })
        .from(alertSetting)
        .where(eq(alertSetting.userId, p.userId));
      expect(row).toEqual({ cap: 1, quiet: 21, teamOnly: true });
    });
  });
});

describe("alertChoiceCounts", () => {
  it("counts per topic for the league's members, and nobody by name", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const [a, b, c] = [w.aces.captain, ...w.aces.players];
      if (!a || !b || !c) throw new Error("players");
      for (const p of [a, b, c])
        await db
          .insert(leagueMember)
          .values({ leagueId: w.leagueId, userId: p.userId })
          .onConflictDoNothing();
      // a: news off from an email link; b: said no to the roundup card,
      // snoozed; c: turned rain-out push on from a card, only my team.
      await turnOffEmailTopic(db, a.userId, "announcement");
      // Saving the settings again keeps it counted as an unsubscribe.
      await saveEmailSettings(db, a.userId, new Set(["rainout", "payment"]));
      await answerAlertCard(db, b.userId, "first_game", "no", { now: NOW });
      await snoozeAlerts(db, b.userId, { now: NOW, timeZone: NY });
      await answerAlertCard(db, c.userId, "first_rsvp", "yes", { now: NOW });
      await turnDown(db, c.userId, "team", {
        topic: "announcement",
        now: NOW,
        timeZone: NY,
      });
      const counts = await alertChoiceCounts(db, w.leagueId, NOW);
      const topic = (t: string) => counts.topics.find((x) => x.topic === t);
      expect(counts.members).toBe(3);
      expect(topic("announcement")).toMatchObject({
        email: 2,
        turnedDown: 1,
        unsubscribed: 1,
      });
      expect(topic("rainout")).toMatchObject({ email: 3, push: 1 });
      expect(counts).toMatchObject({ snoozed: 1, teamOnly: 1, weeklyNews: 0 });
      expect(JSON.stringify(counts)).not.toContain(a.userId);
    });
  });
});
