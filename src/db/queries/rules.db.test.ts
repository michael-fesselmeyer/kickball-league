import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { auditLog } from "../schema/audit";
import { division, ruleSet } from "../schema/division";
import { message } from "../schema/message";
import { season } from "../schema/season";
import { messagingWorld } from "../test/messaging-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import {
  changeLog,
  currentRules,
  gameSettings,
  publishRuleChange,
  ruleChanges,
  rulesVersion,
} from "./rules";
import type { Db } from "./schedule";

afterAll(closePool);

const TODAY = "2026-09-14";

async function start(db: Db) {
  const w = await messagingWorld(db);
  const first = await publishRuleChange(db, {
    leagueId: w.leagueId,
    actorId: w.aces.captain.userId,
    sections: [
      {
        id: null,
        title: "Lineups",
        body: "Sample: ten players field.",
        remove: false,
      },
      {
        id: null,
        title: "Playoffs",
        body: "Sample: four teams play off.",
        remove: false,
      },
    ],
    version: "",
    summary: "The first rules",
    effectiveOn: "",
    notice: false,
    today: TODAY,
    rulesPath: "/rules",
  });
  if (!first.ok) throw new Error(first.error);
  return { w, first: first.value };
}

describe("publishRuleChange", () => {
  it("saves the sections and a dated change, newest first", async () => {
    await inRolledBackDb(async (db) => {
      const { w, first } = await start(db);
      expect(first.recipients).toBe(0);
      const rules = await currentRules(db, w.leagueId);
      expect(rules.map((r) => [r.slug, r.position])).toEqual([
        ["lineups", 0],
        ["playoffs", 1],
      ]);
      expect(await rulesVersion(db, w.leagueId)).toBe(first.id);

      const [lineups, playoffs] = rules;
      if (!lineups || !playoffs) throw new Error("sections");
      const second = await publishRuleChange(db, {
        leagueId: w.leagueId,
        actorId: w.aces.captain.userId,
        sections: [
          {
            id: lineups.id,
            title: "Kicking order",
            body: "Sample: new order rule.",
            remove: false,
          },
          { id: playoffs.id, title: "", body: "", remove: true },
        ],
        version: first.id,
        summary: "New kicking order rule; no playoffs section",
        effectiveOn: "2026-09-20",
        notice: false,
        today: TODAY,
        rulesPath: "/rules",
      });
      if (!second.ok) throw new Error(second.error);
      const after = await currentRules(db, w.leagueId);
      expect(after).toEqual([
        expect.objectContaining({
          slug: "lineups",
          title: "Kicking order",
          position: 0,
        }),
      ]);
      const log = await ruleChanges(db, w.leagueId);
      expect(log.map((c) => c.summary)).toEqual([
        "New kicking order rule; no playoffs section",
        "The first rules",
      ]);
      expect(log[0]).toMatchObject({
        effectiveOn: "2026-09-20",
        notice: false,
        changes: [
          {
            slug: "lineups",
            kind: "edited",
            titleBefore: "Lineups",
            before: "Sample: ten players field.",
            after: "Sample: new order rule.",
          },
          { slug: "playoffs", kind: "removed", after: null },
        ],
      });
      // The public log names the sections without their old text.
      expect((await changeLog(db, w.leagueId))[0]).toMatchObject({
        summary: "New kicking order rule; no playoffs section",
        effectiveOn: "2026-09-20",
        sections: [
          { slug: "lineups", kind: "edited", title: "Kicking order" },
          { slug: "playoffs", kind: "removed", title: "Playoffs" },
        ],
      });
      expect(
        JSON.stringify(await changeLog(db, w.leagueId)).includes("Sample:"),
      ).toBe(false);
      const audit = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.entityId, second.value.id));
      expect(audit).toEqual([{ action: "rules.publish" }]);
    });
  });

  it("refuses an editor opened before someone else's change", async () => {
    await inRolledBackDb(async (db) => {
      const { w } = await start(db);
      const [lineups, playoffs] = await currentRules(db, w.leagueId);
      if (!lineups || !playoffs) throw new Error("sections");
      const stale = await publishRuleChange(db, {
        leagueId: w.leagueId,
        actorId: w.aces.captain.userId,
        sections: [
          { ...lineups, body: "Sample: changed.", remove: false },
          { ...playoffs, remove: false },
        ],
        version: "",
        summary: "Late edit",
        effectiveOn: "",
        notice: false,
        today: TODAY,
        rulesPath: "/rules",
      });
      expect(stale).toEqual({ ok: false, error: "stale" });
      expect((await currentRules(db, w.leagueId))[0]?.body).toBe(
        "Sample: ten players field.",
      );
    });
  });

  it("tells every active player, once, when a change needs a notice", async () => {
    await inRolledBackDb(async (db) => {
      const { w, first } = await start(db);
      const [lineups, playoffs] = await currentRules(db, w.leagueId);
      if (!lineups || !playoffs) throw new Error("sections");
      const sections = [
        { ...lineups, body: "Sample: changed.", remove: false },
        { ...playoffs, remove: false },
      ];
      const base = {
        leagueId: w.leagueId,
        actorId: w.aces.captain.userId,
        sections,
        version: first.id,
        summary: "A new lineup rule",
        notice: true,
        today: TODAY,
        rulesPath: "/rules",
      };
      expect(
        await publishRuleChange(db, { ...base, effectiveOn: "2026-09-16" }),
      ).toEqual({ ok: false, error: "notice_too_soon" });

      // A completed season's players aren't told.
      await db.insert(season).values({
        leagueId: w.leagueId,
        name: "Spring 2026",
        slug: `spring-${w.tag}`,
        status: "completed",
        startsOn: "2026-04-01",
        endsOn: "2026-06-01",
        feeModel: "per_player",
        playerFeeCents: 8500,
        rosterMin: 1,
        rosterMax: 20,
      });
      const published = await publishRuleChange(db, {
        ...base,
        effectiveOn: "2026-09-17",
      });
      if (!published.ok) throw new Error(published.error);
      // Everyone registered for the open season, the cancelled one aside.
      expect(published.value.recipients).toBe(7);
      const sent = await db
        .select({ userId: message.userId, payload: message.payload })
        .from(message)
        .where(eq(message.template, "rule_change"));
      expect(sent).toHaveLength(7);
      expect(sent.map((m) => m.userId)).not.toContain(w.cancelled.userId);
      expect(sent[0]?.payload).toMatchObject({
        summary: "A new lineup rule",
        sections: ["Lineups"],
        effectiveOn: "Thursday, September 17, 2026",
        anchor: "lineups",
      });
      expect((await ruleChanges(db, w.leagueId))[0]).toMatchObject({
        notice: true,
        noticeRecipients: 7,
      });
    });
  });

  it("refuses to publish nothing", async () => {
    await inRolledBackDb(async (db) => {
      const { w, first } = await start(db);
      const rules = await currentRules(db, w.leagueId);
      expect(
        await publishRuleChange(db, {
          leagueId: w.leagueId,
          actorId: w.aces.captain.userId,
          sections: rules.map((r) => ({ ...r, remove: false })),
          version: first.id,
          summary: "Nothing",
          effectiveOn: "",
          notice: false,
          today: TODAY,
          rulesPath: "/rules",
        }),
      ).toEqual({ ok: false, error: "no_changes" });
      expect(await ruleChanges(db, w.leagueId)).toHaveLength(1);
    });
  });
});

describe("gameSettings", () => {
  it("shows the open season's divisions with their rule sets", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      expect(await gameSettings(db, w.leagueId)).toBeNull();
      const [social] = await db
        .insert(ruleSet)
        .values({
          leagueId: w.leagueId,
          name: "Social",
          innings: 5,
          timeLimitMinutes: 50,
          options: { bunting: false },
        })
        .returning({ id: ruleSet.id });
      await db.insert(division).values([
        {
          seasonId: w.season.id,
          name: "Social",
          slug: "social",
          ruleSetId: social?.id,
          sortOrder: 1,
        },
        { seasonId: w.season.id, name: "Open", slug: "open", sortOrder: 0 },
      ]);
      expect(await gameSettings(db, w.leagueId)).toEqual({
        seasonId: w.season.id,
        seasonName: w.season.name,
        divisions: [
          { name: "Open", ruleSet: null },
          {
            name: "Social",
            ruleSet: {
              name: "Social",
              innings: 5,
              timeLimitMinutes: 50,
              options: { bunting: false },
            },
          },
        ],
      });
    });
  });
});
