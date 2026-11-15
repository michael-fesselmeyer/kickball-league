import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  DEFAULT_CONDUCT_BODY,
  hashConductBody,
} from "@/domain/conduct/conduct";
import type { LeagueId, UserId } from "@/domain/ids";
import { hashWaiverBody } from "@/domain/waiver/waiver";
import { auditLog } from "../schema/audit";
import { conductAcceptance } from "../schema/conduct";
import { profile } from "../schema/profile";
import { messagingWorld } from "../test/messaging-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import {
  acceptConduct,
  conductForPerson,
  conductVersions,
  currentConductCode,
  myConductAcceptances,
  publishConductCode,
  teamAcceptance,
} from "./conduct";
import { required } from "./rows";
import type { Db } from "./schedule";
import { assignWaiver, publishWaiver, signWaiver } from "./waivers";

afterAll(closePool);

const WAIVER = `# Release\n\n${"Sample waiver text for tests only. ".repeat(8)}`;
const UNKNOWN_TEXT = "0".repeat(64);

const publish = (
  db: Db,
  leagueId: LeagueId,
  admin: UserId,
  body = DEFAULT_CONDUCT_BODY,
) =>
  publishConductCode(db, { leagueId, title: "Code of conduct", body }, admin);

describe("publishing the code", () => {
  it("numbers versions, keeps the old ones, audits, and refuses a short text", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const admin = w.aces.captain.userId;
      expect(await currentConductCode(db, w.leagueId)).toBeNull();
      expect(
        await publishConductCode(
          db,
          { leagueId: w.leagueId, title: "Code", body: "short" },
          admin,
        ),
      ).toEqual({ ok: false, error: { body: expect.any(String) } });
      const first = await publish(db, w.leagueId, admin);
      const second = await publish(
        db,
        w.leagueId,
        admin,
        `${DEFAULT_CONDUCT_BODY}\n\n# Extra\n- One more.`,
      );
      expect(first).toMatchObject({ ok: true, value: { version: 1 } });
      expect(second).toMatchObject({ ok: true, value: { version: 2 } });
      expect((await currentConductCode(db, w.leagueId))?.version).toBe(2);
      const versions = await conductVersions(db, w.leagueId);
      expect(versions.map((v) => v.version)).toEqual([2, 1]);
      expect(versions[1]?.bodySha256).toBe(
        hashConductBody(DEFAULT_CONDUCT_BODY),
      );
      const audit = await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, "conduct.publish"));
      expect(audit).toHaveLength(2);
    });
  });
});

