import { and, eq, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { InterestFormId } from "@/domain/ids";
import {
  type AnswerInput,
  type FormInput,
  type OptionInput,
  readiness,
} from "@/domain/interest/interest";
import { auditLog } from "../schema/audit";
import { user } from "../schema/auth";
import {
  interestAnswer,
  interestChoice,
  interestForm,
  interestOption,
} from "../schema/interest";
import { league } from "../schema/league";
import { message } from "../schema/message";
import { closePool, inRolledBackDb } from "../test/transaction";
import {
  addOption,
  closeInterestForm,
  goAhead,
  interestForms,
  openFormOf,
  openInterestForm,
  purgeInterestEmails,
  removeAnswer,
  removeOption,
  reopenInterestForm,
  saveAnswer,
  updateTarget,
} from "./interest";
import type { Db } from "./schedule";

afterAll(closePool);

const NOW = new Date("2026-11-15T15:00:00Z");

const FORM: FormInput = {
  title: "Where should we grow?",
  intro: "",
  teamsNeeded: 8,
  playersPerTeam: 12,
};

const THURSDAY: OptionInput = {
  park: "Prospect Park",
  night: "thursday",
  format: "social",
};
const SUNDAY: OptionInput = { park: null, night: "sunday", format: null };
const FORT: OptionInput = {
  park: "Fort Greene Park",
  night: null,
  format: "competitive",
};

/** Two invented leagues, an admin each, and the first league's open form. */
async function world(
  db: Db,
  options: readonly OptionInput[] = [THURSDAY, SUNDAY],
) {
  const tag = Math.random().toString(36).slice(2, 8);
  const [first, second] = await db
    .insert(league)
    .values([
      { name: "Example Kickball", slug: `int-a-${tag}` },
      { name: "Other League", slug: `int-b-${tag}` },
    ])
    .returning({ id: league.id });
  const [admin] = await db
    .insert(user)
    .values({ name: "Ada Admin", email: `int-${tag}@example.test` })
    .returning({ id: user.id });
  if (!first || !second || !admin) throw new Error("no world");
  const opened = await openInterestForm(db, {
    leagueId: first.id,
    actorId: admin.id,
    form: FORM,
    options,
  });
  if (!opened.ok) throw new Error(opened.error);
  const rows = await db
    .select({ id: interestOption.id, night: interestOption.night })
    .from(interestOption)
    .where(eq(interestOption.formId, opened.value));
  return {
    leagueId: first.id,
    otherLeagueId: second.id,
    admin: admin.id,
    formId: opened.value,
    options: rows,
  };
}

type World = Awaited<ReturnType<typeof world>>;

const optionOf = (w: World, night: string) => {
  const found = w.options.find((o) => o.night === night);
  if (!found) throw new Error(`no ${night} option`);
  return found.id;
};

const answer = (
  email: string,
  choices: AnswerInput["choices"],
  friends: number | null = 0,
): AnswerInput => ({ email, friends, choices });

async function save(db: Db, w: World, input: AnswerInput, now = NOW) {
  const saved = await saveAnswer(db, { formId: w.formId, answer: input, now });
  if (!saved.ok) throw new Error(saved.error);
  return saved.value.id;
}

describe("opening a form", () => {
  it("opens one form with its options, audited, and shows it publicly", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const open = await openFormOf(db, w.leagueId);
      expect(open?.id).toBe(w.formId);
      expect(open?.options.map((o) => o.label)).toEqual([
        "Thursday nights · Social · Prospect Park",
        "Sunday nights",
      ]);
      const audit = await db
        .select({ action: auditLog.action, leagueId: auditLog.leagueId })
        .from(auditLog)
        .where(eq(auditLog.entityId, w.formId));
      expect(audit).toEqual([
        { action: "interest.open", leagueId: w.leagueId },
      ]);
      // Another league sees nothing of it.
      expect(await openFormOf(db, w.otherLeagueId)).toBeNull();
    }));

  it("allows one open form per league, and one in another league", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const again = await openInterestForm(db, {
        leagueId: w.leagueId,
        actorId: w.admin,
        form: FORM,
        options: [THURSDAY],
      });
      expect(again).toEqual({ ok: false, error: "already_open" });
      const elsewhere = await openInterestForm(db, {
        leagueId: w.otherLeagueId,
        actorId: w.admin,
        form: FORM,
        options: [THURSDAY],
      });
      expect(elsewhere.ok).toBe(true);
    }));

  it("refuses no options and the same option twice, even in another case", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      await closeInterestForm(db, {
        formId: w.formId,
        leagueId: w.leagueId,
        actorId: w.admin,
        now: NOW,
      });
      const base = { leagueId: w.leagueId, actorId: w.admin, form: FORM };
      expect(await openInterestForm(db, { ...base, options: [] })).toEqual({
        ok: false,
        error: "no_options",
      });
      expect(
        await openInterestForm(db, {
          ...base,
          options: [FORT, { ...FORT, park: "FORT GREENE PARK" }],
        }),
      ).toEqual({ ok: false, error: "duplicate_option" });
    }));
});

