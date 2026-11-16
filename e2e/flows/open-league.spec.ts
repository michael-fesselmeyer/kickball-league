import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";

/**
 * One step from an interest option to a new league (ADR 0087): the
 * operator (the demo admin, on the flows server) opens a dodgeball league
 * from an option, and the option links to it.
 */
test("the operator opens a new league from an interest option", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  // A park of its own, so a retry finds its own option.
  const park = `Gym ${randomBytes(3).toString("hex")}`;
  const admin = await pageAs(browser, "Admin");
  await admin.goto("/app/admin/interest");
  // The demo data opens a form; a database without it gets one here.
  const openForm = admin.getByRole("button", { name: "Open the form" });
  if (await openForm.isVisible()) {
    await admin.getByLabel("Park", { exact: true }).first().fill("Sample Park");
    await openForm.click();
    await expect(admin.getByRole("status")).toContainText("The form is open");
  }
  await admin.getByLabel("Park", { exact: true }).last().fill(park);
  await admin.getByRole("button", { name: "Add", exact: true }).click();
  await expect(admin.getByRole("status")).toHaveText("Option added.");

  const option = admin.getByRole("listitem").filter({ hasText: park });
  await option.getByText(`Open ${park} as a new league`).click();
  await option.getByLabel("Sport").selectOption("dodgeball");
  await expectNoAxeViolations(admin);
  await option.getByRole("button", { name: "Open the league" }).click();
  await expect(admin.getByRole("status")).toContainText(
    "League opened with a draft season.",
  );
  const opened = admin
    .getByRole("listitem")
    .filter({ hasText: park })
    .getByRole("link", { name: `Dodgeball at ${park}` });
  await expect(opened).toBeVisible();

  // Its home page is there, with no public season yet.
  await opened.click();
  await expect(
    admin.getByRole("heading", { level: 1, name: `Dodgeball at ${park}` }),
  ).toBeVisible();
  await admin.context().close();
});
