import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { LeagueId, UserId } from "@/domain/ids";
import {
  EMPTY_SEASON_FORM,
  parseSeasonForm,
  type SeasonSettings,
} from "@/domain/season/settings";
import { auditLog } from "../schema/audit";
import { user } from "../schema/auth";
import { league } from "../schema/league";
import { closePool, inRolledBackDb } from "../test/transaction";
import type { Db } from "./schedule";
import { createSeason, seasonSettings, updateSeason } from "./seasons";

afterAll(closePool);

const NY = "America/New_York";

function settings(
  form: Partial<typeof EMPTY_SEASON_FORM> = {},
): SeasonSettings {
  const parsed = parseSeasonForm(
    {
      ...EMPTY_SEASON_FORM,
      name: "Spring 2027",
      startsOn: "2027-04-05",
      endsOn: "2027-06-28",
      playerFee: "85",
      registrationOpensOn: "2027-02-01",
      registrationClosesOn: "2027-03-22",
      ...form,
    },
    NY,
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return parsed.value;
}

async function world(db: Db) {
  const tag = Math.random().toString(36).slice(2, 8);
  const [admin] = await db
    .insert(user)
    .values({ name: "Admin", email: `seasons-${tag}@example.test` })
    .returning({ id: user.id });
  const [lg] = await db
    .insert(league)
    .values({ name: "Test League", slug: `seasons-${tag}` })
    .returning({ id: league.id });
  return { actor: admin!.id as UserId, leagueId: lg!.id as LeagueId };
}

describe("seasons", () => {
  it("creates a draft season that the database accepts as entered", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const created = await createSeason(
        db,
        { leagueId: w.leagueId, settings: settings() },
        w.actor,
      );
      expect(created).toMatchObject({
        ok: true,
        value: { slug: "spring-2027" },
      });
      const stored = await seasonSettings(db, w.leagueId, "spring-2027");
      expect(stored).toMatchObject({
        status: "draft",
        playerFeeCents: 8500,
        feeModel: "per_player",
        gamesPerTeamPerDay: 1,
      });
      expect(stored?.registrationClosesAt?.toISOString()).toBe(
        "2027-03-23T03:59:59.999Z",
      );
      expect(
        await createSeason(
          db,
          { leagueId: w.leagueId, settings: settings() },
          w.actor,
        ),
      ).toEqual({ ok: false, error: "duplicate" });
      // Another league may use the same slug.
      const other = await world(db);
      expect(
        (
          await createSeason(
            db,
            { leagueId: other.leagueId, settings: settings() },
            other.actor,
          )
        ).ok,
      ).toBe(true);
      expect(await seasonSettings(db, w.leagueId, "nope")).toBeNull();
    });
  });

  it("updates settings and status, auditing only what changed", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const created = await createSeason(
        db,
        { leagueId: w.leagueId, settings: settings() },
        w.actor,
      );
      if (!created.ok) throw new Error();
      const seasonId = created.value.id;
      const update = (
        s: SeasonSettings,
        status = "registration_open" as const,
      ) =>
        updateSeason(
          db,
          { leagueId: w.leagueId, seasonId, settings: s, status },
          w.actor,
        );

      expect(
        await update(settings({ playerFee: "90", gamesPerTeamPerDay: "2" })),
      ).toEqual({
        ok: true,
        value: { slug: "spring-2027" },
      });
      // Saving again with nothing changed writes no audit row.
      await update(settings({ playerFee: "90", gamesPerTeamPerDay: "2" }));
      const rows = await db
        .select({
          action: auditLog.action,
          before: auditLog.before,
          after: auditLog.after,
        })
        .from(auditLog)
        .where(eq(auditLog.entityId, seasonId))
        .orderBy(auditLog.action);
      expect(rows.map((r) => r.action)).toEqual([
        "season.create",
        "season.update",
      ]);
      expect(rows[1]?.before).toEqual({
        playerFeeCents: 8500,
        gamesPerTeamPerDay: 1,
        status: "draft",
      });
      expect(rows[1]?.after).toEqual({
        playerFeeCents: 9000,
        gamesPerTeamPerDay: 2,
        status: "registration_open",
      });

      await createSeason(
        db,
        { leagueId: w.leagueId, settings: settings({ name: "Summer 2027" }) },
        w.actor,
      );
      expect(await update(settings({ name: "Summer 2027" }))).toEqual({
        ok: false,
        error: "duplicate",
      });
      const renamed = await update(settings({ name: "Spring 2027 Mondays" }));
      expect(renamed).toEqual({
        ok: true,
        value: { slug: "spring-2027-mondays" },
      });
      const other = await world(db);
      expect(
        await updateSeason(
          db,
          {
            leagueId: other.leagueId,
            seasonId,
            settings: settings(),
            status: "draft",
          },
          other.actor,
        ),
      ).toEqual({ ok: false, error: "unknown_season" });
    });
  });
});
