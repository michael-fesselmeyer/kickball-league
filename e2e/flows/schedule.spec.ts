import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";

/**
 * The seed leaves Spring 2027 with teams, fields and slots but no schedule.
 * An admin generates a draft, publishes it, and the public schedule shows it.
 */
test("an admin generates and publishes a schedule", async ({
  browser,
  page: visitor,
}) => {
  const page = await pageAs(browser, "Admin");
  await page.goto("/app/admin/seasons/spring-2027/schedule");
  await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible();
  await expect(
    page.getByText("No versions yet. Generate one to start."),
  ).toBeVisible();
  await expectNoAxeViolations(page);

  await page.getByRole("button", { name: "Generate" }).click();
  await expect(
    page.getByRole("heading", { name: "Version 1 (draft)" }),
  ).toBeVisible();
  await expectNoAxeViolations(page);

  await page.getByRole("button", { name: "Publish version 1" }).click();
  // The schedule board has a status region of its own.
  await expect(
    page.getByRole("status").filter({ hasText: "Published." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Version 1 (published)" }),
  ).toBeVisible();
  await page.context().close();

  // Anyone can now see it, signed in or not.
  await visitor.goto("/seasons/spring-2027/schedule");
  await expect(visitor.getByRole("heading", { level: 1 })).toHaveText(
    "Schedule",
  );
  await expect(visitor.getByText("Spring 2027", { exact: true })).toBeVisible();
  await expect(visitor.getByRole("status")).toHaveText(
    /^Showing all \d+ games\.$/,
  );
  await expectNoAxeViolations(visitor);
});
