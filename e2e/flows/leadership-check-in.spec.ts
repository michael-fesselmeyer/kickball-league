import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { expectNoAxeViolations } from "../support/axe";
import { type Member, memberPage } from "../support/people";
import { pageAs } from "../support/personas";

/**
 * The season-end leadership check-in (ADR 0091), at phone width. The flow
 * makes its own finished private season with one team of two made-up
 * people, so no other flow meets it: an admin opens check-ins, a player
 * checks in privately and puts themselves forward, and the admin sees only
 * how many took part, pauses it and closes it with no change, which the
 * player then sees. Everything it made is removed afterwards.
 */
test.use({ viewport: { width: 390, height: 844 } });

const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SLUG = `leadership-${tag}`;
const TEAM = `Check-in Testers ${tag}`;
const captain: Member = {
  first: "Cleo",
  last: "Captain",
  email: `leadership-cap-${tag}@example.test`,
};
const player: Member = {
  first: "Pat",
  last: "Player",
  email: `leadership-player-${tag}@example.test`,
};

async function withDb<T>(body: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return await body(db);
  } finally {
    await db.end();
  }
}

test.describe.serial("a team's season-end leadership check-in", () => {
  test.beforeAll(async ({ browser }) => {
    test.slow();
    // Make both accounts with full profiles, then put them on a team in a
    // finished private season of the default league.
    for (const member of [captain, player])
      await (await memberPage(browser, member)).context().close();
    await withDb(async (db) => {
      await db.query("begin");
      const {
        rows: [season],
      } = await db.query<{ id: string; league_id: string }>(
        `insert into season (league_id, name, slug, status, visibility, starts_on, ends_on, fee_model, roster_min, roster_max)
         select id, $1, $2, 'completed', 'private', current_date - 70, current_date - 7, 'per_player', 1, 20
           from league where is_default
         returning id, league_id`,
        [`Check-in Season ${tag}`, SLUG],
      );
      const {
        rows: [team],
      } = await db.query<{ id: string }>(
        `insert into team (league_id, name, slug) values ($1, $2, $3) returning id`,
        [season!.league_id, TEAM, `check-in-testers-${tag}`],
      );
      const {
        rows: [teamSeason],
      } = await db.query<{ id: string }>(
        `insert into team_season (team_id, season_id, status) values ($1, $2, 'confirmed') returning id`,
        [team!.id, season!.id],
      );
      for (const [member, role] of [
        [captain, "captain"],
        [player, "player"],
      ] as const)
        await db.query(
          `with r as (
             insert into registration (season_id, user_id, kind, status)
             select $1, id, 'team_member', 'active' from "user" where email = $2
             returning id
           )
           insert into roster_membership (team_season_id, registration_id, role, status)
           select $3, r.id, $4, 'active' from r`,
          [season!.id, member.email, teamSeason!.id, role],
        );
      await db.query("commit");
    });
  });

  test.afterAll(async () => {
    await withDb(async (db) => {
      await db.query("begin");
      await db.query(
        `delete from leadership_check_in where team_season_id in
           (select ts.id from team_season ts join season s on s.id = ts.season_id where s.slug = $1)`,
        [SLUG],
      );
      await db.query(
        `delete from roster_membership where team_season_id in
           (select ts.id from team_season ts join season s on s.id = ts.season_id where s.slug = $1)`,
        [SLUG],
      );
      await db.query(
        `delete from registration where season_id in (select id from season where slug = $1)`,
        [SLUG],
      );
      await db.query(
        `delete from team_season where season_id in (select id from season where slug = $1)`,
        [SLUG],
      );
      await db.query(`delete from team where name = $1`, [TEAM]);
      await db.query(`delete from season where slug = $1`, [SLUG]);
      await db.query("commit");
    });
  });

  test("an admin opens check-ins for the season", async ({ browser }) => {
    const admin = await pageAs(browser, "Admin");
    await admin.goto(`/app/admin/seasons/${SLUG}/leadership`);
    await expect(
      admin.getByRole("heading", { name: "Leadership check-ins", level: 1 }),
    ).toBeVisible();
    await expectNoAxeViolations(admin);
    await admin.getByRole("button", { name: "Open check-ins" }).click();
    await expect(admin.getByRole("status")).toHaveText(
      "Check-ins opened. Every roster has been told.",
    );
    await expect(
      admin.getByRole("listitem").filter({ hasText: TEAM }),
    ).toContainText("0 of 2 took part, 2 needed");
    await admin.context().close();
  });

  test("a player checks in privately and puts themselves forward", async ({
    browser,
  }) => {
    const page = await memberPage(browser, player);
    await page.goto(`/app/seasons/${SLUG}/team`);
    await page
      .getByRole("link", { name: /Leadership check-in: who'd you like/ })
      .click();
    await expect(
      page.getByRole("heading", { name: "Leadership check-in", level: 1 }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
    await page.getByLabel("I'd like to help as a co-captain").check();
    await page.getByRole("button", { name: "Check in" }).click();
    await expect(page.getByRole("status")).toHaveText(
      "Thanks for checking in. Only you know what you said.",
    );
    await expect(
      page.getByText("You put yourself forward as a co-captain."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Check in" })).toHaveCount(0);
    await page.context().close();
  });

  test("an admin sees only how many took part, pauses it and closes it", async ({
    browser,
  }) => {
    const admin = await pageAs(browser, "Admin");
    await admin.goto(`/app/admin/seasons/${SLUG}/leadership`);
    const row = admin.getByRole("listitem").filter({ hasText: TEAM });
    await expect(row).toContainText("1 of 2 took part");
    await expect(row).not.toContainText(player.first);
    await row.getByRole("button", { name: /^Pause/ }).click();
    await expect(admin.getByRole("status")).toHaveText(
      "Paused. Nobody can check in or vote until you resume.",
    );
    await admin
      .getByRole("listitem")
      .filter({ hasText: TEAM })
      .getByRole("button", { name: /^Close with no change/ })
      .click();
    await expect(admin.getByRole("status")).toHaveText(
      "Closed with no change. The team has been told.",
    );
    await expectNoAxeViolations(admin);
    await admin.context().close();
  });

  test("the captain sees the check-in is done, with no change", async ({
    browser,
  }) => {
    const page = await memberPage(browser, captain);
    await page.goto(`/app/seasons/${SLUG}/team/leadership`);
    await expect(
      page.getByRole("heading", { name: "Check-in done" }),
    ).toBeVisible();
    await expect(
      page.getByText("The league closed this check-in with no change."),
    ).toBeVisible();
    await expectNoAxeViolations(page);
    await page.context().close();
  });
});
