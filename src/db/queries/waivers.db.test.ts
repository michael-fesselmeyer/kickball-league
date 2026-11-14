import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { SeasonId, UserId } from "@/domain/ids";
import { hashWaiverBody } from "@/domain/waiver/waiver";
import { auditLog } from "../schema/audit";
import { user } from "../schema/auth";
import { league } from "../schema/league";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { registration } from "../schema/team";
import { closePool, inRolledBackDb } from "../test/transaction";
import type { Db } from "./schedule";
import {
  assignWaiver,
  hasSignedSeasonWaiver,
  publishWaiver,
  signWaiver,
  waiverForSeason,
  waiversOf,
} from "./waivers";

afterAll(closePool);

const BODY = `# Sample release\n\n${"This is sample text for tests only. ".repeat(8)}`;

async function world(db: Db) {
  const tag = Math.random().toString(36).slice(2, 8);
  const [admin, player] = await db
    .insert(user)
    .values([
      { name: "Admin", email: `waiver-admin-${tag}@example.test` },
      { name: "Robin", email: `waiver-player-${tag}@example.test` },
    ])
    .returning({ id: user.id });
  await db.insert(profile).values({
    userId: player!.id,
    firstName: "Robin",
    lastName: "Example",
  });
  const [lg] = await db
    .insert(league)
    .values({ name: "Test League", slug: `waiver-${tag}` })
    .returning({ id: league.id });
  const [sn] = await db
    .insert(season)
    .values({
      leagueId: lg!.id,
      name: "Spring",
      slug: "spring",
      startsOn: "2027-04-05",
      endsOn: "2027-06-28",
      feeModel: "per_player",
      playerFeeCents: 8500,
      rosterMin: 12,
      rosterMax: 20,
    })
    .returning({ id: season.id });
  return {
    admin: admin!.id,
    player: player!.id,
    leagueId: lg!.id,
    seasonId: sn!.id,
  };
}

const sign = (
  db: Db,
  w: { player: UserId; seasonId: SeasonId },
  change: Partial<Parameters<typeof signWaiver>[1]> = {},
) =>
  signWaiver(db, {
    ageConfirmed: true,
    userId: w.player,
    seasonId: w.seasonId,
    shownSha256: hashWaiverBody(BODY),
    agreed: true,
    signedName: "robin  example",
    ip: "203.0.113.7",
    userAgent: "test",
    ...change,
  });