describe("answering", () => {
  it("counts a yes with its friends, and a not-sure apart", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const thursday = optionOf(w, "thursday");
      await save(
        db,
        w,
        answer("a@example.test", [{ optionId: thursday, response: "yes" }], 3),
      );
      await save(
        db,
        w,
        answer(
          "b@example.test",
          [{ optionId: thursday, response: "yes" }],
          null,
        ),
      );
      await save(
        db,
        w,
        answer(
          "c@example.test",
          [{ optionId: thursday, response: "unsure" }],
          2,
        ),
      );
      const [form] = await interestForms(db, w.leagueId);
      const row = form?.options.find((o) => o.id === thursday);
      expect(form?.answers).toBe(3);
      // Two yes answers: 1 + 3 friends, and 1 + "not sure" friends counted as none.
      expect(row?.counts).toEqual({
        yesAnswers: 2,
        yesPeople: 5,
        unsureAnswers: 1,
        unsurePeople: 3,
      });
      expect(row && form && readiness(row.counts, form).teams).toBe(0);
    }));

  it("keeps an answer with no options, and with every field not sure", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      await save(db, w, answer("a@example.test", [], null));
      const [form] = await interestForms(db, w.leagueId);
      expect(form?.answers).toBe(1);
      expect(form?.options.every((o) => o.counts.yesAnswers === 0)).toBe(true);
    }));

  it("replaces the answer when the same address answers again", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const thursday = optionOf(w, "thursday");
      const sunday = optionOf(w, "sunday");
      const first = await save(
        db,
        w,
        answer(
          "pat@example.test",
          [{ optionId: thursday, response: "yes" }],
          5,
        ),
      );
      // Same person, other case and spacing, changes their mind.
      const second = await save(
        db,
        w,
        answer(
          "pat@example.test",
          [{ optionId: sunday, response: "unsure" }],
          1,
        ),
        new Date("2026-11-16T15:00:00Z"),
      );
      expect(second).toBe(first);
      const [form] = await interestForms(db, w.leagueId);
      expect(form?.answers).toBe(1);
      expect(
        form?.options.find((o) => o.id === thursday)?.counts.yesAnswers,
      ).toBe(0);
      expect(form?.options.find((o) => o.id === sunday)?.counts).toMatchObject({
        unsureAnswers: 1,
        unsurePeople: 2,
      });
    }));

  it("refuses an answer to a closed form, a missing form and a foreign option", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const other = await openInterestForm(db, {
        leagueId: w.otherLeagueId,
        actorId: w.admin,
        form: FORM,
        options: [FORT],
      });
      if (!other.ok) throw new Error(other.error);
      const [foreign] = await db
        .select({ id: interestOption.id })
        .from(interestOption)
        .where(eq(interestOption.formId, other.value));
      expect(
        await saveAnswer(db, {
          formId: w.formId,
          answer: answer("a@example.test", [
            { optionId: foreign?.id ?? "", response: "yes" },
          ]),
          now: NOW,
        }),
      ).toEqual({ ok: false, error: "choice" });
      expect(
        await saveAnswer(db, {
          formId: "00000000-0000-4000-8000-000000000000" as InterestFormId,
          answer: answer("a@example.test", []),
          now: NOW,
        }),
      ).toEqual({ ok: false, error: "not_found" });
      await closeInterestForm(db, {
        formId: w.formId,
        leagueId: w.leagueId,
        actorId: w.admin,
        now: NOW,
      });
      expect(
        await saveAnswer(db, {
          formId: w.formId,
          answer: answer("a@example.test", []),
          now: NOW,
        }),
      ).toEqual({ ok: false, error: "closed" });
      expect(await db.select().from(interestAnswer)).toEqual([]);
    }));

  it("adds up many answers", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const thursday = optionOf(w, "thursday");
      for (let i = 0; i < 30; i++)
        await save(
          db,
          w,
          answer(
            `p${i}@example.test`,
            [{ optionId: thursday, response: "yes" }],
            1,
          ),
        );
      const [form] = await interestForms(db, w.leagueId);
      expect(
        form?.options.find((o) => o.id === thursday)?.counts.yesPeople,
      ).toBe(60);
    }));
});

