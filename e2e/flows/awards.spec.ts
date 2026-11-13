import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";

/**
 * The seed opens the season's best-sport poll and nobody on the demo
 * player's team has voted yet. The player votes once; an admin opens a new
 * team award and closes it early, and its results page shows.
 */
test("a player votes once and an admin runs a poll to its results", async ({
  browser,
}) => {
  const player = await pageAs(browser, "Player");
  await player.goto("/app");
  await player.getByRole("link", { name: /^Vote for awards/ }).click();
  await expect(player.getByRole("heading", { name: "Awards" })).toBeVisible();
  await expectNoAxeViolations(player);

  const ballot = player.getByRole("listitem").filter({
    has: player.getByRole("heading", { name: "Fall 2026 Best sport" }),
  });
  const pick = ballot.getByLabel("Your pick");
  const choice = await pick
    .locator("option:not([disabled])")
    .first()
    .textContent();
  if (!choice) throw new Error("The ballot is empty");
  await pick.selectOption({ label: choice });
  await ballot.getByRole("button", { name: "Cast vote" }).click();
  await expect(player).toHaveURL(/\/app\/vote\?voted=/);
  await expect(ballot.getByRole("status")).toContainText(
    `Your vote: ${choice}`,
  );
  await expect(ballot.getByRole("button", { name: "Cast vote" })).toHaveCount(
    0,
  );
  await expectNoAxeViolations(player);
  await player.context().close();

  const admin = await pageAs(browser, "Admin");
  await admin.goto("/app/admin/seasons/fall-2026/awards");
  await admin.getByLabel("The whole season").check();
  await admin
    .getByLabel("Award", { exact: true })
    .selectOption({ label: "Best newcomer" });
  await admin.getByLabel("Title (optional)").fill("Rookie of the Year");
  await admin.getByRole("button", { name: "Open voting" }).click();
  await expect(admin.getByRole("status")).toContainText("Poll opened");
  await expectNoAxeViolations(admin);

  const row = admin
    .getByRole("listitem")
    .filter({ hasText: "Rookie of the Year" });
  await row.getByRole("button", { name: "Close voting now" }).click();
  await expect(admin.getByRole("status")).toContainText("Voting closed");
  await admin
    .getByRole("listitem")
    .filter({ hasText: "Rookie of the Year" })
    .getByRole("link", { name: "Results" })
    .click();
  await expect(
    admin.getByRole("heading", { name: "Rookie of the Year" }),
  ).toBeVisible();
  await expect(
    admin.getByText("No votes were cast for this award."),
  ).toBeVisible();
  await expectNoAxeViolations(admin);
  await admin.context().close();
});
