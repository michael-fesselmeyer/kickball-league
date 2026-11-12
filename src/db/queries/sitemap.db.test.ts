import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { EMPTY_SEASON_FORM, parseSeasonForm } from "@/domain/season/settings";
import { user } from "../schema/auth";
import { league } from "../schema/league";
import { season } from "../schema/season";
import { closePool, inRolledBackDb } from "../test/transaction";
import { createSeason } from "./seasons";
import { publicSeasons } from "./sitemap";

afterAll(closePool);

function settings(name: string, startsOn: string, endsOn: string) {
  const parsed = parseSeasonForm(
    {
      ...EMPTY_SEASON_FORM,
      name,
      startsOn,
      endsOn,
      playerFee: "85",
      registrationOpensOn: "2027-01-04",
      registrationClosesOn: "2027-03-22",
    },
    "America/New_York",
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return parsed.value;
}

describe("publicSeasons", () => {
  it("lists every season except drafts, newest first", async () => {
    await inRolledBackDb(async (db) => {
      const tag = Math.random().toString(36).slice(2, 8);
      const [admin] = await db
        .insert(user)
        .values({ name: "Admin", email: `sitemap-${tag}@example.test` })
        .returning({ id: user.id });
      const [lg] = await db
        .insert(league)
        .values({ name: "Test League", slug: `sitemap-${tag}` })
        .returning({ id: league.id });
      const create = async (name: string, from: string, to: string) => {
        const made = await createSeason(
          db,
          { leagueId: lg!.id, settings: settings(name, from, to) },
          admin!.id,
        );
        if (!made.ok) throw new Error(made.error);
        return made.value;
      };
      const spring = await create(`Spring ${tag}`, "2027-04-05", "2027-06-28");
      const summer = await create(`Summer ${tag}`, "2027-07-11", "2027-08-29");
      await create(`Fall ${tag}`, "2027-09-14", "2027-11-02");
      for (const s of [spring, summer]) {
        await db
          .update(season)
          .set({ status: "registration_open" })
          .where(eq(season.id, s.id));
      }

      const slugs = (await publicSeasons(db)).map((s) => s.slug);
      const ours = slugs.filter((s) => s.endsWith(tag));
      expect(ours).toEqual([summer.slug, spring.slug]);
    });
  });
});
