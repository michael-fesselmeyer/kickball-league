import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { STARTER_TEMPLATE } from "@/domain/checklist/tasks";
import type { UserId } from "@/domain/ids";
import { auditLog } from "../schema/audit";
import { user } from "../schema/auth";
import { checklistTask } from "../schema/checklist";
import { league, leagueMember } from "../schema/league";
import { message } from "../schema/message";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { closePool, inRolledBackDb } from "../test/transaction";
import {
  addTask,
  addTemplateTask,
  checklistStaff,
  deleteTask,
  deleteTemplateTask,
  ensureTemplate,
  nextTasks,
  queueChecklistReminders,
  seasonChecklist,
  setTaskDone,
  shiftChecklistForNewStart,
  startSeasonChecklist,
  templateTasks,
  updateTask,
} from "./checklist";
import type { Db } from "./schedule";

afterAll(closePool);

async function world(db: Db) {
  const tag = Math.random().toString(36).slice(2, 8);
  const [lg] = await db
    .insert(league)
    .values({ name: "Checklist League", slug: `ops-${tag}` })
    .returning({ id: league.id });
  if (!lg) throw new Error("league");
  const leagueId = lg.id;
  const [sn] = await db
    .insert(season)
    .values({
      leagueId: lg.id,
      name: "Spring 2027",
      slug: `spring-${tag}`,
      startsOn: "2027-04-10",
      endsOn: "2027-06-12",
      feeModel: "per_player",
      playerFeeCents: 8500,
      rosterMin: 1,
      rosterMax: 20,
    })
    .returning({ id: season.id });
  if (!sn) throw new Error("season");
  async function person(
    name: string,
    role: "player" | "admin" | "owner",
  ): Promise<UserId> {
    const [u] = await db
      .insert(user)
      .values({ name, email: `ops-${name}-${tag}@example.test` })
      .returning({ id: user.id });
    if (!u) throw new Error("user");
    await db.insert(profile).values({ userId: u.id, firstName: name });
    // Roles are per league (ADR 0048).
    await db.insert(leagueMember).values({ leagueId, userId: u.id, role });
    return u.id;
  }
  return {
    leagueId: lg.id,
    seasonId: sn.id,
    owner: await person(`Olive${tag}`, "owner"),
    admin: await person(`Adam${tag}`, "admin"),
    player: await person(`Pat${tag}`, "player"),
  };
}

describe("the template", () => {
  it("starts with the starter tasks once, and owners change it", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await ensureTemplate(db, w.leagueId);
      await ensureTemplate(db, w.leagueId);
      const starter = await templateTasks(db, w.leagueId);
      expect(starter.map((t) => t.title)).toEqual(
        STARTER_TEMPLATE.map((t) => t.title),
      );

      const id = await addTemplateTask(db, {
        leagueId: w.leagueId,
        actorId: w.owner,
        task: {
          title: "Pick the playoff bar",
          notes: "",
          offsetDays: 49,
          ownerId: w.admin,
        },
      });
      const after = await templateTasks(db, w.leagueId);
      expect(after.find((t) => t.id === id)).toMatchObject({
        ownerId: w.admin,
        ownerName: expect.stringContaining("Adam"),
      });
      expect(
        await deleteTemplateTask(db, {
          id,
          leagueId: w.leagueId,
          actorId: w.owner,
        }),
      ).toEqual({ ok: true, value: undefined });
      expect(await templateTasks(db, w.leagueId)).toHaveLength(
        STARTER_TEMPLATE.length,
      );
    });
  });
});

