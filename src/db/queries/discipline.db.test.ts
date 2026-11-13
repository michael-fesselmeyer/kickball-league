import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { can } from "@/domain/authz/permissions";
import {
  type IncidentKind,
  suggestedLength,
} from "@/domain/discipline/discipline";
import type { GameId, IncidentId, UserId } from "@/domain/ids";
import { err, ok } from "@/domain/result";
import { auditLog } from "../schema/audit";
import {
  incident,
  incidentNote,
  incidentPerson,
  sportsmanshipRating,
  suspension,
} from "../schema/discipline";
import { game } from "../schema/game";
import { message } from "../schema/message";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { messagingWorld } from "../test/messaging-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import { deleteAccount, personalData } from "./account";
import {
  addIncidentNote,
  activeSuspensions,
  earlierAlcoholSuspensions,
  fileIncident,
  gamePeople,
  incidentDetail,
  incidentQueue,
  isSuspended,
  liftSuspension,
  rateGame,
  scoresReceived,
  seasonSportsmanship,
  setIncidentStatus,
  suspendedAmong,
  suspendPlayer,
} from "./discipline";
import { placeFreeAgent } from "./registrations-admin";
import { setRsvp } from "./rsvps";
import type { Db } from "./schedule";
import { claimSubSpot, postSubRequest } from "./subs";
import { loadSubject } from "./subject";

afterAll(closePool);

const NOW = new Date("2026-09-15T16:00:00Z");
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000);
const days = (n: number) => hours(24 * n);

/**
 * The messaging world with profiles, a ref and an admin, and Aces vs Bees
 * that ended two hours ago, reffed by the ref.
 */
async function world(db: Db) {
  const w = await messagingWorld(db);
  const ref = await w.person("ref");
  const admin = await w.person("admin");
  const everyone = [
    w.aces.captain,
    ...w.aces.players,
    w.bees.captain,
    ...w.bees.players,
    w.freeAgent,
    ref,
    admin,
  ];
  await db.insert(profile).values(
    everyone.map((p, i) => ({
      userId: p.userId,
      firstName: `Pat${i}`,
      lastName: "Example",
      globalRole: p === admin ? ("admin" as const) : ("player" as const),
    })),
  );
  const played = await w.gameEnding(hours(-2), ref.userId);
  const finish = (gameId: GameId, at: Date) =>
    db
      .update(game)
      .set({ status: "final", scoreA: 5, scoreB: 3, finalizedAt: at })
      .where(eq(game.id, gameId));
  const file = (
    kind: IncidentKind,
    people: UserId[],
    gameId: GameId = played.gameId,
    now = NOW,
  ) =>
    fileIncident(db, {
      gameId,
      reportedBy: ref.userId,
      role: "referee",
      incident: { kind, details: "What the ref saw.", people },
      now,
    });
  return { ...w, ref, admin, played, finish, file };
}

const filed = (r: { ok: true; value: IncidentId } | { ok: false }) => {
  if (!r.ok) throw new Error("Expected the report to be filed");
  return r.value;
};

describe("who may report and rate (database subjects)", () => {
  it("lets the game's ref, both captains and admins report; only captains rate", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const other = await w.gameEnding(hours(-30));
      const ctx = (gameId: GameId) => ({
        game: { id: gameId, teamSeasonIds: [w.aces.id, w.bees.id] as const },
      });
      const subject = (p: { userId: UserId }) => loadSubject(db, p.userId);
      for (const [who, logs, rates] of [
        [w.ref, true, false],
        [w.aces.captain, true, true],
        [w.bees.captain, true, true],
        [w.aces.players[0]!, false, false],
        [w.admin, true, false],
        [w.freeAgent, false, false],
      ] as const) {
        const s = await subject(who);
        expect(can(s, "incident.log", ctx(w.played.gameId))).toBe(logs);
        expect(can(s, "sportsmanship.rate", ctx(w.played.gameId))).toBe(rates);
      }
      // The ref is assigned to the first game only.
      expect(can(await subject(w.ref), "incident.log", ctx(other.gameId))).toBe(
        false,
      );
      expect(can(await subject(w.admin), "player.suspend")).toBe(true);
      expect(can(await subject(w.aces.captain), "player.suspend")).toBe(false);
    });
  });
});