describe("accepting the code", () => {
  it("asks nothing when the league has no code", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const p = required(w.aces.players[0], "a player");
      expect(await conductForPerson(db, w.leagueId, p.userId)).toBeNull();
      expect(
        await acceptConduct(db, {
          leagueId: w.leagueId,
          seasonId: w.season.id,
          userId: p.userId,
          accepted: false,
          shownSha256: "",
        }),
      ).toEqual({ ok: true, value: undefined });
    });
  });

  it("needs the box ticked for the version shown, records it once, and does not ask again", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const admin = w.aces.captain.userId;
      const p = required(w.aces.players[0], "a player");
      await publish(db, w.leagueId, admin);
      const code = required(await currentConductCode(db, w.leagueId), "code");
      const input = {
        leagueId: w.leagueId,
        seasonId: w.season.id,
        userId: p.userId,
      };
      expect(
        await acceptConduct(db, {
          ...input,
          accepted: false,
          shownSha256: code.bodySha256,
        }),
      ).toEqual({ ok: false, error: "conduct_not_accepted" });
      // A version replaced while the person was reading is not accepted.
      expect(
        await acceptConduct(db, {
          ...input,
          accepted: true,
          shownSha256: UNKNOWN_TEXT,
        }),
      ).toEqual({ ok: false, error: "conduct_changed" });
      expect(
        await acceptConduct(db, {
          ...input,
          accepted: true,
          shownSha256: code.bodySha256,
        }),
      ).toEqual({ ok: true, value: undefined });
      expect(
        (await conductForPerson(db, w.leagueId, p.userId))?.acceptedAt,
      ).not.toBeNull();
      // Accepted before: not asked again, whatever the form says.
      expect(
        await acceptConduct(db, { ...input, accepted: false, shownSha256: "" }),
      ).toEqual({ ok: true, value: undefined });
      expect(
        await db
          .select()
          .from(conductAcceptance)
          .where(eq(conductAcceptance.userId, p.userId)),
      ).toHaveLength(1);

      // A new version is asked again.
      await publish(
        db,
        w.leagueId,
        admin,
        `${DEFAULT_CONDUCT_BODY}\n\n# More\n- Be kind.`,
      );
      expect(
        (await conductForPerson(db, w.leagueId, p.userId))?.acceptedAt,
      ).toBeNull();
      expect(
        await acceptConduct(db, { ...input, accepted: false, shownSha256: "" }),
      ).toMatchObject({ ok: false });
    });
  });

  it("shows each team who accepted the current version, and exports a person's own", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const admin = w.aces.captain.userId;
      const p = required(w.aces.players[0], "a player");
      expect(await teamAcceptance(db, w.leagueId, w.season.id)).toEqual({
        code: null,
        teams: [],
      });
      await publish(db, w.leagueId, admin);
      const code = required(await currentConductCode(db, w.leagueId), "code");
      await acceptConduct(db, {
        leagueId: w.leagueId,
        seasonId: w.season.id,
        userId: p.userId,
        accepted: true,
        shownSha256: code.bodySha256,
      });
      const view = await teamAcceptance(db, w.leagueId, w.season.id);
      const aces = required(
        view.teams.find((t) => t.teamName === "Aces"),
        "the Aces",
      );
      expect(aces.players.find((x) => x.userId === p.userId)?.accepted).toBe(
        true,
      );
      expect(aces.players.some((x) => !x.accepted)).toBe(true);
      const mine = await myConductAcceptances(db, p.userId);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({
        version: 1,
        textFingerprint: code.bodySha256,
      });
      expect(await myConductAcceptances(db, admin)).toEqual([]);
    });
  });
});

describe("signing the waiver with a code in force", () => {
  it("signs nothing without the box, and with it accepts the code with the signature", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const admin = w.aces.captain.userId;
      const p = required(w.bees.players[0], "a player");
      await db
        .insert(profile)
        .values({ userId: p.userId, firstName: "Robin", lastName: "Example" })
        .onConflictDoUpdate({
          target: profile.userId,
          set: { firstName: "Robin", lastName: "Example" },
        });
      const waiver = await publishWaiver(
        db,
        { leagueId: w.leagueId, title: "Release", body: WAIVER },
        admin,
      );
      expect(waiver.ok).toBe(true);
      if (!waiver.ok) return;
      await assignWaiver(
        db,
        {
          leagueId: w.leagueId,
          seasonId: w.season.id,
          waiverId: waiver.value.id,
        },
        admin,
      );
      await publish(db, w.leagueId, admin);
      const code = required(await currentConductCode(db, w.leagueId), "code");
      const base = {
        userId: p.userId,
        seasonId: w.season.id,
        shownSha256: hashWaiverBody(WAIVER),
        agreed: true,
        ageConfirmed: true,
        signedName: "Robin Example",
        ip: null,
        userAgent: null,
      };
      expect(await signWaiver(db, base)).toEqual({
        ok: false,
        error: "conduct_not_accepted",
      });
      expect(
        await signWaiver(db, {
          ...base,
          conduct: { accepted: true, shownSha256: UNKNOWN_TEXT },
        }),
      ).toEqual({ ok: false, error: "conduct_changed" });
      expect(
        await signWaiver(db, {
          ...base,
          conduct: { accepted: true, shownSha256: code.bodySha256 },
        }),
      ).toMatchObject({ ok: true });
      const accepted = await db
        .select()
        .from(conductAcceptance)
        .where(
          and(
            eq(conductAcceptance.userId, p.userId),
            eq(conductAcceptance.codeId, code.id),
          ),
        );
      expect(accepted).toHaveLength(1);
      expect(accepted[0]?.seasonId).toBe(w.season.id);
    });
  });
});