describe("a season's checklist", () => {
  it("copies the template once, dated from the season's start", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const start = () =>
        startSeasonChecklist(db, {
          seasonId: w.seasonId,
          leagueId: w.leagueId,
          startsOn: "2027-04-10",
          actorId: w.admin,
        });
      expect(await start()).toBe(STARTER_TEMPLATE.length);
      expect(await start()).toBe(0);

      const tasks = await seasonChecklist(db, w.seasonId);
      expect(tasks).toHaveLength(STARTER_TEMPLATE.length);
      expect(tasks.find((t) => t.title === "Send the schedule")?.dueOn).toBe(
        "2027-04-03",
      );
      expect(tasks.map((t) => t.dueOn)).toEqual(
        tasks.map((t) => t.dueOn).sort(),
      );

      // A task the template gains later joins on the next start.
      await addTemplateTask(db, {
        leagueId: w.leagueId,
        actorId: w.owner,
        task: {
          title: "Print the bracket",
          notes: "",
          offsetDays: 50,
          ownerId: null,
        },
      });
      expect(await start()).toBe(1);
    });
  });

  it("adds, changes, ticks off and removes tasks, with an audit row each", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await addTask(db, {
        seasonId: w.seasonId,
        actorId: w.admin,
        task: {
          title: "Rent the speaker",
          notes: "",
          dueOn: "2027-04-01",
          ownerId: null,
        },
      });
      expect(
        await updateTask(db, {
          id,
          seasonId: w.seasonId,
          actorId: w.admin,
          task: {
            title: "Rent the speaker",
            notes: "From the bar",
            dueOn: "2027-04-02",
            ownerId: w.owner,
          },
        }),
      ).toEqual({ ok: true, value: undefined });
      expect(await nextTasks(db, w.seasonId)).toMatchObject([
        { id, dueOn: "2027-04-02", ownerId: w.owner, doneAt: null },
      ]);

      const now = new Date("2027-04-01T15:00:00Z");
      await setTaskDone(db, {
        id,
        seasonId: w.seasonId,
        actorId: w.admin,
        done: true,
        now,
      });
      expect(await nextTasks(db, w.seasonId)).toEqual([]);
      expect((await seasonChecklist(db, w.seasonId))[0]?.doneAt).toEqual(now);
      await setTaskDone(db, {
        id,
        seasonId: w.seasonId,
        actorId: w.admin,
        done: false,
        now,
      });
      expect(await nextTasks(db, w.seasonId)).toHaveLength(1);
      expect(
        await deleteTask(db, { id, seasonId: w.seasonId, actorId: w.admin }),
      ).toEqual({ ok: true, value: undefined });
      expect(
        await deleteTask(db, { id, seasonId: w.seasonId, actorId: w.admin }),
      ).toEqual({ ok: false, error: "not_found" });

      const audit = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.entityId, id));
      expect(audit.map((a) => a.action).sort()).toEqual([
        "checklist.add",
        "checklist.delete",
        "checklist.done",
        "checklist.reopen",
        "checklist.update",
      ]);
    });
  });

  it("lists owners and admins, never players, as task owners", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const staff = (await checklistStaff(db, w.leagueId)).map((s) => s.userId);
      expect(staff).toContain(w.owner);
      expect(staff).toContain(w.admin);
      expect(staff).not.toContain(w.player);
    });
  });
});

describe("shiftChecklistForNewStart", () => {
  it("moves open template tasks with the season's first day, nothing else", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await startSeasonChecklist(db, {
        seasonId: w.seasonId,
        leagueId: w.leagueId,
        startsOn: "2027-04-10",
        actorId: w.admin,
      });
      const before = await seasonChecklist(db, w.seasonId);
      const shirts = before.find((t) => t.title === "Order shirts");
      const permits = before.find((t) => t.title === "Renew the field permits");
      if (!shirts || !permits) throw new Error("starter tasks");
      await setTaskDone(db, {
        id: permits.id,
        seasonId: w.seasonId,
        actorId: w.admin,
        done: true,
        now: new Date(),
      });
      const own = await addTask(db, {
        seasonId: w.seasonId,
        actorId: w.admin,
        task: {
          title: "Rent the speaker",
          notes: "",
          dueOn: "2027-04-01",
          ownerId: null,
        },
      });

      // The season now starts a week later, across the clocks changing.
      expect(
        await shiftChecklistForNewStart(db, {
          seasonId: w.seasonId,
          from: "2027-04-10",
          to: "2027-04-17",
        }),
      ).toBe(before.length - 1);
      const after = await seasonChecklist(db, w.seasonId);
      const due = (id: string) => after.find((t) => t.id === id)?.dueOn;
      expect(due(shirts.id)).toBe("2027-03-27");
      expect(due(permits.id)).toBe(permits.dueOn);
      expect(due(own)).toBe("2027-04-01");
      expect(
        await shiftChecklistForNewStart(db, {
          seasonId: w.seasonId,
          from: "2027-04-17",
          to: "2027-04-17",
        }),
      ).toBe(0);
    });
  });
});