describe("waivers", () => {
  it("publishes numbered versions and refuses a short text", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      expect(
        await publishWaiver(
          db,
          { leagueId: w.leagueId, title: "Release", body: "too short" },
          w.admin,
        ),
      ).toEqual({ ok: false, error: { body: expect.any(String) } });
      const first = await publishWaiver(
        db,
        { leagueId: w.leagueId, title: "Release", body: BODY },
        w.admin,
      );
      const second = await publishWaiver(
        db,
        { leagueId: w.leagueId, title: "Release v2", body: `${BODY} More.` },
        w.admin,
      );
      expect(first).toMatchObject({ ok: true, value: { version: 1 } });
      expect(second).toMatchObject({ ok: true, value: { version: 2 } });
      const list = await waiversOf(db, w.leagueId);
      expect(list.map((x) => x.version)).toEqual([2, 1]);
      expect(list[1]?.bodySha256).toBe(hashWaiverBody(BODY));
    });
  });

  it("signs the season's waiver once, moving a registration on to payment", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      expect(await sign(db, w)).toEqual({ ok: false, error: "no_waiver" });
      const published = await publishWaiver(
        db,
        { leagueId: w.leagueId, title: "Release", body: BODY },
        w.admin,
      );
      if (!published.ok) throw new Error();
      expect(
        await assignWaiver(
          db,
          {
            leagueId: w.leagueId,
            seasonId: w.seasonId,
            waiverId: published.value.id,
          },
          w.admin,
        ),
      ).toEqual({ ok: true, value: undefined });
      const [entry] = await db
        .insert(registration)
        .values({ seasonId: w.seasonId, userId: w.player, kind: "free_agent" })
        .returning({ id: registration.id });

      expect(
        await sign(db, w, { shownSha256: hashWaiverBody("other") }),
      ).toEqual({ ok: false, error: "changed" });
      expect(await sign(db, w, { agreed: false })).toEqual({
        ok: false,
        error: "not_agreed",
      });
      expect(await sign(db, w, { signedName: "Sam Example" })).toEqual({
        ok: false,
        error: "name_mismatch",
      });
      expect(await hasSignedSeasonWaiver(db, w.player, w.seasonId)).toBe(false);

      const signed = await sign(db, w);
      expect(signed.ok).toBe(true);
      expect(await sign(db, w)).toEqual({ ok: false, error: "already_signed" });
      expect(await hasSignedSeasonWaiver(db, w.player, w.seasonId)).toBe(true);
      const [after] = await db
        .select({
          status: registration.status,
          sig: registration.waiverSignatureId,
        })
        .from(registration)
        .where(eq(registration.id, entry!.id));
      expect(after).toEqual({
        status: "pending_payment",
        sig: signed.ok ? signed.value : null,
      });
      const view = await waiverForSeason(db, {
        leagueId: w.leagueId,
        slug: "spring",
        userId: w.player,
      });
      expect(view?.signature?.signedName).toBe("robin example");

      // A new version means signing again; the old signature stays.
      const v2 = await publishWaiver(
        db,
        { leagueId: w.leagueId, title: "Release", body: `${BODY} Updated.` },
        w.admin,
      );
      if (!v2.ok) throw new Error();
      await assignWaiver(
        db,
        { leagueId: w.leagueId, seasonId: w.seasonId, waiverId: v2.value.id },
        w.admin,
      );
      expect(await hasSignedSeasonWaiver(db, w.player, w.seasonId)).toBe(false);
      expect(
        (
          await waiverForSeason(db, {
            leagueId: w.leagueId,
            slug: "spring",
            userId: w.player,
          })
        )?.signature,
      ).toBeNull();
    });
  });

  it("needs a complete profile, and keeps waivers inside their league", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const published = await publishWaiver(
        db,
        { leagueId: w.leagueId, title: "Release", body: BODY },
        w.admin,
      );
      if (!published.ok) throw new Error();
      await assignWaiver(
        db,
        {
          leagueId: w.leagueId,
          seasonId: w.seasonId,
          waiverId: published.value.id,
        },
        w.admin,
      );
      await db
        .update(profile)
        .set({ lastName: null })
        .where(eq(profile.userId, w.player));
      expect(await sign(db, w)).toEqual({
        ok: false,
        error: "profile_incomplete",
      });

      const other = await world(db);
      expect(
        await assignWaiver(
          db,
          {
            leagueId: other.leagueId,
            seasonId: other.seasonId,
            waiverId: published.value.id,
          },
          other.admin,
        ),
      ).toEqual({ ok: false, error: "unknown_waiver" });
      expect(
        await assignWaiver(
          db,
          { leagueId: other.leagueId, seasonId: w.seasonId, waiverId: null },
          other.admin,
        ),
      ).toEqual({ ok: false, error: "unknown_season" });
      // Assigning the same version again writes no audit row.
      await assignWaiver(
        db,
        {
          leagueId: w.leagueId,
          seasonId: w.seasonId,
          waiverId: published.value.id,
        },
        w.admin,
      );
      const rows = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.actorId, w.admin))
        .orderBy(auditLog.action);
      expect(rows.map((r) => r.action)).toEqual([
        "season.assign_waiver",
        "waiver.publish",
      ]);
      expect(
        await waiverForSeason(db, {
          leagueId: w.leagueId,
          slug: "nope",
          userId: w.player,
        }),
      ).toBeNull();
    });
  });
});
