import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  sql,
} from "drizzle-orm";
import {
  type AnswerInput,
  type FormInput,
  KEEP_EMAIL_MONTHS,
  MAX_OPTIONS,
  NO_COUNTS,
  type OptionCounts,
  type OptionInput,
  optionKey,
  optionLabel,
} from "@/domain/interest/interest";
import type {
  InterestAnswerId,
  InterestFormId,
  InterestOptionId,
  LeagueId,
  UserId,
} from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import { league } from "../schema/league";
import {
  interestAnswer,
  interestChoice,
  interestForm,
  interestOption,
} from "../schema/interest";
import { recordAudit } from "./audit";
import { enqueueMessages, type OutboxMessage } from "./outbox";
import type { Db } from "./schedule";

/**
 * Interest sign-ups (src/domain/interest/interest.ts). Pages and actions
 * check `interest.manage` before calling the admin functions; the public
 * form calls only `openFormOf` and `saveAnswer`.
 */

const UNIQUE_VIOLATION = "23505";

/** Whether an error is Postgres refusing a duplicate, on any driver. */
function isUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause)
    if ((e as { code?: string }).code === UNIQUE_VIOLATION) return true;
  return false;
}

export type OptionRow = OptionInput & {
  id: InterestOptionId;
  label: string;
  goAheadAt: Date | null;
  goAheadNote: string | null;
};

const optionColumns = {
  id: interestOption.id,
  park: interestOption.park,
  night: interestOption.night,
  format: interestOption.format,
  goAheadAt: interestOption.goAheadAt,
  goAheadNote: interestOption.goAheadNote,
};

const toOptionRow = (r: {
  id: InterestOptionId;
  park: string | null;
  night: OptionInput["night"];
  format: OptionInput["format"];
  goAheadAt: Date | null;
  goAheadNote: string | null;
}): OptionRow => ({ ...r, label: optionLabel(r) });

/** What the public page shows: the league's open form and the options still open. */
export type PublicForm = {
  id: InterestFormId;
  title: string;
  intro: string;
  options: { id: InterestOptionId; label: string }[];
};

/**
 * The league's open form for the public page, or null. Options the league
 * already decided to run are left off: everyone who wanted them was told.
 * Reads no totals and nothing about any answer.
 */
export async function openFormOf(
  db: Db,
  leagueId: LeagueId,
): Promise<PublicForm | null> {
  const [form] = await db
    .select({
      id: interestForm.id,
      title: interestForm.title,
      intro: interestForm.intro,
    })
    .from(interestForm)
    .where(
      and(eq(interestForm.leagueId, leagueId), eq(interestForm.status, "open")),
    );
  if (!form) return null;
  const options = await db
    .select(optionColumns)
    .from(interestOption)
    .where(
      and(eq(interestOption.formId, form.id), isNull(interestOption.goAheadAt)),
    )
    .orderBy(asc(interestOption.position), asc(interestOption.createdAt));
  return {
    ...form,
    options: options.map((o) => ({ id: o.id, label: optionLabel(o) })),
  };
}

// ------------------------------------------------------------- admin reads

export type FormRow = FormInput & {
  id: InterestFormId;
  status: "open" | "closed";
  createdAt: Date;
  closedAt: Date | null;
  /** Everyone who answered, whatever they picked. */
  answers: number;
  options: (OptionRow & { counts: OptionCounts })[];
};

/**
 * The league's forms, newest first, each with its options and the totals
 * per option. Three queries however many forms and answers there are; reads
 * no address.
 */