describe("the target", () => {
  it("changes every option's marker when it is edited after answers came in", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const thursday = optionOf(w, "thursday");
      // 60 people say yes: 5 teams of 12.
      for (let i = 0; i < 30; i++)
        await save(
          db,
          w,
          answer(
            `p${i}@example.test`,
            [{ optionId: thursday, response: "yes" }],
            1,
          ),
        );
      const marker = async () => {
        const [form] = await interestForms(db, w.leagueId);
        const row = form?.options.find((o) => o.id === thursday);
        if (!form || !row) throw new Error("missing");
        return readiness(row.counts, form).enough;
      };
      expect(await marker()).toBe(false);
      const lowered = await updateTarget(db, {
        formId: w.formId,
        leagueId: w.leagueId,
        actorId: w.admin,
        form: { teamsNeeded: 5, playersPerTeam: 12 },
      });
      expect(lowered.ok).toBe(true);
      expect(await marker()).toBe(true);
      await updateTarget(db, {
        formId: w.formId,
        leagueId: w.leagueId,
        actorId: w.admin,
        form: { teamsNeeded: 5, playersPerTeam: 15 },
      });
      expect(await marker()).toBe(false);
    }));

  it("is not changed from another league", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      expect(
        await updateTarget(db, {
          formId: w.formId,
          leagueId: w.otherLeagueId,
          actorId: w.admin,
          form: { teamsNeeded: 1, playersPerTeam: 6 },
        }),
      ).toEqual({ ok: false, error: "not_found" });
    }));
});

