import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { MakerFields } from "@/domain/shirts/makers";
import { auditLog } from "../schema/audit";
import { leagueWorld } from "../test/league-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import {
  createMaker,
  removeMaker,
  shirtMakers,
  updateMaker,
} from "./shirt-makers";

afterAll(closePool);

const corner: MakerFields = {
  name: "Corner Print Shop",
  url: "https://cornerprint.example.test/",
  makes: "Custom jerseys and team t-shirts",
  minimumOrder: 12,
};

describe("the shirt makers directory", () => {
  it("lists makers by name, each league its own", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      const other = await leagueWorld(db);
      await createMaker(db, {
        leagueId: w.leagueId,
        fields: corner,
        actorId: w.admin,
      });
      await createMaker(db, {
        leagueId: w.leagueId,
        fields: { ...corner, name: "Another Press", minimumOrder: null },
        actorId: w.admin,
      });
      expect((await shirtMakers(db, w.leagueId)).map((m) => m.name)).toEqual([
        "Another Press",
        "Corner Print Shop",
      ]);
      expect(await shirtMakers(db, other.leagueId)).toEqual([]);
    });
  });

  it("refuses a second maker with the same name, ignoring case", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      await createMaker(db, {
        leagueId: w.leagueId,
        fields: corner,
        actorId: w.admin,
      });
      const again = await createMaker(db, {
        leagueId: w.leagueId,
        fields: { ...corner, name: "corner print shop" },
        actorId: w.admin,
      });
      expect(again).toEqual({ ok: false, error: "name_taken" });
    });
  });

  it("updates a maker, and the database itself refuses a plain-http link", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      const made = await createMaker(db, {
        leagueId: w.leagueId,
        fields: corner,
        actorId: w.admin,
      });
      if (!made.ok) throw new Error("not made");
      expect(
        await updateMaker(db, {
          leagueId: w.leagueId,
          id: made.value,
          fields: { ...corner, minimumOrder: 24 },
          actorId: w.admin,
        }),
      ).toEqual({ ok: true, value: null });
      expect((await shirtMakers(db, w.leagueId))[0]?.minimumOrder).toBe(24);
      await expect(
        updateMaker(db, {
          leagueId: w.leagueId,
          id: made.value,
          fields: { ...corner, url: "http://cornerprint.example.test/" },
          actorId: w.admin,
        }),
      ).rejects.toThrow();
    });
  });

  it("removes a maker for good, keeps what it said in the audit log, and refuses a second removal", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      const made = await createMaker(db, {
        leagueId: w.leagueId,
        fields: corner,
        actorId: w.admin,
      });
      if (!made.ok) throw new Error("not made");
      const remove = () =>
        removeMaker(db, {
          leagueId: w.leagueId,
          id: made.value,
          actorId: w.admin,
        });
      expect(await remove()).toEqual({ ok: true, value: null });
      expect(await shirtMakers(db, w.leagueId)).toEqual([]);
      expect(await remove()).toEqual({ ok: false, error: "not_found" });
      const [row] = await db
        .select({ before: auditLog.before })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.entityId, made.value),
            eq(auditLog.action, "shirt_maker.remove"),
          ),
        );
      expect(row?.before).toMatchObject({ name: "Corner Print Shop" });
    });
  });

  it("will not remove another league's maker", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      const other = await leagueWorld(db);
      const made = await createMaker(db, {
        leagueId: w.leagueId,
        fields: corner,
        actorId: w.admin,
      });
      if (!made.ok) throw new Error("not made");
      expect(
        await removeMaker(db, {
          leagueId: other.leagueId,
          id: made.value,
          actorId: other.admin,
        }),
      ).toEqual({ ok: false, error: "not_found" });
      expect(await shirtMakers(db, w.leagueId)).toHaveLength(1);
    });
  });
});