describe("incident reports", () => {
  it("opens at kickoff, names only the two teams' players and is audited", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const later = await w.gameEnding(hours(5), w.ref.userId);
      expect(await w.file("safety", [], later.gameId)).toEqual(
        err("not_started"),
      );

      const people = await gamePeople(db, {
        teamAId: w.aces.id,
        teamBId: w.bees.id,
      });
      expect(people).toHaveLength(6);
      const id = filed(
        await w.file("ejection", [
          w.bees.players[0]!.userId,
          w.freeAgent.userId,
        ]),
      );
      const named = await db
        .select()
        .from(incidentPerson)
        .where(eq(incidentPerson.incidentId, id));
      expect(named).toEqual([
        {
          incidentId: id,
          userId: w.bees.players[0]!.userId,
          teamSeasonId: w.bees.id,
        },
      ]);
      const [audit] = await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.entityId, id));
      expect(audit).toMatchObject({
        action: "incident.file",
        actorId: w.ref.userId,
        after: { kind: "ejection", people: 1 },
      });

      const queue = await incidentQueue(db);
      expect(queue.open.map((r) => [r.id, r.people, r.matchup])).toContainEqual(
        [id, 1, "Aces vs Bees"],
      );
    });
  });

  it("takes admin notes and resolves and reopens, each audited", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = filed(await w.file("unsportsmanlike", []));
      expect(
        await addIncidentNote(db, {
          incidentId: id,
          authorId: w.admin.userId,
          body: "Spoke with both captains.",
          now: NOW,
        }),
      ).toEqual(ok(undefined));
      const close = (status: "open" | "resolved") =>
        setIncidentStatus(db, {
          incidentId: id,
          actorId: w.admin.userId,
          status,
          now: hours(1),
        });
      expect(await close("open")).toEqual(err("not_resolved"));
      expect(await close("resolved")).toEqual(ok(undefined));
      expect(await close("resolved")).toEqual(err("already_resolved"));
      const detail = await incidentDetail(db, id, NOW);
      expect(detail?.status).toBe("resolved");
      expect(detail?.notes.map((n) => n.body)).toEqual([
        "Spoke with both captains.",
      ]);
      const queue = await incidentQueue(db);
      expect(queue.resolved.map((r) => r.id)).toContain(id);
      expect(queue.open.map((r) => r.id)).not.toContain(id);
      expect(await close("open")).toEqual(ok(undefined));
      const actions = (
        await db
          .select({ action: auditLog.action })
          .from(auditLog)
          .where(eq(auditLog.entityId, id))
      ).map((a) => a.action);
      expect(actions.sort()).toEqual([
        "incident.file",
        "incident.note",
        "incident.reopen",
        "incident.resolve",
      ]);
    });
  });
});