export async function interestForms(
  db: Db,
  leagueId: LeagueId,
  limit = 10,
): Promise<FormRow[]> {
  const forms = await db
    .select({
      id: interestForm.id,
      title: interestForm.title,
      intro: interestForm.intro,
      status: interestForm.status,
      teamsNeeded: interestForm.teamsNeeded,
      playersPerTeam: interestForm.playersPerTeam,
      createdAt: interestForm.createdAt,
      closedAt: interestForm.closedAt,
    })
    .from(interestForm)
    .where(eq(interestForm.leagueId, leagueId))
    .orderBy(desc(interestForm.createdAt))
    .limit(limit);
  if (forms.length === 0) return [];
  const formIds = forms.map((f) => f.id);
  const [options, counts, answered] = await Promise.all([
    db
      .select({ ...optionColumns, formId: interestOption.formId })
      .from(interestOption)
      .where(inArray(interestOption.formId, formIds))
      .orderBy(asc(interestOption.position), asc(interestOption.createdAt)),
    db
      .select({
        optionId: interestChoice.optionId,
        yesAnswers: sql<number>`count(*) filter (where ${interestChoice.response} = 'yes')::int`,
        yesPeople: sql<number>`coalesce(sum(1 + coalesce(${interestAnswer.friends}, 0)) filter (where ${interestChoice.response} = 'yes'), 0)::int`,
        unsureAnswers: sql<number>`count(*) filter (where ${interestChoice.response} = 'unsure')::int`,
        unsurePeople: sql<number>`coalesce(sum(1 + coalesce(${interestAnswer.friends}, 0)) filter (where ${interestChoice.response} = 'unsure'), 0)::int`,
      })
      .from(interestChoice)
      .innerJoin(interestAnswer, eq(interestAnswer.id, interestChoice.answerId))
      .innerJoin(interestOption, eq(interestOption.id, interestChoice.optionId))
      .where(inArray(interestOption.formId, formIds))
      .groupBy(interestChoice.optionId),
    db
      .select({
        formId: interestAnswer.formId,
        n: sql<number>`count(*)::int`,
      })
      .from(interestAnswer)
      .where(inArray(interestAnswer.formId, formIds))
      .groupBy(interestAnswer.formId),
  ]);
  const countOf = new Map<InterestOptionId, OptionCounts>(
    counts.map(({ optionId, ...rest }) => [optionId, rest]),
  );
  const answersOf = new Map(answered.map((a) => [a.formId, a.n]));
  return forms.map((f) => ({
    ...f,
    answers: answersOf.get(f.id) ?? 0,
    options: options
      .filter((o) => o.formId === f.id)
      .map((o) => ({
        ...toOptionRow(o),
        counts: countOf.get(o.id) ?? NO_COUNTS,
      })),
  }));
}

// ------------------------------------------------------------ admin writes

export type OpenFormError = "already_open" | "no_options" | "duplicate_option";

/** Opens a form with its options. Only one form is open per league. */
export async function openInterestForm(
  db: Db,
  input: {
    leagueId: LeagueId;
    actorId: UserId;
    form: FormInput;
    options: readonly OptionInput[];
  },
): Promise<Result<InterestFormId, OpenFormError>> {
  if (input.options.length === 0) return err("no_options");
  if (new Set(input.options.map(optionKey)).size !== input.options.length)
    return err("duplicate_option");
  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(interestForm)
        .values({
          leagueId: input.leagueId,
          title: input.form.title,
          intro: input.form.intro,
          teamsNeeded: input.form.teamsNeeded,
          playersPerTeam: input.form.playersPerTeam,
          createdBy: input.actorId,
        })
        .returning({ id: interestForm.id });
      if (!created) throw new Error("The interest form was not saved");
      await tx.insert(interestOption).values(
        input.options.map((o, position) => ({
          formId: created.id,
          park: o.park,
          night: o.night,
          format: o.format,
          position,
        })),
      );
      await recordAudit(tx, {
        actorId: input.actorId,
        action: "interest.open",
        entityType: "interest_form",
        entityId: created.id,
        after: { options: input.options.length },
      });
      return ok(created.id);
    });
  } catch (error) {
    if (isUniqueViolation(error)) return err("already_open");
    throw error;
  }
}

/** Changes the target of a form, open or closed; the markers follow at once. */
export async function updateTarget(
  db: Db,
  input: {
    formId: InterestFormId;
    leagueId: LeagueId;
    actorId: UserId;
    form: Pick<FormInput, "teamsNeeded" | "playersPerTeam">;
  },
): Promise<Result<true, "not_found">> {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({
        teamsNeeded: interestForm.teamsNeeded,
        playersPerTeam: interestForm.playersPerTeam,
      })
      .from(interestForm)
      .where(
        and(
          eq(interestForm.id, input.formId),
          eq(interestForm.leagueId, input.leagueId),
        ),
      )
      .for("update");
    if (!before) return err("not_found");
    await tx
      .update(interestForm)
      .set(input.form)
      .where(eq(interestForm.id, input.formId));
    await recordAudit(tx, {
      actorId: input.actorId,
      action: "interest.target",
      entityType: "interest_form",
      entityId: input.formId,
      before,
      after: input.form,
    });
    return ok(true as const);
  });
}

