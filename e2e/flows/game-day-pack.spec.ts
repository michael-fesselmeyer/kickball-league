import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";

/**
 * The printable game-day pack (issue #377) for the seed's fifth round, on
 * October 13, 2026 (src/seed/demo-personas.ts): a sheet per field with each
 * game's blank line score and a QR code to its score page, and a check-in
 * sheet per team when asked for.
 */
const DAY = "2026-10-13";

test("an admin opens the game-day pack for a seeded game day", async ({
  browser,
}) => {
  const admin = await pageAs(browser, "Admin");
  await admin.goto(`/app/admin/today?date=${DAY}`);
  await admin.getByRole("link", { name: "Print game-day pack" }).click();
  await expect(admin).toHaveURL(
    new RegExp(`/app/admin/today/print\\?date=${DAY}$`),
  );
  await expect(admin.getByRole("heading", { level: 1 })).toHaveText(
    "Game-day pack",
  );
  await expect(admin.getByRole("button", { name: "Print" })).toBeVisible();

  const main = admin.getByRole("main");
  const fields = main.getByRole("region");
  await expect(fields.first()).toBeVisible();
  const firstGame = fields.first().getByRole("article").first();
  await expect(firstGame.getByRole("heading", { level: 3 })).toContainText(
    " vs ",
  );
  await expect(firstGame.getByText(/^Ref: /)).toBeVisible();
  await expect(
    firstGame.getByRole("img", { name: /^QR code: enter the score for / }),
  ).toBeVisible();
  // Innings 1 to 7, the extra column and the runs.
  await expect(firstGame.getByRole("columnheader")).toHaveCount(10);
  await expect(firstGame.getByText("Final score")).toBeVisible();
  await expect(main.getByText(/permit/i).first()).toBeVisible();
  await expectNoAxeViolations(admin);

  // The check-in sheets, one per team playing.
  await admin.getByLabel("Add a check-in sheet per team").check();
  await admin.getByRole("button", { name: "Show" }).click();
  await expect(admin).toHaveURL(/rosters=1/);
  const checkIn = main.getByRole("table", { name: /^Check-in sheet for / });
  await expect(checkIn.first()).toBeVisible();
  // First name and last initial only.
  await expect(
    checkIn
      .first()
      .getByRole("cell", { name: /^[^ ]+ [A-Z]\.( \((co-)?captain\))?$/ })
      .first(),
  ).toBeVisible();
  await expectNoAxeViolations(admin);
  await admin.context().close();
});
