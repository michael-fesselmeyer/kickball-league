import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { addGameInDays } from "../support/game-today";
import { captainEmail, pageSignedInAs, playerEmail } from "../support/sign-in";

/**
 * The week before a game, from the player's phone to the captain's lineup
 * and back. A Kickin' Chicken player finds the coming game on their team
 * page and says they're in; the team's counts move; the captain finds the
 * player in the kicking-order builder, saves an order, and the player
 * sees where they kick. Then the player changes their answer to out.
 *
 * The game is an exhibition against Pitch Please, three days out and
 * outside the published schedule, added for this flow alone and removed at
 * the end.
 */
const SEASON = "fall-2026";
const TEAM = "Kickin' Chicken";
const OTHER = "Pitch Please";
const PHONE = { width: 390, height: 844 };

test("a player says they're in, the captain orders the lineup, and the player sees their spot", async ({
  browser,
}) => {
  // Two people sign in and five pages are scanned.
  test.slow();
  const game = await addGameInDays(TEAM, OTHER, 3, 19);
  try {
    const player = await pageSignedInAs(
      browser,
      await playerEmail(TEAM, SEASON),
    );
    const captain = await pageSignedInAs(
      browser,
      await captainEmail(TEAM, SEASON),
    );
    await player.setViewportSize(PHONE);
    await captain.setViewportSize(PHONE);
    const coming = (page: typeof player) =>
      page.getByRole("listitem").filter({ hasText: `vs ${OTHER}` });

    await test.step("the player says they're in", async () => {
      await player.goto(`/app/seasons/${SEASON}/team`);
      const row = coming(player);
      await expect(row.getByText(/\d+ maybe/)).toBeVisible();
      await expectNoAxeViolations(player);
      await row.getByRole("button", { name: "In", exact: true }).click();
      await expect(
        coming(player).getByRole("button", { name: "In", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
    });

    await test.step("the captain finds the player in the kicking-order builder", async () => {
      await captain.goto(`/app/seasons/${SEASON}/team`);
      await coming(captain)
        .getByRole("link", { name: "Set kicking order" })
        .click();
      await expect(
        captain.getByRole("heading", { name: `${TEAM} vs ${OTHER}` }),
      ).toBeVisible();
      await expectNoAxeViolations(captain);
      await captain.getByRole("button", { name: "Save kicking order" }).click();
      await expect(captain.getByRole("status")).toHaveText(
        /^Saved\. Your players/,
      );
    });

    await test.step("the player sees where they kick", async () => {
      await player.goto(`/app/seasons/${SEASON}/team`);
      await coming(player)
        .getByRole("link", { name: /^You kick \d+(st|nd|rd|th) of \d+$/ })
        .click();
      await expect(
        player.getByText(/^You kick \d+(st|nd|rd|th) of \d+\.$/),
      ).toBeVisible();
      await expectNoAxeViolations(player);
    });

    await test.step("the player changes their answer to out", async () => {
      await player.goto(`/app/seasons/${SEASON}/team`);
      await coming(player)
        .getByRole("button", { name: "Out", exact: true })
        .click();
      await expect(
        coming(player).getByRole("button", { name: "Out", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
    });
    await player.context().close();
    await captain.context().close();
  } finally {
    await game.remove();
  }
});