/** Closes a form: no more answers, and the clock on the addresses starts. */
export async function closeInterestForm(
  db: Db,
  input: {
    formId: InterestFormId;
    leagueId: LeagueId;
    actorId: UserId;
    now: Date;
  },
): Promise<Result<true, "not_found" | "closed">> {
  return db.transaction(async (tx) => {
    const [form] = await tx
      .select({ status: interestForm.status })
      .from(interestForm)
      .where(
        and(
          eq(interestForm.id, input.formId),
          eq(interestForm.leagueId, input.leagueId),
        ),
      )
      .for("update");
    if (!form) return err("not_found");
    if (form.status === "closed") return err("closed");
    await tx
      .update(interestForm)
      .set({ status: "closed", closedAt: input.now })
      .where(eq(interestForm.id, input.formId));
    await recordAudit(tx, {
      actorId: input.actorId,
      action: "interest.close",
      entityType: "interest_form",
      entityId: input.formId,
    });
    return ok(true as const);
  });
}

/** Opens a closed form again, if no other form is open. Its addresses are kept. */
export async function reopenInterestForm(
  db: Db,
  input: { formId: InterestFormId; leagueId: LeagueId; actorId: UserId },
): Promise<Result<true, "not_found" | "already_open" | "open">> {
  try {
    return await db.transaction(async (tx) => {
      const [form] = await tx
        .select({ status: interestForm.status })
        .from(interestForm)
        .where(
          and(
            eq(interestForm.id, input.formId),
            eq(interestForm.leagueId, input.leagueId),
          ),
        )
        .for("update");
      if (!form) return err("not_found");
      if (form.status === "open") return err("open");
      await tx
        .update(interestForm)
        .set({ status: "open", closedAt: null })
        .where(eq(interestForm.id, input.formId));
      await recordAudit(tx, {
        actorId: input.actorId,
        action: "interest.reopen",
        entityType: "interest_form",
        entityId: input.formId,
      });
      return ok(true as const);
    });
  } catch (error) {
    if (isUniqueViolation(error)) return err("already_open");
    throw error;
  }
}

/** Adds an option to a form that is still open. */
export async function addOption(
  db: Db,
  input: {
    formId: InterestFormId;
    leagueId: LeagueId;
    actorId: UserId;
    option: OptionInput;
  },
): Promise<
  Result<InterestOptionId, "not_found" | "closed" | "duplicate" | "full">
> {
  return db.transaction(async (tx) => {
    const [form] = await tx
      .select({ status: interestForm.status })
      .from(interestForm)
      .where(
        and(
          eq(interestForm.id, input.formId),
          eq(interestForm.leagueId, input.leagueId),
        ),
      )
      .for("update");
    if (!form) return err("not_found");
    if (form.status !== "open") return err("closed");
    const [stats] = await tx
      .select({
        n: sql<number>`count(*)::int`,
        last: sql<number>`coalesce(max(${interestOption.position}), -1)::int`,
      })
      .from(interestOption)
      .where(eq(interestOption.formId, input.formId));
    if ((stats?.n ?? 0) >= MAX_OPTIONS) return err("full");
    // The form's row is locked, so two admins adding the same option queue up.
    const existing = await tx
      .select({
        park: interestOption.park,
        night: interestOption.night,
        format: interestOption.format,
      })
      .from(interestOption)
      .where(eq(interestOption.formId, input.formId));
    if (existing.some((o) => optionKey(o) === optionKey(input.option)))
      return err("duplicate");
    const [created] = await tx
      .insert(interestOption)
      .values({
        formId: input.formId,
        park: input.option.park,
        night: input.option.night,
        format: input.option.format,
        position: (stats?.last ?? -1) + 1,
      })
      .returning({ id: interestOption.id });
    if (!created) throw new Error("The option was not saved");
    await recordAudit(tx, {
      actorId: input.actorId,
      action: "interest.option_add",
      entityType: "interest_option",
      entityId: created.id,
    });
    return ok(created.id);
  });
}

/**
 * Removes an option nobody has picked. One with answers stays, so totals
 * and the promise made to those who picked it are never lost.
 */
export async function removeOption(
  db: Db,
  input: {
    optionId: InterestOptionId;
    leagueId: LeagueId;
    actorId: UserId;
  },
): Promise<Result<true, "not_found" | "has_answers" | "last_option">> {
  return db.transaction(async (tx) => {
    const [option] = await tx
      .select({ formId: interestOption.formId })
      .from(interestOption)
      .innerJoin(interestForm, eq(interestForm.id, interestOption.formId))
      .where(
        and(
          eq(interestOption.id, input.optionId),
          eq(interestForm.leagueId, input.leagueId),
        ),
      );
    if (!option) return err("not_found");
    // The form's row serializes this with answers being saved to it.
    await tx
      .select({ id: interestForm.id })
      .from(interestForm)
      .where(eq(interestForm.id, option.formId))
      .for("update");
    const [picked] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(interestChoice)
      .where(eq(interestChoice.optionId, input.optionId));
    if ((picked?.n ?? 0) > 0) return err("has_answers");
    const [remaining] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(interestOption)
      .where(eq(interestOption.formId, option.formId));
    if ((remaining?.n ?? 0) <= 1) return err("last_option");
    await tx
      .delete(interestOption)
      .where(eq(interestOption.id, input.optionId));
    await recordAudit(tx, {
      actorId: input.actorId,
      action: "interest.option_remove",
      entityType: "interest_form",
      entityId: option.formId,
    });
    return ok(true as const);
  });
}

