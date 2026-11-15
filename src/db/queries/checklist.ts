import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql,
} from "drizzle-orm";
import {
  dueLabel,
  dueOnFor,
  OVERDUE_REMINDER_WINDOW,
  REMIND_DAYS_BEFORE,
  reminderFor,
  STARTER_TEMPLATE,
  type TaskInput,
  type TemplateInput,
} from "@/domain/checklist/tasks";
import type {
  ChecklistTaskId,
  ChecklistTemplateTaskId,
  LeagueId,
  SeasonId,
  UserId,
} from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import { addDays, daysBetween } from "@/domain/season/rollover";
import { user } from "../schema/auth";
import { checklistTask, checklistTemplateTask } from "../schema/checklist";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { recordAudit } from "./audit";
import { enqueueMessages, type OutboxMessage } from "./outbox";
import type { Db } from "./schedule";

/**
 * The season ops checklist (ADR 0053, src/domain/checklist/tasks.ts): the
 * league's template, each season's tasks, the dashboard's next few and the
 * daily reminders to each task's owner.
 */

const personName = sql<string>`coalesce(nullif(trim(concat_ws(' ', ${profile.firstName}, ${profile.lastName})), ''), nullif(${user.name}, ''), 'A member')`;

export type StaffMember = { userId: UserId; name: string };

/** The league's owners and admins: who can own a task. */
export async function checklistStaff(db: Db): Promise<StaffMember[]> {
  return db
    .select({ userId: profile.userId, name: personName })
    .from(profile)
    .innerJoin(user, eq(user.id, profile.userId))
    .where(inArray(profile.globalRole, ["admin", "owner"]))
    .orderBy(asc(personName));
}

// The template

export type TemplateRow = {
  id: ChecklistTemplateTaskId;
  title: string;
  notes: string;
  offsetDays: number;
  ownerId: UserId | null;
  ownerName: string | null;
};

/**
 * Gives the league the starter tasks when its template is empty, so there
 * is always something to start a season from. Locks on the league, so two
 * first visits at once add them once.
 */
