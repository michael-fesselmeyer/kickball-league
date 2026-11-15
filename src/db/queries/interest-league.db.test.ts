import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { InterestOptionId } from "@/domain/ids";
import { user } from "../schema/auth";
import { ruleSet } from "../schema/division";
import { interestForm, interestOption } from "../schema/interest";
import { league } from "../schema/league";
import { season } from "../schema/season";
import { closePool, inRolledBackDb } from "../test/transaction";
import { openedLeagues, openLeagueFromOption } from "./interest-league";
import { required } from "./rows";
import type { Db } from "./schedule";

afterAll(closePool);

const one = <T>(rows: T[], what: string): T => required(rows[0], what);

async function world(db: Db) {
  const tag = Math.random().toString(36).slice(2, 8);
  const operator = one(
    await db
      .insert(user)
      .values({ name: "Operator", email: `open-${tag}@example.test` })
      .returning({ id: user.id }),
    "user",
  ).id;
  const asking = one(
    await db
      .insert(league)
      .values({
        name: "Kickball",
        slug: `ask-${tag}`,
        minimumAge: 21,
        timezone: "America/New_York",
        branding: { primaryColor: "#123456", secondaryColor: "#ABCDEF" },
      })
      .returning({ id: league.id }),
    "league",
  );
  await db.insert(season).values({
    leagueId: asking.id,
    name: "Fall",
    slug: "fall",
    startsOn: "2026-09-01",
    endsOn: "2026-11-01",
    feeModel: "per_player",
    playerFeeCents: 8500,
    rosterMin: 12,
    rosterMax: 22,
  });
  const form = one(
    await db
      .insert(interestForm)
      .values({ leagueId: asking.id, title: "Where next?", teamsNeeded: 6 })
      .returning({ id: interestForm.id }),
    "form",
  );
  const option = one(
    await db
      .insert(interestOption)
      .values({
        formId: form.id,
        night: "tuesday",
        park: `Park ${tag}`,
      })
      .returning({ id: interestOption.id }),
    "option",
  ).id;
  return { operator, askingId: asking.id, option, tag };
}

describe("opening a league from an interest option", () => {
  it("makes a league with a draft season from the option, once", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const opened = await openLeagueFromOption(db, {
        optionId: w.option,
        sport: "kickball",
        actorId: w.operator,
        today: "2026-11-15",
      });
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      expect(opened.value.name).toBe(`Tuesday Kickball at Park ${w.tag}`);
      const [made] = await db
        .select({
          sport: league.sport,
          minimumAge: league.minimumAge,
          branding: league.branding,
          isDefault: league.isDefault,
        })
        .from(league)
        .where(eq(league.id, opened.value.leagueId));
      expect(made).toEqual({
        sport: "kickball",
        minimumAge: 21,
        branding: { primaryColor: "#123456", secondaryColor: "#ABCDEF" },
        isDefault: false,
      });
      const [draft] = await db
        .select({
          status: season.status,
          startsOn: season.startsOn,
          maxTeams: season.maxTeams,
          playerFeeCents: season.playerFeeCents,
          rosterMax: season.rosterMax,
        })
        .from(season)
        .where(eq(season.leagueId, opened.value.leagueId));
      // Not public until an admin opens registration; fees from the fall.
      expect(draft).toEqual({
        status: "draft",
        startsOn: "2026-12-29",
        maxTeams: 6,
        playerFeeCents: 8500,
        rosterMax: 22,
      });
      expect((await openedLeagues(db, [w.option])).get(w.option)).toMatchObject(
        { slug: opened.value.slug },
      );
      expect(
        await openLeagueFromOption(db, {
          optionId: w.option,
          sport: "kickball",
          actorId: w.operator,
          today: "2026-11-15",
        }),
      ).toEqual({ ok: false, error: "already_opened" });
    });
  });

  it("opens a dodgeball league with its match length", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const opened = await openLeagueFromOption(db, {
        optionId: w.option,
        sport: "dodgeball",
        actorId: w.operator,
        today: "2026-11-15",
      });
      if (!opened.ok) throw new Error(opened.error);
      const [rules] = await db
        .select({ bestOf: ruleSet.bestOf })
        .from(ruleSet)
        .where(eq(ruleSet.leagueId, opened.value.leagueId));
      expect(rules).toEqual({ bestOf: 5 });
    });
  });

  it("refuses an option that doesn't exist", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      expect(
        await openLeagueFromOption(db, {
          optionId: "00000000-0000-4000-8000-000000000000" as InterestOptionId,
          sport: "kickball",
          actorId: w.operator,
          today: "2026-11-15",
        }),
      ).toEqual({ ok: false, error: "not_found" });
    });
  });
});