describe("options", () => {
  it("adds an option, refuses a duplicate and caps the form", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const added = await addOption(db, {
        formId: w.formId,
        leagueId: w.leagueId,
        actorId: w.admin,
        option: FORT,
      });
      expect(added.ok).toBe(true);
      expect(
        await addOption(db, {
          formId: w.formId,
          leagueId: w.leagueId,
          actorId: w.admin,
          option: { ...FORT, park: "fort greene park" },
        }),
      ).toEqual({ ok: false, error: "duplicate" });
      for (const night of [
        "monday",
        "tuesday",
        "wednesday",
        "friday",
        "saturday",
      ] as const)
        await addOption(db, {
          formId: w.formId,
          leagueId: w.leagueId,
          actorId: w.admin,
          option: { park: null, night, format: null },
        });
      for (let i = 0; i < 4; i++)
        await addOption(db, {
          formId: w.formId,
          leagueId: w.leagueId,
          actorId: w.admin,
          option: { park: `Park ${i}`, night: null, format: null },
        });
      expect(
        await addOption(db, {
          formId: w.formId,
          leagueId: w.leagueId,
          actorId: w.admin,
          option: { park: "One too many", night: null, format: null },
        }),
      ).toEqual({ ok: false, error: "full" });
    }));

  it("removes an option nobody picked, but not one with answers or the last one", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const thursday = optionOf(w, "thursday");
      const sunday = optionOf(w, "sunday");
      await save(
        db,
        w,
        answer("a@example.test", [{ optionId: thursday, response: "unsure" }]),
      );
      const remove = (optionId: typeof thursday) =>
        removeOption(db, { optionId, leagueId: w.leagueId, actorId: w.admin });
      expect(await remove(thursday)).toEqual({
        ok: false,
        error: "has_answers",
      });
      expect((await remove(sunday)).ok).toBe(true);
      // Thursday is the only one left, and it has answers anyway.
      expect(await remove(thursday)).toMatchObject({ ok: false });
      expect(
        await removeOption(db, {
          optionId: thursday,
          leagueId: w.otherLeagueId,
          actorId: w.admin,
        }),
      ).toEqual({ ok: false, error: "not_found" });
    }));

  it("keeps the last option even with no answers", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db, [FORT]);
      const only = w.options[0];
      if (!only) throw new Error("no option");
      expect(
        await removeOption(db, {
          optionId: only.id,
          leagueId: w.leagueId,
          actorId: w.admin,
        }),
      ).toEqual({ ok: false, error: "last_option" });
    }));
});

