import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { searchTerms } from "@/domain/rules/rulebook";
import { planImport, splitRulebook } from "@/domain/rules/rulebook-import";
import { SAMPLE_RULEBOOK } from "@/domain/rules/sample-rulebook";
import { auditLog } from "../schema/audit";
import { messagingWorld } from "../test/messaging-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import {
  changeLog,
  currentRules,
  publishRuleChange,
  rulebookVisibility,
  rulesVersion,
  searchSections,
  setRulebookVisibility,
} from "./rules";
import type { Db } from "./schedule";

afterAll(closePool);

const TODAY = "2026-09-14";

async function importSample(db: Db) {
  const w = await messagingWorld(db);
  const imported = splitRulebook(SAMPLE_RULEBOOK).sections;
  const result = await publishRuleChange(db, {
    leagueId: w.leagueId,
    actorId: w.aces.captain.userId,
    sections: planImport(await currentRules(db, w.leagueId), imported),
    version: await rulesVersion(db, w.leagueId),
    summary: "Added the rulebook",
    effectiveOn: "",
    notice: false,
    today: TODAY,
    rulesPath: "/rules",
  });
  if (!result.ok) throw new Error(result.error);
  return w;
}

describe("rulebook visibility", () => {
  it("starts owners only and changes with an audit entry", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      expect(await rulebookVisibility(db, w.leagueId)).toBe("owners");
      const actorId = w.aces.captain.userId;
      expect(
        await setRulebookVisibility(db, {
          leagueId: w.leagueId,
          actorId,
          visibility: "public",
        }),
      ).toEqual({ changed: true });
      expect(await rulebookVisibility(db, w.leagueId)).toBe("public");
      // The same value again writes nothing.
      expect(
        await setRulebookVisibility(db, {
          leagueId: w.leagueId,
          actorId,
          visibility: "public",
        }),
      ).toEqual({ changed: false });
      const audit = await db
        .select({ action: auditLog.action, after: auditLog.after })
        .from(auditLog)
        .where(eq(auditLog.entityId, w.leagueId));
      expect(audit.filter((a) => a.action === "rules.visibility")).toEqual([
        { action: "rules.visibility", after: { visibility: "public" } },
      ]);
    });
  });
});

describe("importing the sample rulebook", () => {
  it("saves its sections and records one dated change", async () => {
    await inRolledBackDb(async (db) => {
      const w = await importSample(db);
      const rules = await currentRules(db, w.leagueId);
      expect(rules.map((r) => r.slug)).toEqual([
        "introduction",
        "teams-and-lineups",
        "pitching",
        "kicking-and-running",
        "fielding",
        "scoring-and-mercy",
        "playoffs",
      ]);
      const log = await changeLog(db, w.leagueId);
      expect(log).toHaveLength(1);
      expect(log[0]?.summary).toBe("Added the rulebook");
      expect(log[0]?.sections.every((s) => s.kind === "added")).toBe(true);
    });
  });

  it("a second import edits matching sections and keeps their anchors", async () => {
    await inRolledBackDb(async (db) => {
      const w = await importSample(db);
      const before = await currentRules(db, w.leagueId);
      const next = splitRulebook(
        SAMPLE_RULEBOOK.replace("fifty minutes", "forty minutes"),
      ).sections.filter((s) => s.title !== "Playoffs");
      const result = await publishRuleChange(db, {
        leagueId: w.leagueId,
        actorId: w.aces.captain.userId,
        sections: planImport(before, next),
        version: await rulesVersion(db, w.leagueId),
        summary: "Shorter games",
        effectiveOn: "",
        notice: false,
        today: TODAY,
        rulesPath: "/rules",
      });
      if (!result.ok) throw new Error(result.error);
      const after = await currentRules(db, w.leagueId);
      expect(after.find((s) => s.slug === "scoring-and-mercy")?.body).toContain(
        "forty minutes",
      );
      expect(after.map((s) => s.slug)).not.toContain("playoffs");
      const [latest] = await changeLog(db, w.leagueId);
      expect(latest?.sections).toEqual([
        {
          slug: "scoring-and-mercy",
          kind: "edited",
          title: "Scoring and mercy",
        },
        { slug: "playoffs", kind: "removed", title: "Playoffs" },
      ]);
    });
  });

  it("refuses an import made from a stale version", async () => {
    await inRolledBackDb(async (db) => {
      const w = await importSample(db);
      const result = await publishRuleChange(db, {
        leagueId: w.leagueId,
        actorId: w.aces.captain.userId,
        sections: planImport([], [{ title: "Anything", body: "x" }]),
        version: "",
        summary: "Late",
        effectiveOn: "",
        notice: false,
        today: TODAY,
        rulesPath: "/rules",
      });
      expect(result).toEqual({ ok: false, error: "stale" });
    });
  });
});

describe("searchSections", () => {
  it("finds sections with every word, as prefixes and stems", async () => {
    await inRolledBackDb(async (db) => {
      const w = await importSample(db);
      const slugs = async (q: string) =>
        (await searchSections(db, w.leagueId, searchTerms(q))).map(
          (r) => r.slug,
        );
      expect(await slugs("bunting")).toEqual(["kicking-and-running"]);
      expect(await slugs("bunt")).toEqual(["kicking-and-running"]);
      expect(await slugs("foul runners")).toEqual(["kicking-and-running"]);
      expect(await slugs("ball")).toEqual(
        expect.arrayContaining(["pitching", "kicking-and-running", "fielding"]),
      );
      expect(await slugs("zeppelin")).toEqual([]);
      expect(await slugs("!!")).toEqual([]);
    });
  });

  it("ranks a title match above a body match", async () => {
    await inRolledBackDb(async (db) => {
      const w = await importSample(db);
      // "kick" is in one section's title and in other sections' text.
      const rows = await searchSections(db, w.leagueId, ["kick"]);
      expect(rows[0]?.slug).toBe("kicking-and-running");
      expect(rows.length).toBeGreaterThan(1);
      expect(rows[0]?.rank).toBeGreaterThan(rows[1]?.rank ?? 0);
    });
  });

  it("is scoped to the league", async () => {
    await inRolledBackDb(async (db) => {
      await importSample(db);
      const other = "00000000-0000-4000-8000-000000000000" as never;
      expect(await searchSections(db, other, ["bunting"])).toEqual([]);
    });
  });
});
