import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { expectNoAxeViolations } from "../support/axe";
import { adminTool, goViaMenu } from "../support/app-nav";
import { pageAs } from "../support/personas";

/**
 * Pick'em for bragging rights. An exhibition between two fall teams starts
 * 45 minutes from now, so it is on the coming game day and still open for
 * the whole flow. The demo player picks its winner, sees the pick saved and
 * the season leaderboard the seed's picks fill, hides from the leaderboards
 * and comes back; the game, and its picks with it, are removed at the end.
 * In a test of its own, an admin turns off picking your own team's games
 * and on again.
 */
const TEAM_A = "Sun Kickers";
const TEAM_B = "Base Invaders";

async function withDb<T>(body: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return await body(db);
  } finally {
    await db.end();
  }
}

/** An exhibition game in its own slot, starting 45 minutes from now. */
async function addGameSoon(): Promise<() => Promise<void>> {
  const ids = await withDb(async (db) => {
    const { rows } = await db.query<{ game: string; slot: string }>(
      `with teams as (
         select ts.id, t.name, s.id as season_id, s.league_id
           from team_season ts
           join team t on t.id = ts.team_id
           join season s on s.id = ts.season_id
          where s.slug = 'fall-2026' and t.name in ($1, $2)
       ), place as (
         select f.id as field_id from field f
           join venue v on v.id = f.venue_id
          where v.league_id = (select league_id from teams limit 1)
          order by f.name limit 1
       ), new_slot as (
         insert into slot (season_id, field_id, starts_at, ends_at, time_index)
         select season_id, (select field_id from place),
                date_trunc('minute', now()) + interval '45 minutes',
                date_trunc('minute', now()) + interval '105 minutes', 0
           from teams limit 1
         returning id, season_id
       )
       insert into game (season_id, team_a_id, team_b_id, kind, slot_id)
       select new_slot.season_id,
              (select id from teams where name = $1),
              (select id from teams where name = $2),
              'exhibition', new_slot.id
         from new_slot
       returning id as game, slot_id as slot`,
      [TEAM_A, TEAM_B],
    );
    const [row] = rows;
    if (!row) throw new Error(`Could not add ${TEAM_A} vs ${TEAM_B}`);
    return row;
  });
  return () =>
    withDb(async (db) => {
      await db.query("delete from game where id = $1", [ids.game]);
      await db.query("delete from slot where id = $1", [ids.slot]);
    });
}

test("a player picks the coming game day's winner, for bragging rights only", async ({
  browser,
}) => {
  const removeGame = await addGameSoon();
  try {
    const player = await pageAs(browser, "Player");
    await player.goto("/app");
    await goViaMenu(player, "Pick'em");
    await expect(
      player.getByRole("heading", { name: "Pick'em", level: 1 }),
    ).toBeVisible();
    await expect(
      player.getByText("no money, no entry fee, no bets and no prizes"),
    ).toBeVisible();
    await expectNoAxeViolations(player);

    const card = player.getByRole("group", {
      name: `${TEAM_A} vs ${TEAM_B}`,
    });
    await card.getByLabel(TEAM_B).check();
    await player.getByRole("button", { name: "Save picks" }).click();
    await expect(player.getByRole("status")).toContainText("Picks saved");
    await expect(card.getByLabel(TEAM_B)).toBeChecked();

    // The seed's picks on the played game days fill the season's board.
    const board = player.getByRole("table").first();
    await expect(board.getByRole("row").nth(1)).toContainText("1st");

    await player
      .getByRole("button", { name: "Hide me from the leaderboards" })
      .click();
    await expect(player.getByRole("status")).toContainText(
      "You're off the leaderboards",
    );
    await expect(
      player.getByText("You're hidden from the leaderboards."),
    ).toBeVisible();
    await expectNoAxeViolations(player);
    await player
      .getByRole("button", { name: "Show me on the leaderboards" })
      .click();
    await expect(player.getByRole("status")).toContainText(
      "You're back on the leaderboards",
    );
    await player.context().close();
  } finally {
    await removeGame();
  }
});

test("an admin keeps players off their own team's games, and lets them back", async ({
  browser,
}) => {
  try {
    const admin = await pageAs(browser, "Admin");
    await admin.goto("/app/admin");
    await (await adminTool(admin, "Pick'em")).click();
    await expect(
      admin.getByRole("heading", { name: "Pick'em settings" }),
    ).toBeVisible();
    await admin
      .getByRole("button", { name: "Keep players off their own team's games" })
      .click();
    await expect(admin.getByRole("status")).toContainText("Saved.");
    await expect(
      admin.getByText("Players can't pick their own team's games"),
    ).toBeVisible();
    await expectNoAxeViolations(admin);
    await admin
      .getByRole("button", { name: "Let players pick their own team's games" })
      .click();
    await expect(
      admin.getByText("Players may pick their own team's games"),
    ).toBeVisible();
    await admin.context().close();
  } finally {
    // Back to the league's default, whatever step a failure stopped at.
    await withDb((db) => db.query("update league set pickem_own_games = true"));
  }
});