export async function ensureTemplate(
  db: Db,
  leagueId: LeagueId,
): Promise<void> {
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`checklist_template:${leagueId}`}))`,
  );
  const [any] = await db
    .select({ id: checklistTemplateTask.id })
    .from(checklistTemplateTask)
    .where(eq(checklistTemplateTask.leagueId, leagueId))
    .limit(1);
  if (any) return;
  await db
    .insert(checklistTemplateTask)
    .values(STARTER_TEMPLATE.map((t) => ({ ...t, leagueId })));
}

export async function templateTasks(
  db: Db,
  leagueId: LeagueId,
): Promise<TemplateRow[]> {
  return db
    .select({
      id: checklistTemplateTask.id,
      title: checklistTemplateTask.title,
      notes: checklistTemplateTask.notes,
      offsetDays: checklistTemplateTask.offsetDays,
      ownerId: checklistTemplateTask.ownerId,
      ownerName: sql<
        string | null
      >`case when ${user.id} is null then null else ${personName} end`,
    })
    .from(checklistTemplateTask)
    .leftJoin(user, eq(user.id, checklistTemplateTask.ownerId))
    .leftJoin(profile, eq(profile.userId, checklistTemplateTask.ownerId))
    .where(eq(checklistTemplateTask.leagueId, leagueId))
    .orderBy(
      asc(checklistTemplateTask.offsetDays),
      asc(checklistTemplateTask.title),
    );
}

export async function addTemplateTask(
  db: Db,
  input: { leagueId: LeagueId; actorId: UserId; task: TemplateInput },
): Promise<ChecklistTemplateTaskId> {
  const [row] = await db
    .insert(checklistTemplateTask)
    .values({ ...input.task, leagueId: input.leagueId })
    .returning({ id: checklistTemplateTask.id });
  if (!row) throw new Error("Insert returned no template task");
  await recordAudit(db, {
    actorId: input.actorId,
    action: "checklist_template.add",
    entityType: "checklist_template_task",
    entityId: row.id,
    after: input.task,
  });
  return row.id;
}

export async function updateTemplateTask(
  db: Db,
  input: {
    id: ChecklistTemplateTaskId;
    leagueId: LeagueId;
    actorId: UserId;
    task: TemplateInput;
  },
): Promise<Result<undefined, "not_found">> {
  const [row] = await db
    .update(checklistTemplateTask)
    .set(input.task)
    .where(
      and(
        eq(checklistTemplateTask.id, input.id),
        eq(checklistTemplateTask.leagueId, input.leagueId),
      ),
    )
    .returning({ id: checklistTemplateTask.id });
  if (!row) return err("not_found");
  await recordAudit(db, {
    actorId: input.actorId,
    action: "checklist_template.update",
    entityType: "checklist_template_task",
    entityId: row.id,
    after: input.task,
  });
  return ok(undefined);
}

/** Removes a template task. Seasons already started keep their copy. */
export async function deleteTemplateTask(
  db: Db,
  input: { id: ChecklistTemplateTaskId; leagueId: LeagueId; actorId: UserId },
): Promise<Result<undefined, "not_found">> {
  const [row] = await db
    .delete(checklistTemplateTask)
    .where(
      and(
        eq(checklistTemplateTask.id, input.id),
        eq(checklistTemplateTask.leagueId, input.leagueId),
      ),
    )
    .returning({
      id: checklistTemplateTask.id,
      title: checklistTemplateTask.title,
    });
  if (!row) return err("not_found");
  await recordAudit(db, {
    actorId: input.actorId,
    action: "checklist_template.delete",
    entityType: "checklist_template_task",
    entityId: row.id,
    before: { title: row.title },
  });
  return ok(undefined);
}

// A season's checklist

/**
 * Copies the template into a season, each task due its number of days from
 * the season's first day. A template task already copied is skipped, so
 * starting twice adds only what the template gained since. Returns how many
 * tasks were added.
 */
export async function startSeasonChecklist(
  db: Db,
  input: {
    seasonId: SeasonId;
    leagueId: LeagueId;
    startsOn: string;
    actorId: UserId;
  },
): Promise<number> {
  await ensureTemplate(db, input.leagueId);
  const template = await db
    .select()
    .from(checklistTemplateTask)
    .where(eq(checklistTemplateTask.leagueId, input.leagueId));
  const added = await db
    .insert(checklistTask)
    .values(
      template.map((t) => ({
        seasonId: input.seasonId,
        templateTaskId: t.id,
        title: t.title,
        notes: t.notes,
        dueOn: dueOnFor(input.startsOn, t.offsetDays),
        ownerId: t.ownerId,
      })),
    )
    .onConflictDoNothing({
      target: [checklistTask.seasonId, checklistTask.templateTaskId],
    })
    .returning({ id: checklistTask.id });
  await recordAudit(db, {
    actorId: input.actorId,
    action: "checklist.start",
    entityType: "season",
    entityId: input.seasonId,
    after: { added: added.length },
  });
  return added.length;
}

/**
 * When a season's first day moves, its open tasks that came from the
 * template move by the same number of days, since they were dated from
 * it. Tasks added by hand keep their dates, and so do done tasks. Returns
 * how many moved.
 */
export async function shiftChecklistForNewStart(
  db: Db,
  input: { seasonId: SeasonId; from: string; to: string },
): Promise<number> {
  const days = daysBetween(input.from, input.to);
  if (days === 0) return 0;
  const moved = await db
    .update(checklistTask)
    .set({ dueOn: sql`${checklistTask.dueOn} + ${days}::int` })
    .where(
      and(
        eq(checklistTask.seasonId, input.seasonId),
        isNull(checklistTask.doneAt),
        isNotNull(checklistTask.templateTaskId),
      ),
    )
    .returning({ id: checklistTask.id });
  return moved.length;
}

export type TaskRow = {
  id: ChecklistTaskId;
  title: string;
  notes: string;
  dueOn: string;
  ownerId: UserId | null;
  ownerName: string | null;
  doneAt: Date | null;
};

const taskColumns = {
  id: checklistTask.id,
  title: checklistTask.title,
  notes: checklistTask.notes,
  dueOn: checklistTask.dueOn,
  ownerId: checklistTask.ownerId,
  ownerName: sql<
    string | null
  >`case when ${user.id} is null then null else ${personName} end`,
  doneAt: checklistTask.doneAt,
};

/** A season's tasks: open ones by due date, then the done ones. */
export async function seasonChecklist(
  db: Db,
  seasonId: SeasonId,
): Promise<TaskRow[]> {
  return db
    .select(taskColumns)
    .from(checklistTask)
    .leftJoin(user, eq(user.id, checklistTask.ownerId))
    .leftJoin(profile, eq(profile.userId, checklistTask.ownerId))
    .where(eq(checklistTask.seasonId, seasonId))
    .orderBy(
      sql`${checklistTask.doneAt} is not null`,
      asc(checklistTask.dueOn),
      asc(checklistTask.title),
    );
}

/** The next open tasks, soonest first, for the admin dashboard's card. */
export async function nextTasks(
  db: Db,
  seasonId: SeasonId,
  limit = 3,
): Promise<TaskRow[]> {
  return db
    .select(taskColumns)
    .from(checklistTask)
    .leftJoin(user, eq(user.id, checklistTask.ownerId))
    .leftJoin(profile, eq(profile.userId, checklistTask.ownerId))
    .where(
      and(eq(checklistTask.seasonId, seasonId), isNull(checklistTask.doneAt)),
    )
    .orderBy(asc(checklistTask.dueOn), asc(checklistTask.title))
    .limit(limit);
}

export async function addTask(
  db: Db,
  input: { seasonId: SeasonId; actorId: UserId; task: TaskInput },
): Promise<ChecklistTaskId> {
  const [row] = await db
    .insert(checklistTask)
    .values({ ...input.task, seasonId: input.seasonId })
    .returning({ id: checklistTask.id });
  if (!row) throw new Error("Insert returned no task");
  await recordAudit(db, {
    actorId: input.actorId,
    action: "checklist.add",
    entityType: "checklist_task",
    entityId: row.id,
    after: input.task,
  });
  return row.id;
}

const inSeason = (id: ChecklistTaskId, seasonId: SeasonId) =>
  and(eq(checklistTask.id, id), eq(checklistTask.seasonId, seasonId));

export async function updateTask(
  db: Db,
  input: {
    id: ChecklistTaskId;
    seasonId: SeasonId;
    actorId: UserId;
    task: TaskInput;
  },
): Promise<Result<undefined, "not_found">> {
  const [row] = await db
    .update(checklistTask)
    .set(input.task)
    .where(inSeason(input.id, input.seasonId))
    .returning({ id: checklistTask.id });
  if (!row) return err("not_found");
  await recordAudit(db, {
    actorId: input.actorId,
    action: "checklist.update",
    entityType: "checklist_task",
    entityId: row.id,
    after: input.task,
  });
  return ok(undefined);
}

/** Ticks a task off, or opens it again. */
export async function setTaskDone(
  db: Db,
  input: {
    id: ChecklistTaskId;
    seasonId: SeasonId;
    actorId: UserId;
    done: boolean;
    now: Date;
  },
): Promise<Result<undefined, "not_found">> {
  const [row] = await db
    .update(checklistTask)
    .set(
      input.done
        ? { doneAt: input.now, doneBy: input.actorId }
        : { doneAt: null, doneBy: null },
    )
    .where(inSeason(input.id, input.seasonId))
    .returning({ id: checklistTask.id });
  if (!row) return err("not_found");
  await recordAudit(db, {
    actorId: input.actorId,
    action: input.done ? "checklist.done" : "checklist.reopen",
    entityType: "checklist_task",
    entityId: row.id,
  });
  return ok(undefined);
}

export async function deleteTask(
  db: Db,
  input: { id: ChecklistTaskId; seasonId: SeasonId; actorId: UserId },
): Promise<Result<undefined, "not_found">> {
  const [row] = await db
    .delete(checklistTask)
    .where(inSeason(input.id, input.seasonId))
    .returning({ id: checklistTask.id, title: checklistTask.title });
  if (!row) return err("not_found");
  await recordAudit(db, {
    actorId: input.actorId,
    action: "checklist.delete",
    entityType: "checklist_task",
    entityId: row.id,
    before: { title: row.title },
  });
  return ok(undefined);
}

// Reminders

const longDate = (on: string) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${on}T12:00:00Z`));

