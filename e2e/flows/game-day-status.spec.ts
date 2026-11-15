import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";
import { addPublishedGameTomorrow } from "../support/published-game";
import { pageSignedInAs } from "../support/sign-in";

/**
 * Game-day status (issue #383), on a phone. A Summer 2026 game is placed
 * on its published schedule for tomorrow at 6 pm. The admin says the
 * league is watching the weather and will decide by 5 pm, then calls the
 * game off for a flooded field, then puts it back on. Each time the public
 * schedule, the game page and a player's home screen say so, with when it
 * was set.
 */
const PHONE = { width: 390, height: 844 };

test("an admin sets a game day to watching, then off, then on again", async ({
  browser,
}) => {
  test.slow();
  const game = await addPublishedGameTomorrow();
  const admin = await pageAs(browser, "Admin");
  await admin.setViewportSize(PHONE);
  const visitor = await (await browser.newContext()).newPage();
  await visitor.setViewportSize(PHONE);
  const player = await pageSignedInAs(browser, game.playerEmail);
  await player.setViewportSize(PHONE);
  const page = `/app/admin/seasons/summer-2026/status?date=${game.date}`;

  try {
    await test.step("the admin says the league will decide by 5 pm", async () => {
      await admin.goto(page);
      await expect(
        admin.getByRole("heading", { name: "Game-day status" }),
      ).toBeVisible();
      await admin.getByRole("radio", { name: /^Watching the weather/ }).check();
      await admin.getByLabel("Decide by (Watching)").fill("17:00");
      await admin.getByRole("button", { name: "Save the status" }).click();
      await expect(
        admin.getByRole("status").filter({ hasText: "Saved." }),
      ).toBeVisible();
      await expect(admin.getByText(/we'll decide by 5:00 PM/)).toBeVisible();
      await expectNoAxeViolations(admin);

      await visitor.goto("/seasons/summer-2026/schedule");
      await expect(
        visitor.getByRole("region", { name: "Game-day status" }),
      ).toContainText("Watching the weather: we'll decide by 5:00 PM.");
      await expect(
        visitor.getByRole("region", { name: "Game-day status" }),
      ).toContainText(/Updated \d/);

      // The game page is now rendered and kept; the next change must still
      // show on the first visit after it.
      await visitor.goto(`/games/${game.gameId}`);
      await expect(
        visitor.getByText("Watching the weather: decision by 5:00 PM."),
      ).toBeVisible();
    });

    await test.step("the admin calls the game off for a flooded field", async () => {
      await admin.getByRole("radio", { name: /^Off:/ }).check();
      await admin.getByLabel("Reason (optional)").fill("Field flooded");
      await admin
        .getByRole("checkbox", { name: `6:00 PM: ${game.teams}`, exact: true })
        .check();
      await admin.getByRole("button", { name: "Save the status" }).click();
      await expect(
        admin
          .getByRole("status")
          .filter({ hasText: "players in the affected games are being told" }),
      ).toBeVisible();
      await expect(
        admin.getByRole("link", { name: "open the rain-out screen" }),
      ).toHaveAttribute("href", new RegExp(`/rainout\\?date=${game.date}$`));

      await visitor.goto(`/games/${game.gameId}`);
      await expect(visitor.getByText("Off. Field flooded.")).toBeVisible();
      await expectNoAxeViolations(visitor);
      // The schedule is static HTML refreshed in the background once its
      // season changes, so a visit just after may still be the old copy.
      await expect(async () => {
        await visitor.goto("/seasons/summer-2026/schedule");
        await expect(
          visitor.getByRole("region", { name: "Game-day status" }),
        ).toContainText("All games are off. Field flooded.", { timeout: 1000 });
      }).toPass({ timeout: 20_000 });

      await player.goto("/app");
      const next = player.getByRole("region", { name: "Your next game" });
      await expect(next).toContainText("Off. Field flooded.");
      await expect(next).toContainText(/Updated \d/);
      await expectNoAxeViolations(player);
    });

    await test.step("the admin puts it back on", async () => {
      await admin.getByRole("radio", { name: /^On:/ }).check();
      await admin.getByLabel("Reason (optional)").fill("");
      await admin.getByRole("button", { name: "Save the status" }).click();
      // The notice from the last save is still showing; wait for this one.
      await expect(
        admin.getByRole("region", { name: "Right now" }),
      ).toContainText("Games are on.");
      await visitor.goto(`/games/${game.gameId}`);
      await expect(visitor.getByRole("heading", { level: 1 })).toBeAttached();
      await expect(visitor.getByText("Off. Field flooded.")).toHaveCount(0);
    });
  } finally {
    await game.remove();
    await admin.context().close();
    await visitor.context().close();
    await player.context().close();
  }
});