describe("suspensions", () => {
  it("suspends only people on the report, once, with one email and an audit row", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const player = w.bees.players[0]!;
      const id = filed(await w.file("ejection", [player.userId]));
      const suspend = (userId: UserId) =>
        suspendPlayer(db, {
          incidentId: id,
          userId,
          length: { scope: "games", games: 2 },
          actorId: w.admin.userId,
          now: NOW,
        });
      expect(await suspend(w.aces.captain.userId)).toEqual(err("not_involved"));
      const done = await suspend(player.userId);
      expect(done.ok).toBe(true);
      expect(await suspend(player.userId)).toEqual(err("already_suspended"));

      const sent = await db
        .select()
        .from(message)
        .where(eq(message.userId, player.userId));
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        topic: "discipline",
        template: "suspension",
        payload: { length: "2 games", scope: "games", seasonName: "Fall 2026" },
      });
      expect(JSON.stringify(sent[0]?.payload)).not.toContain("ref");
      const [audit] = await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, "suspension.issue"));
      expect(audit).toMatchObject({
        actorId: w.admin.userId,
        after: { scope: "games", games: 2 },
      });
    });
  });

  it("suggests the outside-alcohol ladder from history: 1 game, the season, then for good", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const player = w.aces.players[0]!;
      const step = async (length: Parameters<typeof suggestedLength>[0]) => {
        const id = filed(await w.file(length, [player.userId]));
        const earlier = await earlierAlcoholSuspensions(db, player.userId, id);
        return { id, suggested: suggestedLength(length, earlier) };
      };
      const issue = (id: IncidentId, scope: "games" | "season" | "permanent") =>
        suspendPlayer(db, {
          incidentId: id,
          userId: player.userId,
          length: scope === "games" ? { scope, games: 1 } : { scope },
          actorId: w.admin.userId,
          now: NOW,
        });

      const first = await step("outside_alcohol");
      expect(first.suggested).toEqual({ scope: "games", games: 1 });
      // Another kind of incident doesn't count toward the ladder.
      const fight = await step("unsportsmanlike");
      expect(fight.suggested).toBeNull();
      await issue(fight.id, "games");
      expect((await step("outside_alcohol")).suggested).toEqual({
        scope: "games",
        games: 1,
      });

      await issue(first.id, "games");
      const second = await step("outside_alcohol");
      expect(second.suggested).toEqual({ scope: "season" });
      // Deciding the same report again doesn't count itself.
      await issue(second.id, "season");
      expect(
        await earlierAlcoholSuspensions(db, player.userId, second.id),
      ).toBe(1);
      const third = await step("outside_alcohol");
      expect(third.suggested).toEqual({ scope: "permanent" });

      // A lifted suspension (a won appeal) drops off the ladder.
      const [lifted] = await db
        .select({ id: suspension.id })
        .from(suspension)
        .where(eq(suspension.incidentId, second.id));
      await liftSuspension(db, {
        suspensionId: lifted!.id,
        actorId: w.admin.userId,
        now: NOW,
      });
      expect(await earlierAlcoholSuspensions(db, player.userId, third.id)).toBe(
        1,
      );
    });
  });

  it("counts games served as the team's games go final, then frees the player", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const player = w.bees.players[0]!;
      // Kicked off before the suspension, finalized after: doesn't count.
      const before = await w.gameEnding(hours(-1));
      const next = await w.gameEnding(days(7));
      const after = await w.gameEnding(days(14));
      const id = filed(await w.file("ejection", [player.userId]));
      const issued = await suspendPlayer(db, {
        incidentId: id,
        userId: player.userId,
        length: { scope: "games", games: 2 },
        actorId: w.admin.userId,
        now: NOW,
      });
      if (!issued.ok) throw new Error(issued.error);
      const left = async (at: Date) =>
        (await suspendedAmong(db, [player.userId], at)).get(player.userId);

      await w.finish(before.gameId, hours(1));
      expect(await left(hours(2))).toMatchObject({
        gamesLeft: 2,
        label: "Suspended, 2 more games",
      });
      const rsvp = (status: "in" | "out", gameId: GameId, at: Date) =>
        setRsvp(
          db,
          { gameId, userId: player.userId, teamSeasonId: w.bees.id, status },
          at,
        );
      expect(await rsvp("in", next.gameId, hours(2))).toEqual(err("suspended"));
      expect(await rsvp("out", next.gameId, hours(2))).toEqual(ok(undefined));

      await w.finish(next.gameId, days(7));
      expect(await left(days(8))).toMatchObject({
        gamesLeft: 1,
        label: "Suspended, 1 more game",
      });
      // A cancelled game doesn't count.
      await db
        .update(game)
        .set({ status: "cancelled" })
        .where(eq(game.id, after.gameId));
      expect((await left(days(15)))?.gamesLeft).toBe(1);
      await db
        .update(game)
        .set({ status: "scheduled" })
        .where(eq(game.id, after.gameId));
      await w.finish(after.gameId, days(14));
      expect(await left(days(15))).toBeUndefined();
      expect(await isSuspended(db, player.userId, days(15))).toBe(false);
      expect(await activeSuspensions(db, days(15))).toEqual([]);
    });
  });

  it("holds a season suspension until the season ends, and a lift ends any", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const player = w.aces.players[0]!;
      const next = await w.gameEnding(days(7));
      const id = filed(await w.file("outside_alcohol", [player.userId]));
      const issued = await suspendPlayer(db, {
        incidentId: id,
        userId: player.userId,
        length: { scope: "season" },
        actorId: w.admin.userId,
        now: NOW,
      });
      if (!issued.ok) throw new Error(issued.error);
      await w.finish(next.gameId, days(7));
      expect(await isSuspended(db, player.userId, days(8))).toBe(true);
      expect(
        (await activeSuspensions(db, days(8))).map((s) => s.userId),
      ).toEqual([player.userId]);
      // The season's last day is Nov 1.
      expect(
        await isSuspended(db, player.userId, new Date("2026-11-02T16:00:00Z")),
      ).toBe(false);
      await db
        .update(season)
        .set({ status: "completed" })
        .where(eq(season.id, w.season.id));
      expect(await isSuspended(db, player.userId, days(8))).toBe(false);
      await db
        .update(season)
        .set({ status: "in_progress" })
        .where(eq(season.id, w.season.id));

      expect(
        await liftSuspension(db, {
          suspensionId: issued.value,
          actorId: w.admin.userId,
          now: days(9),
        }),
      ).toEqual(ok(id));
      expect(
        await liftSuspension(db, {
          suspensionId: issued.value,
          actorId: w.admin.userId,
          now: days(9),
        }),
      ).toEqual(err("already_lifted"));
      expect(await isSuspended(db, player.userId, days(9))).toBe(false);
      expect(
        (
          await db
            .select()
            .from(auditLog)
            .where(eq(auditLog.action, "suspension.lift"))
        ).length,
      ).toBe(1);
    });
  });

  it("keeps a suspended player from claiming a sub spot or being placed from the pool", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const fa = w.freeAgent;
      const id = filed(await w.file("safety", []));
      // A free agent who caused trouble at the bar after the game.
      await db
        .insert(incidentPerson)
        .values({ incidentId: id, userId: fa.userId });
      const issued = await suspendPlayer(db, {
        incidentId: id,
        userId: fa.userId,
        length: { scope: "permanent" },
        actorId: w.admin.userId,
        now: NOW,
      });
      if (!issued.ok) throw new Error(issued.error);

      const upcoming = await w.gameEnding(days(30));
      const posted = await postSubRequest(db, {
        gameId: upcoming.gameId,
        teamSeasonId: w.aces.id,
        requestedBy: w.aces.captain.userId,
        spots: { needed: 1, womenNeeded: 0, menNeeded: 0 },
        note: null,
        now: NOW,
      });
      if (!posted.ok) throw new Error(posted.error);
      // Nobody tells a suspended player about the request.
      expect(
        await db
          .select()
          .from(message)
          .where(
            and(
              eq(message.userId, fa.userId),
              eq(message.template, "sub_request"),
            ),
          ),
      ).toEqual([]);
      expect(
        await claimSubSpot(db, {
          requestId: posted.value.id,
          userId: fa.userId,
          now: NOW,
        }),
      ).toEqual(err("suspended"));
      expect(
        await placeFreeAgent(db, {
          seasonId: w.season.id,
          registrationId: fa.registrationId,
          teamSeasonId: w.aces.id,
          actorId: w.admin.userId,
          now: NOW,
        }),
      ).toEqual(err("suspended"));
    });
  });
});