describe("going ahead", () => {
  const goMessages = (db: Db) =>
    db
      .select({
        to: message.recipientEmail,
        userId: message.userId,
        template: message.template,
        key: message.dedupeKey,
        payload: message.payload,
      })
      .from(message)
      .where(and(eq(message.template, "interest_go_ahead")));

  it("tells everyone who picked it, yes or not sure, in one message each", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const thursday = optionOf(w, "thursday");
      const sunday = optionOf(w, "sunday");
      await save(
        db,
        w,
        answer("yes@example.test", [{ optionId: thursday, response: "yes" }]),
      );
      await save(
        db,
        w,
        answer("maybe@example.test", [
          { optionId: thursday, response: "unsure" },
        ]),
      );
      await save(
        db,
        w,
        answer("other@example.test", [{ optionId: sunday, response: "yes" }]),
      );
      await save(db, w, answer("none@example.test", []));
      const went = await goAhead(db, {
        optionId: thursday,
        leagueId: w.leagueId,
        actorId: w.admin,
        note: "Registration opens in January.",
        now: NOW,
      });
      expect(went).toEqual({ ok: true, value: { told: 2 } });
      const sent = await goMessages(db);
      expect(sent.map((m) => m.to).sort()).toEqual([
        "maybe@example.test",
        "yes@example.test",
      ]);
      expect(sent.every((m) => m.userId === null)).toBe(true);
      expect(sent[0]?.payload).toMatchObject({
        leagueName: "Example Kickball",
        optionLabel: "Thursday nights · Social · Prospect Park",
        note: "Registration opens in January.",
      });
      // The audit row counts the people; it holds no address.
      const [audit] = await db
        .select({ after: auditLog.after })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.entityId, w.formId),
            eq(auditLog.action, "interest.go_ahead"),
          ),
        );
      expect(audit?.after).toEqual({ option: thursday, told: 2 });
      // It leaves the public form; the other option stays.
      expect(
        (await openFormOf(db, w.leagueId))?.options.map((o) => o.id),
      ).toEqual([sunday]);
    }));

  it("goes once only, and queues nothing the second time", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const thursday = optionOf(w, "thursday");
      await save(
        db,
        w,
        answer("yes@example.test", [{ optionId: thursday, response: "yes" }]),
      );
      const go = () =>
        goAhead(db, {
          optionId: thursday,
          leagueId: w.leagueId,
          actorId: w.admin,
          note: "",
          now: NOW,
        });
      expect((await go()).ok).toBe(true);
      expect(await go()).toEqual({ ok: false, error: "already" });
      expect(await goMessages(db)).toHaveLength(1);
    }));

  it("needs the option's own league and an open form", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const thursday = optionOf(w, "thursday");
      expect(
        await goAhead(db, {
          optionId: thursday,
          leagueId: w.otherLeagueId,
          actorId: w.admin,
          note: "",
          now: NOW,
        }),
      ).toEqual({ ok: false, error: "not_found" });
      await closeInterestForm(db, {
        formId: w.formId,
        leagueId: w.leagueId,
        actorId: w.admin,
        now: NOW,
      });
      expect(
        await goAhead(db, {
          optionId: thursday,
          leagueId: w.leagueId,
          actorId: w.admin,
          note: "",
          now: NOW,
        }),
      ).toEqual({ ok: false, error: "closed" });
    }));

  it("tells nobody when nobody picked it", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const went = await goAhead(db, {
        optionId: optionOf(w, "sunday"),
        leagueId: w.leagueId,
        actorId: w.admin,
        note: "",
        now: NOW,
      });
      expect(went).toEqual({ ok: true, value: { told: 0 } });
      expect(await goMessages(db)).toEqual([]);
    }));

  it("tells someone who picks it afterwards, once, however often they edit", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const thursday = optionOf(w, "thursday");
      await goAhead(db, {
        optionId: thursday,
        leagueId: w.leagueId,
        actorId: w.admin,
        note: "See you there.",
        now: NOW,
      });
      const late = answer("late@example.test", [
        { optionId: thursday, response: "yes" },
      ]);
      await save(db, w, late);
      await save(db, w, { ...late, friends: 4 });
      const sent = await goMessages(db);
      expect(sent.map((m) => m.to)).toEqual(["late@example.test"]);
      expect(sent[0]?.payload).toMatchObject({ note: "See you there." });
    }));

  it("sends one message per option to someone who picked two that went ahead", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const thursday = optionOf(w, "thursday");
      const sunday = optionOf(w, "sunday");
      await save(
        db,
        w,
        answer("both@example.test", [
          { optionId: thursday, response: "yes" },
          { optionId: sunday, response: "yes" },
        ]),
      );
      for (const optionId of [thursday, sunday])
        await goAhead(db, {
          optionId,
          leagueId: w.leagueId,
          actorId: w.admin,
          note: "",
          now: NOW,
        });
      expect(await goMessages(db)).toHaveLength(2);
    }));

  it("queues non-urgent mail that waits like other league news", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const thursday = optionOf(w, "thursday");
      await save(
        db,
        w,
        answer("yes@example.test", [{ optionId: thursday, response: "yes" }]),
      );
      await goAhead(db, {
        optionId: thursday,
        leagueId: w.leagueId,
        actorId: w.admin,
        note: "",
        now: NOW,
      });
      const [queued] = await db
        .select({
          status: message.status,
          topic: message.topic,
          sendAfter: message.sendAfter,
        })
        .from(message)
        .where(eq(message.template, "interest_go_ahead"));
      expect(queued).toMatchObject({ status: "queued", topic: "announcement" });
    }));
});

describe("reopening and closing", () => {
  it("closes and reopens a form, and refuses to open a second", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const args = { formId: w.formId, leagueId: w.leagueId, actorId: w.admin };
      expect((await closeInterestForm(db, { ...args, now: NOW })).ok).toBe(
        true,
      );
      expect(await closeInterestForm(db, { ...args, now: NOW })).toEqual({
        ok: false,
        error: "closed",
      });
      expect(await openFormOf(db, w.leagueId)).toBeNull();
      const second = await openInterestForm(db, {
        leagueId: w.leagueId,
        actorId: w.admin,
        form: FORM,
        options: [FORT],
      });
      expect(second.ok).toBe(true);
      expect(await reopenInterestForm(db, args)).toEqual({
        ok: false,
        error: "already_open",
      });
    }));

  it("reopens a closed form when none other is open", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const args = { formId: w.formId, leagueId: w.leagueId, actorId: w.admin };
      await closeInterestForm(db, { ...args, now: NOW });
      expect((await reopenInterestForm(db, args)).ok).toBe(true);
      expect((await openFormOf(db, w.leagueId))?.id).toBe(w.formId);
      expect(await reopenInterestForm(db, args)).toEqual({
        ok: false,
        error: "open",
      });
    }));
});

