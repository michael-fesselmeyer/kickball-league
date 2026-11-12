import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";

/**
 * Fall 2026 has a published schedule. An admin rains out its last game day,
 * saves the makeups as a draft and publishes it, which emails the players.
 */
test("an admin calls a rain-out and publishes the makeups", async ({
  browser,
}) => {
  const page = await pageAs(browser, "Admin");
  await page.goto("/app/admin/seasons/fall-2026/rainout");
  await expect(
    page.getByRole("heading", { name: "Call a rain-out" }),
  ).toBeVisible();

  const date = page.getByLabel("Date");
  const lastDay = await date.locator("option").last().textContent();
  if (!lastDay) throw new Error("Fall 2026 has no game days");
  await date.selectOption({ label: lastDay });
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(
    page.getByRole("heading", { name: `If ${lastDay} is rained out` }),
  ).toBeVisible();
  await expectNoAxeViolations(page);

  await page
    .getByRole("button", {
      name: `Cancel ${lastDay} and save these makeups as a draft`,
    })
    .click();
  await expect(page).toHaveURL(/\/schedule\?rainout=/);
  await expect(page.getByRole("status")).toContainText(
    "Rain-out saved as a draft",
  );
  await expectNoAxeViolations(page);

  await page.getByRole("button", { name: /^Publish version \d+$/ }).click();
  await expect(page.getByRole("status")).toContainText("Published.");
  await expect(page.getByRole("status")).toContainText(
    /rain-out emails? queued for players/,
  );
  await page.context().close();
});
