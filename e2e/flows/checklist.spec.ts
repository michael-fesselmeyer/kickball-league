import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";

/**
 * The season ops checklist (ADR 0053), at phone width. On the flows server
 * the demo admin is the platform operator (playwright.config.ts), so it
 * can edit the template as the owners do. The spring season is a draft
 * with no checklist until someone starts one.
 */
test.use({ viewport: { width: 390, height: 844 } });

test("an admin starts a season's checklist from the template, ticks off a task and edits the template", async ({
  browser,
}) => {
  const page = await pageAs(browser, "Admin");
  await page.goto("/app/admin/checklist-template");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Checklist template",
  );
  const template = page.getByRole("region", { name: "Tasks" });
  await expect(
    template.getByRole("listitem").filter({ hasText: "Order shirts" }),
  ).toContainText("21 days before the start");

  const add = page.getByRole("region", { name: "Add a task" });
  await add.getByLabel("Task").fill("Reserve the cooler");
  await add.getByLabel("Days").fill("10");
  await add
    .getByLabel("Before or after the season starts")
    .selectOption("before");
  await add.getByRole("button", { name: "Add to the template" }).click();
  await expect(page.getByRole("status").first()).toHaveText(
    "Added the task to the template.",
  );
  await expect(
    template.getByRole("listitem").filter({ hasText: "Reserve the cooler" }),
  ).toContainText("10 days before the start");
  await expectNoAxeViolations(page);

  await page.goto("/app/admin/seasons/spring-2027/checklist");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Season checklist",
  );
  await page.getByRole("button", { name: "Start from the template" }).click();
  await expect(page.getByRole("status").first()).toContainText(
    "tasks from the template.",
  );
  const todo = page.getByRole("region", { name: "To do" });
  const cooler = todo
    .getByRole("listitem")
    .filter({ hasText: "Reserve the cooler" });
  await expect(cooler).toBeVisible();
  await expectNoAxeViolations(page);

  // Give a task to someone and set its date.
  const shirts = todo.getByRole("listitem").filter({ hasText: "Order shirts" });
  await shirts.locator("summary").click();
  await shirts.getByLabel("Notes").fill("Sizes from the roster.");
  await shirts.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status").first()).toHaveText("Saved the task.");
  await expect(
    todo.getByRole("listitem").filter({ hasText: "Order shirts" }),
  ).toContainText("Sizes from the roster.");

  await cooler
    .getByRole("button", { name: /^Mark done\W+Reserve the cooler$/ })
    .click();
  await expect(page.getByRole("status").first()).toHaveText(
    "Ticked off. Nice work.",
  );
  const done = page.getByRole("region", { name: "Done" });
  await expect(done).toContainText("Reserve the cooler");

  // Starting again adds nothing twice.
  await page
    .getByRole("button", { name: "Add new tasks from the template" })
    .click();
  await expect(page.getByRole("status").first()).toHaveText(
    "The checklist already has every template task.",
  );
  await page.context().close();
});

test("the admin dashboard shows the next tasks on the checklist", async ({
  browser,
}) => {
  const page = await pageAs(browser, "Admin");
  await page.goto("/app/admin");
  const card = page.getByRole("region", { name: "Next on the checklist" });
  await expect(card).toBeVisible();
  await card.getByRole("link", { name: "Open the checklist" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Season checklist",
  );
  await page.context().close();
});