describe("queueChecklistReminders", () => {
  it("reminds the owner before the due date and once overdue, each once", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const task = (title: string, dueOn: string, ownerId: UserId | null) =>
        addTask(db, {
          seasonId: w.seasonId,
          actorId: w.admin,
          task: { title, notes: "", dueOn, ownerId },
        });
      const soon = await task("Order shirts", "2027-03-20", w.admin);
      const late = await task("Line up refs", "2027-03-15", null);
      await task("Send the schedule", "2027-04-03", w.admin);
      const done = await task("Book the bar", "2027-03-18", w.admin);
      await setTaskDone(db, {
        id: done,
        seasonId: w.seasonId,
        actorId: w.admin,
        done: true,
        now: new Date(),
      });

      const today = "2027-03-17";
      const queued = await queueChecklistReminders(db, {
        leagueId: w.leagueId,
        today,
      });
      const sent = await db
        .select({
          userId: message.userId,
          key: message.dedupeKey,
          payload: message.payload,
        })
        .from(message)
        .where(eq(message.template, "checklist_reminder"));
      const mine = sent.filter(
        (m) => m.key?.includes(soon) || m.key?.includes(late),
      );
      // The admin hears about their task; the owners about the one nobody has.
      expect(mine.find((m) => m.key?.includes(soon))).toMatchObject({
        userId: w.admin,
        payload: { kind: "soon", due: "Due in 3 days", unassigned: false },
      });
      expect(
        mine.filter((m) => m.key?.includes(late)).map((m) => m.userId),
      ).toContain(w.owner);
      expect(mine.find((m) => m.key?.includes(late))?.payload).toMatchObject({
        kind: "overdue",
        due: "2 days overdue",
        unassigned: true,
      });
      expect(queued).toBe(sent.length);

      // An owner who is no longer an admin counts as nobody.
      const gone = await addTask(db, {
        seasonId: w.seasonId,
        actorId: w.admin,
        task: {
          title: "Pay the bar deposit",
          notes: "",
          dueOn: "2027-03-19",
          ownerId: w.player,
        },
      });
      await queueChecklistReminders(db, { leagueId: w.leagueId, today });
      const toGone = await db
        .select({ userId: message.userId, payload: message.payload })
        .from(message)
        .where(eq(message.template, "checklist_reminder"));
      const forGone = toGone.filter((m) =>
        JSON.stringify(m.payload).includes("Pay the bar deposit"),
      );
      expect(forGone.map((m) => m.userId)).toContain(w.owner);
      expect(forGone.map((m) => m.userId)).not.toContain(w.player);
      expect(forGone[0]?.payload).toMatchObject({ unassigned: true });
      expect(gone).toBeTruthy();

      // The next day nothing new goes for the same tasks.
      expect(
        await queueChecklistReminders(db, {
          leagueId: w.leagueId,
          today: "2027-03-18",
        }),
      ).toBe(0);
      const rows = await db
        .select({ id: checklistTask.id })
        .from(checklistTask)
        .where(eq(checklistTask.seasonId, w.seasonId));
      expect(rows).toHaveLength(5);
    });
  });
});
