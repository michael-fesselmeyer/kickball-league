import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { addRefereedGameSoon } from "../support/game-today";
import { pageAs } from "../support/personas";

/**
 * A game that loses its ref (issue #389), at phone width: Reese Ref drops a
 * game three hours out with a reason, the admins' game-day screen lists it
 * as needing a ref, and the first ref to tap "Take it" gets it back. Reese
 * is the demo's only ref, so nobody else is asked.
 */
test.use({ viewport: { width: 390, height: 844 } });

let soon: Awaited<ReturnType<typeof addRefereedGameSoon>>;

test.describe.serial("covering a game with no ref", () => {
  test.beforeAll(async () => {
    soon = await addRefereedGameSoon("Kickin' Chicken", "Red Rubber Ballers");
  });
  test.afterAll(async () => {
    await soon.remove();
  });

  test("a ref drops a game, admins see it needs a ref, and a ref takes it", async ({
    browser,
  }) => {
    const ref = await pageAs(browser, "Ref");
    await ref.goto("/app/referee");
    const game = ref.locator(`#game-${soon.gameId}`);
    await expect(game).toContainText("Kickin' Chicken vs Red Rubber Ballers");
    await game.getByText("Can’t make it?").click();
    await game.getByLabel("Why? Admins see this.").fill("Twisted an ankle");
    await expectNoAxeViolations(ref);
    await game.getByRole("button", { name: "Drop this game" }).click();
    await expect(ref.getByRole("status")).toHaveText(
      "You’re off that game. Admins can see it needs a ref.",
    );
    await expect(ref.locator(`#game-${soon.gameId}`)).toHaveCount(0);

    const admin = await pageAs(browser, "Admin");
    await admin.goto("/app/admin/today");
    const needing = admin.getByRole("region", {
      name: "No ref yet, starting within a day",
    });
    await expect(needing).toContainText(
      "Kickin' Chicken vs Red Rubber Ballers",
    );
    await expect(
      needing.getByRole("link", {
        name: "Find a ref for Kickin' Chicken vs Red Rubber Ballers",
      }),
    ).toBeVisible();
    await expectNoAxeViolations(admin);

    // The link in the "Can you ref this game?" message.
    await ref.goto(`/app/referee/take/${soon.gameId}`);
    await expect(ref.getByRole("heading", { level: 1 })).toHaveText(
      "Kickin' Chicken vs Red Rubber Ballers",
    );
    await expectNoAxeViolations(ref);
    await ref.getByRole("button", { name: "Take it" }).click();
    await expect(ref.getByRole("status")).toContainText(
      "It’s yours. Thanks for stepping in!",
    );
    await expect(ref.getByRole("button", { name: "Take it" })).toHaveCount(0);

    await admin.reload();
    await expect(
      admin.getByRole("link", {
        name: "Find a ref for Kickin' Chicken vs Red Rubber Ballers",
      }),
    ).toHaveCount(0);
    await ref.context().close();
    await admin.context().close();
  });

  test("only refs can open a take page", async ({ browser }) => {
    const player = await pageAs(browser, "Player");
    await player.goto(`/app/referee/take/${soon.gameId}`);
    await expect(
      player.getByRole("heading", { name: "We can't find that page" }),
    ).toBeVisible();
    await player.context().close();
  });
});
