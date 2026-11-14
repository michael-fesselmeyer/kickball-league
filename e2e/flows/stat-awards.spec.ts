import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";

/**
 * Stat awards (ADR 0046). The seed publishes the fall season's awards. An
 * admin takes them down, changes the MVP weights, works them out again,
 * adds a note and publishes; a visitor reads the page with its formulas;
 * the demo player reads their own stats and steps off the leaderboards
 * and back on. Runs in one test so the published state is never left
 * halfway for another flow.
 */
test("an admin reviews and publishes stat awards, and a player opts out", async ({
  browser,
}) => {
  test.slow();
  const admin = await pageAs(browser, "Admin");
  await admin.goto("/app/admin/seasons/fall-2026/awards");
  await admin
    .getByRole("link", { name: "Stat awards and the Season MVP" })
    .click();
  await expect(
    admin.getByRole("heading", { name: "Stat awards" }),
  ).toBeVisible();
  await expectNoAxeViolations(admin);

  await admin.getByRole("button", { name: "Take down" }).click();
  await expect(admin.getByRole("status")).toContainText("Taken down");
  const visitor = await (await browser.newContext()).newPage();
  const gone = await visitor.goto("/seasons/fall-2026/awards");
  expect(gone?.status()).toBe(404);

  await admin.getByLabel("MVP vote share").fill("5");
  await admin.getByRole("button", { name: "Work them out again" }).click();
  await expect(admin.getByRole("status")).toContainText("Awards worked out");
  await expect(admin.getByLabel("MVP vote share")).toHaveValue("5");

  const note = admin.locator("form").filter({
    has: admin.getByLabel("Note on Season MVP"),
  });
  await admin
    .getByLabel("Note on Season MVP")
    .fill("Decided by the closest vote in years.");
  await note.getByRole("button", { name: "Save note" }).click();
  await expect(admin.getByRole("status")).toContainText("Note saved");

  await admin.getByRole("button", { name: "Publish" }).click();
  await expect(admin.getByRole("status")).toContainText("Published");
  await expectNoAxeViolations(admin);
  await admin.context().close();

  await visitor.goto("/seasons/fall-2026/awards");
  await expect(
    visitor.getByRole("heading", { name: "Season awards" }),
  ).toBeVisible();
  const mvp = visitor.getByRole("region", { name: "Season MVP" });
  await expect(mvp).toContainText("Decided by the closest vote in years.");
  await expect(
    mvp.getByRole("list", { name: "Season MVP leaders" }).getByRole("listitem"),
  ).not.toHaveCount(0);
  await mvp.getByText("How it's worked out").click();
  await expect(mvp).toContainText("MVP vote share");
  await expect(mvp).toContainText("5 of 11");
  for (const award of [
    "Iron Kicker",
    "Golden Boot",
    "Best Teammate",
    "Rookie of the Year",
    "Sub of the Year",
  ])
    await expect(visitor.getByRole("region", { name: award })).toBeVisible();
  await expectNoAxeViolations(visitor);
  await visitor.context().close();

  const player = await pageAs(browser, "Player");
  await player.goto("/app/profile");
  await player.getByRole("link", { name: "See your stats" }).click();
  await expect(
    player.getByRole("heading", { name: "Your stats" }),
  ).toBeVisible();
  const career = player.getByRole("table", { name: "Career stats" });
  await expect(
    career.getByRole("row", { name: /^Games played/ }),
  ).toBeVisible();
  await expect(career).toContainText(/based on \d+ of \d+ games/);
  await expectNoAxeViolations(player);

  await player
    .getByRole("button", { name: "Keep me off leaderboards" })
    .click();
  await expect(player.getByRole("status")).toContainText(
    "You're off public leaderboards.",
  );
  await player.getByRole("button", { name: "Show me on leaderboards" }).click();
  await expect(player.getByRole("status")).toContainText(
    "You're back on public leaderboards.",
  );
  await player.context().close();
});