describe("sportsmanship ratings", () => {
  it("opens after a final score, keeps one rating per team, and never audits the score", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const rate = (
        teamSeasonId: typeof w.aces.id,
        by: UserId,
        score: number,
        note: string | null = null,
      ) =>
        rateGame(db, {
          gameId: w.played.gameId,
          teamSeasonId,
          ratedBy: by,
          rating: { score, note },
          now: NOW,
        });
      expect(await rate(w.aces.id, w.aces.captain.userId, 4)).toEqual(
        err("not_final"),
      );
      await w.finish(w.played.gameId, hours(-1));
      const stranger = await w.entry("Cats");
      expect(await rate(stranger, w.aces.captain.userId, 4)).toEqual(
        err("not_in_game"),
      );
      expect(await rate(w.aces.id, w.aces.captain.userId, 2)).toEqual(
        ok(undefined),
      );
      expect(
        await rate(w.aces.id, w.aces.captain.userId, 3, "Lots of chirping"),
      ).toEqual(ok(undefined));
      expect(await rate(w.bees.id, w.bees.captain.userId, 5)).toEqual(
        ok(undefined),
      );
      const rows = await db
        .select()
        .from(sportsmanshipRating)
        .where(eq(sportsmanshipRating.gameId, w.played.gameId));
      expect(rows).toHaveLength(2);
      expect(await scoresReceived(db, w.bees.id)).toEqual([3]);

      const audits = await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, "sportsmanship.rate"));
      expect(audits).toHaveLength(3);
      for (const a of audits) {
        expect(a.after).toBeNull();
        expect(a.entityId).toBe(w.played.gameId);
      }

      const season = await seasonSportsmanship(db, w.season.id);
      expect(season.find((t) => t.name === "Bees")).toMatchObject({
        scores: [3],
        notes: ["Lots of chirping"],
      });
      expect(season.find((t) => t.name === "Aces")).toMatchObject({
        scores: [5],
        notes: [],
      });
    });
  });
});