describe("people's addresses", () => {
  it("deletes one address's answer and the message waiting for it", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const thursday = optionOf(w, "thursday");
      await goAhead(db, {
        optionId: thursday,
        leagueId: w.leagueId,
        actorId: w.admin,
        note: "",
        now: NOW,
      });
      await save(
        db,
        w,
        answer("late@example.test", [{ optionId: thursday, response: "yes" }]),
      );
      await save(db, w, answer("stay@example.test", []));
      expect(
        await removeAnswer(db, {
          formId: w.formId,
          leagueId: w.leagueId,
          actorId: w.admin,
          email: "late@example.test",
        }),
      ).toBe(true);
      const left = await db
        .select({ email: interestAnswer.email })
        .from(interestAnswer);
      expect(left).toEqual([{ email: "stay@example.test" }]);
      expect(await db.select().from(interestChoice)).toEqual([]);
      expect(
        await db
          .select()
          .from(message)
          .where(like(message.dedupeKey, "interest/%")),
      ).toEqual([]);
      expect(
        await removeAnswer(db, {
          formId: w.formId,
          leagueId: w.otherLeagueId,
          actorId: w.admin,
          email: "stay@example.test",
        }),
      ).toBe(false);
    }));

  it("clears addresses six months after a form closes, keeping the totals", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const thursday = optionOf(w, "thursday");
      await save(
        db,
        w,
        answer("a@example.test", [{ optionId: thursday, response: "yes" }], 2),
      );
      await goAhead(db, {
        optionId: optionOf(w, "sunday"),
        leagueId: w.leagueId,
        actorId: w.admin,
        note: "",
        now: NOW,
      });
      await save(
        db,
        w,
        answer("b@example.test", [
          { optionId: optionOf(w, "sunday"), response: "yes" },
        ]),
      );
      await closeInterestForm(db, {
        formId: w.formId,
        leagueId: w.leagueId,
        actorId: w.admin,
        now: new Date("2026-12-01T12:00:00Z"),
      });
      // Not yet: five months on.
      expect(
        await purgeInterestEmails(db, new Date("2027-05-01T12:00:00Z")),
      ).toBe(0);
      expect(
        await purgeInterestEmails(db, new Date("2027-06-02T12:00:00Z")),
      ).toBe(2);
      const rows = await db
        .select({ email: interestAnswer.email })
        .from(interestAnswer);
      expect(rows).toEqual([{ email: null }, { email: null }]);
      expect(
        await db
          .select()
          .from(message)
          .where(like(message.dedupeKey, "interest/%")),
      ).toEqual([]);
      const [form] = await interestForms(db, w.leagueId);
      expect(form?.answers).toBe(2);
      expect(
        form?.options.find((o) => o.id === thursday)?.counts.yesPeople,
      ).toBe(3);
      // Running it again finds nothing.
      expect(
        await purgeInterestEmails(db, new Date("2027-06-03T12:00:00Z")),
      ).toBe(0);
    }));

  it("keeps the addresses of a form that is still open", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      await save(db, w, answer("a@example.test", []));
      expect(
        await purgeInterestEmails(db, new Date("2030-01-01T00:00:00Z")),
      ).toBe(0);
      const [form] = await db
        .select({ status: interestForm.status })
        .from(interestForm)
        .where(eq(interestForm.id, w.formId));
      expect(form?.status).toBe("open");
    }));
});
