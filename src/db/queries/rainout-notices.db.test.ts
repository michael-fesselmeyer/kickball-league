import { and, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { ScheduleVersionId, SlotId, UserId } from "@/domain/ids";
import { ok } from "@/domain/result";
import { diffSchedules } from "@/domain/scheduler/diff";
import { generate } from "@/domain/scheduler/generate";
import { reschedule } from "@/domain/scheduler/reschedule";
import { rendererFor } from "@/emails/templates";
import type { Email, EmailSender } from "@/services/email";
import { field, slot, venue } from "../schema/game";
import { message, notificationPreference } from "../schema/message";
import { messagingWorld } from "../test/messaging-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import { drainOutbox } from "./outbox";
import { queueRainoutNotices } from "./rainout-notices";
import { required } from "./rows";
import {
  type Db,
  loadSchedulerInput,
  loadVersion,
  publishVersion,
  saveVersion,
} from "./schedule";

afterAll(closePool);

const NOW = new Date("2026-09-01T12:00:00Z");

/**
 * Five teams (so one has a bye each round) on one field, three times on
 * three Sundays, with a published two-round schedule.
 */
async function rainyWorld(db: Db) {
  const w = await messagingWorld(db);
  const others = [];
  for (const name of ["Cats", "Dogs", "Eels"]) {
    const id = await w.entry(name);
    const p = await w.person(name.toLowerCase());
    await w.join(id, p, "captain");
    others.push({ id, name, players: [p] });
  }
  const teams = [
    {
      id: w.aces.id,
      name: "Aces",
      players: [w.aces.captain, ...w.aces.players],
    },
    {
      id: w.bees.id,
      name: "Bees",
      players: [w.bees.captain, ...w.bees.players],
    },
    ...others,
  ];
  const vn = required(
    (
      await db
        .insert(venue)
        .values({ leagueId: w.leagueId, name: "Grounds", slug: "grounds" })
        .returning({ id: venue.id })
    )[0],
    "venue",
  );
  const fd = required(
    (
      await db
        .insert(field)
        .values({ venueId: vn.id, name: "Field 1" })
        .returning({ id: field.id })
    )[0],
    "field",
  );
  // 6:00, 7:00 and 8:00 PM New York time (EDT, UTC-4).
  await db.insert(slot).values(
    ["2026-09-06", "2026-09-13", "2026-09-20"].flatMap((date) =>
      ["22:00", "23:00", "24:00"].map((time, timeIndex) => {
        const startsAt =
          time === "24:00"
            ? new Date(new Date(`${date}T00:00:00Z`).getTime() + 86_400_000)
            : new Date(`${date}T${time}:00Z`);
        return {
          seasonId: w.season.id,
          fieldId: fd.id,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 55 * 60_000),
          timeIndex,
        };
      }),
    ),
  );
  const loaded = await loadSchedulerInput(db, w.season.id, {
    rounds: 2,
    reservePerDay: 1,
    seed: 3,
  });
  if (!loaded.ok) throw new Error(loaded.error);
  const v1 = await saveVersion(db, {
    seasonId: w.season.id,
    input: loaded.value,
    schedule: generate(loaded.value),
    origin: "generated",
  });
  const first = await publishVersion(db, v1, w.aces.captain.userId, NOW);
  if (!first.ok) throw new Error(first.error);
  expect(first.value.notified).toBe(0);
  return { ...w, teams, v1, fieldId: fd.id };
}

/** What the rain-out screen does: cancel the date's slots and save the makeups as a draft. */
async function rainOut(db: Db, from: ScheduleVersionId, date: string) {
  const version = required(await loadVersion(db, from), "version");
  const cancelled = version.input.slots
    .filter((s) => s.date === date)
    .map((s) => s.id);
  const result = reschedule(version.input, version.schedule, cancelled);
  await db
    .update(slot)
    .set({ status: "cancelled" })
    .where(inArray(slot.id, cancelled as SlotId[]));
  const draft = await saveVersion(db, {
    seasonId: version.seasonId,
    input: {
      ...version.input,
      slots: version.input.slots.filter((s) => !cancelled.includes(s.id)),
      locked: result.locked,
    },
    schedule: result.schedule,
    origin: "rainout",
    parentVersionId: version.id,
  });
  return { draft, result, version };
}

/** Every rain-out message queued for these people. */
const noticesFor = (db: Db, people: readonly UserId[]) =>
  db
    .select()
    .from(message)
    .where(
      and(eq(message.topic, "rainout"), inArray(message.userId, [...people])),
    );

/** A sender that records what it was asked to send. */
function recorder() {
  const sent: Email[] = [];
  const send: EmailSender = async (email) => {
    sent.push(email);
    return ok({ id: `provider-${sent.length}` });
  };
  return { sent, send };
}