// ------------------------------------------------------------ the public answer

/** The message to one address when an option goes ahead. */
function goAheadMessage(p: {
  answerId: InterestAnswerId;
  optionId: InterestOptionId;
  email: string;
  leagueName: string;
  optionLabel: string;
  note: string;
  now: Date;
}): OutboxMessage {
  return {
    userId: null,
    recipientEmail: p.email,
    // Not an account's setting: the address has no account to hold one.
    topic: "announcement",
    template: "interest_go_ahead",
    payload: {
      leagueName: p.leagueName,
      optionLabel: p.optionLabel,
      note: p.note,
    },
    // One per answer and option, however often the answer is edited.
    dedupeKey: `interest/${p.answerId}/${p.optionId}`,
    sendAfter: p.now,
  };
}

export type SaveAnswerError = "not_found" | "closed" | "choice";

/**
 * Saves one answer to an open form. The address answers once per form:
 * answering again replaces the earlier answer, so a second submission
 * never double-counts and never says whether the address had answered.
 *
 * Choosing an option the league has already decided to run (the page was
 * open when it went ahead) queues that option's message at once, since
 * going ahead told only those who had picked it by then. The option rows
 * are read `for share` and going ahead updates them, so an answer and a
 * go-ahead that cross are ordered: one of them sends the message, and the
 * dedupe key keeps it to one.
 */
