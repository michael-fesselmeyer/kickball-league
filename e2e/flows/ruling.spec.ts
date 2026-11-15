import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { unscoreGameById, untouchedGame } from "../support/games";
import { pageAs } from "../support/personas";

/**
 * An admin records a forfeit with a written reason. The form asks for the
 * reason, and the ruling and its reason show on the game page. The game is
 * one no other flow scores, since flows run in parallel.
 */
test("an admin rules on a game with a written reason", async ({ browser }) => {
  test.slow();
  const taken = [
    ["Pitch Please", "Base Invaders"],
    ["Grand Slammers", "Foul Play"],
    ["Grand Slammers", "Red Rubber Ballers"],
    ["Base Invaders", "The Big Kicks"],
    ["The Big Kicks", "Kickin' Chicken"],
    ["Sun Kickers", "Kickin' Chicken"],
    ["Night Owls", "Porch Lights"],
  ] as const;
  const { id: gameId, teamA, teamB } = await untouchedGame(taken);
  const scorePage = `/app/games/${gameId}/score`;

  const admin = await pageAs(browser, "Admin");
  await admin.goto(scorePage);
  // The first score for a game nobody reported needs no reason.
  await admin.getByRole("spinbutton", { name: teamA }).fill("6");
  await admin.getByRole("spinbutton", { name: teamB }).fill("5");
  await admin.getByRole("button", { name: "Save the score" }).click();
  await expect(admin.getByRole("status")).toHaveText("Score saved.");
  await expect(
    admin.getByRole("region", { name: "Final score" }),
  ).toContainText(`${teamA} 6, ${teamB} 5`);

  // Changing it is a ruling: a forfeit needs its reason.
  await admin.getByText("Set the score as an admin").click();
  await admin
    .getByLabel("Result")
    .selectOption({ label: `${teamB} forfeited` });
  const reason = admin.getByLabel("Reason for the ruling");
  await expect(reason).toBeVisible();
  await expect(reason).toHaveAttribute("required", "");
  await expectNoAxeViolations(admin);
  await reason.fill("Four players short at 8:15.");
  await admin.getByRole("button", { name: "Save as the final score" }).click();
  const ruling = admin.getByRole("region", { name: "Final score" });
  await expect(ruling).toContainText("Forfeit ruling");
  await expect(ruling).toContainText(`${teamB} forfeited`);
  await expect(ruling).toContainText("Four players short at 8:15.");
  // The ruling and its reason stand after a reload.
  await admin.reload();
  await expect(
    admin.getByRole("region", { name: "Final score" }),
  ).toContainText("Four players short at 8:15.");
  await admin.context().close();
  await unscoreGameById(gameId);
});