describe("publishing a rain-out", () => {
  it("tells each player on a moved game its makeup, and nobody else", () =>
    inRolledBackDb(async (db) => {
      const w = await rainyWorld(db);
      const rostered = w.teams.flatMap((t) => t.players.map((p) => p.userId));
      const everyone = [...rostered, w.freeAgent.userId, w.cancelled.userId];
      const { draft } = await rainOut(db, w.v1, "2026-09-06");
      const published = await publishVersion(
        db,
        draft,
        w.aces.captain.userId,
        NOW,
      );
      if (!published.ok) throw new Error(published.error);

      const after = required(await loadVersion(db, draft), "draft");
      const moved = published.value.moved.map((m) =>
        required(
          after.schedule.games.find((g) => g.key === m.gameKey),
          "moved game",
        ),
      );
      expect(moved.length).toBeGreaterThan(0);
      const playersOf = (teamId: string) =>
        required(
          w.teams.find((t) => t.id === teamId),
          "team",
        ).players.map((p) => p.userId);
      const expected = moved.flatMap((g) =>
        [...playersOf(g.teamA), ...playersOf(g.teamB)].map(
          (userId) => `${g.teamA}/${g.teamB}/${userId}`,
        ),
      );

      const rows = await noticesFor(db, everyone);
      expect(published.value.notified).toBe(expected.length);
      expect(rows).toHaveLength(expected.length);
      // One per player per moved game; the team with the bye, the free agent
      // and the cancelled registration hear nothing.
      const name = (id: string) =>
        required(
          w.teams.find((t) => t.id === id),
          "team",
        ).name;
      expect(
        rows
          .map((r) => {
            const g = required(
              moved.find(
                (m) =>
                  r.payload.teams === `${name(m.teamA)} vs ${name(m.teamB)}`,
              ),
              "game in the notice",
            );
            return `${g.teamA}/${g.teamB}/${r.userId}`;
          })
          .sort(),
      ).toEqual(expected.sort());
      expect(rostered.some((u) => !rows.some((r) => r.userId === u))).toBe(
        true,
      );
      for (const r of rows) {
        expect(r).toMatchObject({
          template: "rainout_notice",
          status: "queued",
          sendAfter: NOW,
        });
        expect(r.payload.seasonName).toBe(w.season.name);
        expect(r.payload.was).toMatch(/^Sun, Sep 6, [678]:00 PM, Field 1$/);
        expect(r.payload.makeup).toMatch(
          /^Sun, Sep (13|20), [678]:00 PM, Field 1$/,
        );
      }
    }));

  it("never sends twice when it is confirmed again or retried", () =>
    inRolledBackDb(async (db) => {
      const w = await rainyWorld(db);
      const everyone = w.teams.flatMap((t) => t.players.map((p) => p.userId));
      // The admin confirms the same rain-out twice before publishing.
      const first = await rainOut(db, w.v1, "2026-09-06");
      const second = await rainOut(db, w.v1, "2026-09-06");

      const published = await publishVersion(
        db,
        first.draft,
        w.aces.captain.userId,
        NOW,
      );
      if (!published.ok) throw new Error(published.error);
      const sent = published.value.notified;
      expect(sent).toBeGreaterThan(0);

      // Publishing the same version again is refused before anything is written.
      expect(
        await publishVersion(db, first.draft, w.aces.captain.userId, NOW),
      ).toEqual({
        ok: false,
        error: "not_draft",
      });
      // The duplicate draft moves nothing further, so it sends nothing.
      const again = await publishVersion(
        db,
        second.draft,
        w.aces.captain.userId,
        NOW,
      );
      expect(again.ok && again.value.notified).toBe(0);
      // Writing the same notices again, as a retried request would, adds none.
      const v1 = required(await loadVersion(db, w.v1), "v1");
      const d1 = required(await loadVersion(db, first.draft), "draft");
      expect(
        await queueRainoutNotices(
          db,
          w.season.id,
          diffSchedules(v1.schedule, d1.schedule).moved,
          NOW,
        ),
      ).toBe(0);
      expect(await noticesFor(db, everyone)).toHaveLength(sent);
    }));

  it("says nothing about a game that moved out of an open slot", () =>
    inRolledBackDb(async (db) => {
      const w = await rainyWorld(db);
      const v1 = required(await loadVersion(db, w.v1), "v1");
      const [placed] = v1.schedule.games.filter((g) => g.slotId !== null);
      const free = v1.input.slots.find(
        (s) => !v1.schedule.games.some((g) => g.slotId === s.id),
      );
      expect(
        await queueRainoutNotices(
          db,
          w.season.id,
          [
            {
              gameKey: required(placed, "game").key,
              from: required(placed, "game").slotId,
              to: required(free, "free slot").id,
            },
          ],
          NOW,
        ),
      ).toBe(0);
    }));

  it("leaves out players who turned rain-out emails off", () =>
    inRolledBackDb(async (db) => {
      const w = await rainyWorld(db);
      const everyone = w.teams.flatMap((t) => t.players.map((p) => p.userId));
      const { draft } = await rainOut(db, w.v1, "2026-09-06");
      const published = await publishVersion(
        db,
        draft,
        w.aces.captain.userId,
        NOW,
      );
      if (!published.ok) throw new Error(published.error);
      const rows = await noticesFor(db, everyone);
      const muted = required(rows[0], "a notice").userId;
      await db.insert(notificationPreference).values({
        userId: muted,
        topic: "rainout",
        channel: "email",
        enabled: false,
      });

      const { sent, send } = recorder();
      await drainOutbox(db, {
        send,
        render: rendererFor({ siteUrl: "https://league.example.test" }),
        now: NOW,
        limit: 500,
      });
      const after = await noticesFor(db, everyone);
      for (const r of after)
        expect(r.status).toBe(r.userId === muted ? "suppressed" : "sent");
      expect(sent.length).toBe(after.filter((r) => r.status === "sent").length);
      expect(sent[0]?.subject).toMatch(
        /^Rained out: .+ vs .+ moves to Sun, Sep/,
      );
    }));
});
