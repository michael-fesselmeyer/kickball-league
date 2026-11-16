import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { addGameTodayWithPlayer } from "../support/game-today";
import { type Member, memberPage } from "../support/people";
import { pageAs } from "../support/personas";

/**
 * Assigning a ref who plays in the game (issue #296), at phone width: the
 * admin is warned first and assigns a player on The Big Kicks to a Big
 * Kicks game only by ticking the override, then takes the ref off again.
 * The player and the game belong to this flow alone (a private season of
 * its own), so no seeded person is a ref while other flows check who has a
 * ref page.
 */
test.use({ viewport: { width: 390, height: 844 } });

const player: Member = {
  first: "Rory",
  last: "Twoway",
  email: "rory.twoway@example.test",
};

let today: Awaited<ReturnType<typeof addGameTodayWithPlayer>>;

test.describe.serial("a ref on one of the teams", () => {
  test.beforeAll(async ({ browser }) => {
    const page = await memberPage(browser, player);
    await page.context().close();
    today = await addGameTodayWithPlayer(
      "The Big Kicks",
      "Red Rubber Ballers",
      player.email,
    );
  });
  test.afterAll(async () => {
    await today.remove();
  });

  test("an admin is warned, then assigns them with the override", async ({
    browser,
  }) => {
    const admin = await pageAs(browser, "Admin");
    await admin.goto(`/app/admin/seasons/${today.slug}/referees`);
    const game = admin.locator(`#game-${today.gameId}`);
    await game.getByLabel(/^Referee's email for/).fill(player.email);
    await game.getByRole("button", { name: "Assign" }).click();
    // Next's empty route announcer is an alert too, so pick ours by its text.
    await expect(
      admin
        .getByRole("alert")
        .filter({ hasText: "They play for one of those teams" }),
    ).toBeVisible();
    const again = admin.locator(`#game-${today.gameId}`);
    const override = again.getByLabel(/They play in this game/);
    await expect(override).not.toBeChecked();
    await expectNoAxeViolations(admin);

    await again.getByLabel(/^Referee's email for/).fill(player.email);
    await override.check();
    await again.getByRole("button", { name: "Assign" }).click();
    await expect(admin.getByRole("status")).toContainText("Referee assigned");
    await expect(admin.locator(`#game-${today.gameId}`)).toContainText(
      `${player.first} ${player.last}`,
    );
    await admin
      .locator(`#game-${today.gameId}`)
      .getByRole("button", { name: /^Remove the referee from/ })
      .click();
    await expect(admin.getByRole("status")).toContainText("Referee removed");
    await admin.context().close();
  });
});