export async function saveAnswer(
  db: Db,
  input: { formId: InterestFormId; answer: AnswerInput; now: Date },
): Promise<Result<{ id: InterestAnswerId }, SaveAnswerError>> {
  return db.transaction(async (tx) => {
    const [form] = await tx
      .select({
        status: interestForm.status,
        leagueName: league.name,
      })
      .from(interestForm)
      .innerJoin(league, eq(league.id, interestForm.leagueId))
      .where(eq(interestForm.id, input.formId))
      .for("share", { of: interestForm });
    if (!form) return err("not_found");
    if (form.status !== "open") return err("closed");
    const chosen = input.answer.choices.map((c) => c.optionId);
    const options =
      chosen.length === 0
        ? []
        : await tx
            .select({
              id: interestOption.id,
              park: interestOption.park,
              night: interestOption.night,
              format: interestOption.format,
              goAheadAt: interestOption.goAheadAt,
              goAheadNote: interestOption.goAheadNote,
            })
            .from(interestOption)
            .where(
              and(
                eq(interestOption.formId, input.formId),
                inArray(interestOption.id, chosen),
              ),
            )
            .for("share");
    if (options.length !== new Set(chosen).size) return err("choice");
    const [saved] = await tx
      .insert(interestAnswer)
      .values({
        formId: input.formId,
        email: input.answer.email,
        friends: input.answer.friends,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .onConflictDoUpdate({
        target: [interestAnswer.formId, interestAnswer.email],
        set: { friends: input.answer.friends, updatedAt: input.now },
      })
      .returning({ id: interestAnswer.id });
    if (!saved) throw new Error("The answer was not saved");
    await tx
      .delete(interestChoice)
      .where(eq(interestChoice.answerId, saved.id));
    if (input.answer.choices.length > 0)
      await tx.insert(interestChoice).values(
        input.answer.choices.map((c) => ({
          answerId: saved.id,
          optionId: c.optionId as InterestOptionId,
          response: c.response,
        })),
      );
    const late = options.filter((o) => o.goAheadAt !== null);
    await enqueueMessages(
      tx,
      late.map((o) =>
        goAheadMessage({
          answerId: saved.id,
          optionId: o.id,
          email: input.answer.email,
          leagueName: form.leagueName,
          optionLabel: optionLabel(o),
          note: o.goAheadNote ?? "",
          now: input.now,
        }),
      ),
    );
    return ok({ id: saved.id });
  });
}

// ------------------------------------------------------------- going ahead

/** How many messages one insert queues, to stay far from the parameter limit. */
const CHUNK = 400;

/**
 * Decides an option goes ahead and queues one message to everyone who
 * picked it, "Yes" or "Not sure". Once only: a second call is refused, and
 * the dedupe key would keep it to one message per person anyway. The
 * message is non-urgent, so it waits out quiet hours and counts against
 * the day's email allowance like other league news.
 */
export async function goAhead(
  db: Db,
  input: {
    optionId: InterestOptionId;
    leagueId: LeagueId;
    actorId: UserId;
    note: string;
    now: Date;
  },
): Promise<Result<{ told: number }, "not_found" | "closed" | "already">> {
  return db.transaction(async (tx) => {
    const [found] = await tx
      .select({
        formId: interestOption.formId,
        status: interestForm.status,
        leagueName: league.name,
        goAheadAt: interestOption.goAheadAt,
        park: interestOption.park,
        night: interestOption.night,
        format: interestOption.format,
      })
      .from(interestOption)
      .innerJoin(interestForm, eq(interestForm.id, interestOption.formId))
      .innerJoin(league, eq(league.id, interestForm.leagueId))
      .where(
        and(
          eq(interestOption.id, input.optionId),
          eq(interestForm.leagueId, input.leagueId),
        ),
      )
      .for("update", { of: interestOption });
    if (!found) return err("not_found");
    if (found.goAheadAt) return err("already");
    if (found.status !== "open") return err("closed");
    await tx
      .update(interestOption)
      .set({
        goAheadAt: input.now,
        goAheadBy: input.actorId,
        goAheadNote: input.note === "" ? null : input.note,
      })
      .where(eq(interestOption.id, input.optionId));
    const people = await tx
      .select({ answerId: interestAnswer.id, email: interestAnswer.email })
      .from(interestChoice)
      .innerJoin(interestAnswer, eq(interestAnswer.id, interestChoice.answerId))
      .where(
        and(
          eq(interestChoice.optionId, input.optionId),
          isNotNull(interestAnswer.email),
        ),
      );
    const messages = people.flatMap((p) =>
      p.email
        ? [
            goAheadMessage({
              answerId: p.answerId,
              optionId: input.optionId,
              email: p.email,
              leagueName: found.leagueName,
              optionLabel: optionLabel(found),
              note: input.note,
              now: input.now,
            }),
          ]
        : [],
    );
    for (let i = 0; i < messages.length; i += CHUNK)
      await enqueueMessages(tx, messages.slice(i, i + CHUNK));
    await recordAudit(tx, {
      actorId: input.actorId,
      action: "interest.go_ahead",
      entityType: "interest_form",
      entityId: found.formId,
      // Who was told stays out of the log; it records how many.
      after: { option: input.optionId, told: messages.length },
    });
    return ok({ told: messages.length });
  });
}

// ------------------------------------------------------------ people's data

/**
 * Deletes the answer from one address, on the person's request, and the
 * message waiting for them. Returns whether there was one.
 */
export async function removeAnswer(
  db: Db,
  input: {
    formId: InterestFormId;
    leagueId: LeagueId;
    actorId: UserId;
    email: string;
  },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const gone = await tx
      .delete(interestAnswer)
      .where(
        and(
          eq(interestAnswer.formId, input.formId),
          eq(interestAnswer.email, input.email),
          sql`exists (select 1 from ${interestForm} f where f.id = ${interestAnswer.formId} and f.league_id = ${input.leagueId})`,
        ),
      )
      .returning({ id: interestAnswer.id });
    if (gone.length === 0) return false;
    await tx.execute(
      sql`delete from message where recipient_email is not null and dedupe_key like ${`interest/${gone[0]?.id}/%`}`,
    );
    await recordAudit(tx, {
      actorId: input.actorId,
      action: "interest.answer_remove",
      entityType: "interest_form",
      entityId: input.formId,
    });
    return true;
  });
}

/**
 * Clears the address of every answer to a form closed more than six months
 * ago, and deletes the messages queued to those addresses. The totals stay;
 * the people do not. Returns how many answers.
 */
export async function purgeInterestEmails(db: Db, now: Date): Promise<number> {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - KEEP_EMAIL_MONTHS);
  return db.transaction(async (tx) => {
    const gone = await tx
      .update(interestAnswer)
      .set({ email: null })
      .where(
        and(
          isNotNull(interestAnswer.email),
          inArray(
            interestAnswer.formId,
            tx
              .select({ id: interestForm.id })
              .from(interestForm)
              .where(lt(interestForm.closedAt, cutoff)),
          ),
        ),
      )
      .returning({ id: interestAnswer.id });
    if (gone.length > 0)
      await tx.execute(
        sql`delete from message where recipient_email is not null and split_part(dedupe_key, '/', 1) = 'interest' and split_part(dedupe_key, '/', 2) in (${sql.join(
          gone.map((g) => sql`${g.id}`),
          sql`, `,
        )})`,
      );
    return gone.length;
  });
}