/**
 * Daily: queues a non-urgent reminder for each open task due in the next
 * few days, and one for each task that has just become overdue. It goes to
 * the task's owner, or to the league's owners while nobody has the task.
 * The dedupe key names the task, its due date, the kind and the person, so
 * each goes once, and moving the date or the owner sends afresh.
 */
export async function queueChecklistReminders(
  db: Db,
  input: { leagueId: LeagueId; today: string },
): Promise<number> {
  const tasks = await db
    .select({
      id: checklistTask.id,
      title: checklistTask.title,
      notes: checklistTask.notes,
      dueOn: checklistTask.dueOn,
      ownerId: checklistTask.ownerId,
      seasonName: season.name,
      seasonSlug: season.slug,
    })
    .from(checklistTask)
    .innerJoin(season, eq(season.id, checklistTask.seasonId))
    .where(
      and(
        eq(season.leagueId, input.leagueId),
        isNull(checklistTask.doneAt),
        gte(
          checklistTask.dueOn,
          addDays(input.today, -OVERDUE_REMINDER_WINDOW),
        ),
        lte(checklistTask.dueOn, addDays(input.today, REMIND_DAYS_BEFORE)),
      ),
    );
  if (tasks.length === 0) return 0;
  const needOwners = tasks.some((t) => t.ownerId === null);
  const owners = needOwners
    ? (
        await db
          .select({ id: profile.userId })
          .from(profile)
          .where(eq(profile.globalRole, "owner"))
      ).map((r) => r.id)
    : [];
  const messages: OutboxMessage[] = tasks.flatMap((t) => {
    const kind = reminderFor(t.dueOn, input.today);
    if (!kind) return [];
    const to = t.ownerId ? [t.ownerId] : owners;
    return to.map((userId) => ({
      userId,
      template: "checklist_reminder" as const,
      topic: "operations" as const,
      payload: {
        kind,
        title: t.title,
        notes: t.notes,
        seasonName: t.seasonName,
        seasonSlug: t.seasonSlug,
        due: dueLabel(t.dueOn, input.today),
        dueOn: longDate(t.dueOn),
        unassigned: t.ownerId === null,
      },
      dedupeKey: `checklist_reminder/${t.id}/${t.dueOn}/${kind}/${userId}`,
    }));
  });
  return messages.length === 0 ? 0 : enqueueMessages(db, messages);
}