describe("personal data", () => {
  it("exports the person's records, and deletion keeps them but removes their notes", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const player = w.aces.players[0]!;
      const id = filed(await w.file("forfeit_related", [player.userId]));
      await suspendPlayer(db, {
        incidentId: id,
        userId: player.userId,
        length: { scope: "games", games: 1 },
        actorId: w.admin.userId,
        now: NOW,
      });
      await addIncidentNote(db, {
        incidentId: id,
        authorId: player.userId,
        body: "A note this person wrote while they were an admin.",
        now: NOW,
      });
      await w.finish(w.played.gameId, hours(-1));
      await rateGame(db, {
        gameId: w.played.gameId,
        teamSeasonId: w.aces.id,
        ratedBy: player.userId,
        rating: { score: 4, note: "Friendly team" },
        now: NOW,
      });

      const data = await personalData(db, player.userId, NOW);
      expect(data?.discipline.incidentsAboutYou).toEqual([
        expect.objectContaining({ kind: "forfeit_related", status: "open" }),
      ]);
      expect(data?.discipline.suspensions).toEqual([
        expect.objectContaining({ length: "1 game", status: "active" }),
      ]);
      expect(data?.discipline.sportsmanshipRatingsYouGave).toEqual([
        expect.objectContaining({ score: 4, note: "Friendly team" }),
      ]);
      const ref = await personalData(db, w.ref.userId, NOW);
      expect(ref?.discipline.incidentsYouReported).toHaveLength(1);

      expect(await deleteAccount(db, player.userId, NOW)).toEqual(
        ok(undefined),
      );
      expect(
        await db
          .select()
          .from(incidentNote)
          .where(eq(incidentNote.incidentId, id)),
      ).toEqual([]);
      const [rating] = await db
        .select()
        .from(sportsmanshipRating)
        .where(eq(sportsmanshipRating.ratedBy, player.userId));
      expect(rating).toMatchObject({ score: 4, note: null });
      expect(
        await db.select().from(incident).where(eq(incident.id, id)),
      ).toHaveLength(1);
      expect(
        await db
          .select()
          .from(suspension)
          .where(eq(suspension.userId, player.userId)),
      ).toHaveLength(1);
      expect(
        await db
          .select()
          .from(incidentPerson)
          .where(eq(incidentPerson.userId, player.userId)),
      ).toHaveLength(1);
    });
  });
});
