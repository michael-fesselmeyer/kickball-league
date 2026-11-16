import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";

/**
 * An admin rolls last season over and carries on to a schedule. From the
 * fall season they bring the teams that no demo persona captains, check
 * what will be copied, create the next season as a draft, and find the
 * permit hours already on the new dates. They generate a schedule from
 * those hours and publish it. The season stays hidden from players until
 * the admin opens it.
 */
const NAME = "Summer league 2027";
const SLUG = "summer-league-2027";

test("an admin rolls a season over, schedules it and publishes", async ({
  browser,
}) => {
  test.slow();
  const admin = await pageAs(browser, "Admin");
  await admin.setViewportSize({ width: 390, height: 844 });

  await test.step("the next season is created from the last, with its teams and permit hours", async () => {
    await admin.goto("/app/admin/seasons/fall-2026");
    await admin
      .getByRole("link", { name: "Start the next season from this one" })
      .click();
    await expect(
      admin.getByRole("heading", { name: "Start the next season" }),
    ).toBeVisible();
    const teams = admin.getByRole("group", { name: "Teams to bring along" });
    const personaTeams = teams
      .locator("label")
      .filter({ hasText: /Casey Captain|Pat Player|Reese Ref|Addie Admin/ });
    for (const box of await personaTeams.getByRole("checkbox").all())
      await box.uncheck();
    const count = await teams.locator("input[type=checkbox]:checked").count();
    expect(count).toBeGreaterThan(1);
    await admin.getByLabel("New season's name").fill(NAME);
    await admin.getByRole("button", { name: "Update the preview" }).click();
    const preview = admin.getByRole("region", {
      name: `What ${NAME} gets`,
    });
    await expect(preview).toContainText("Permit hours");
    await expectNoAxeViolations(admin);
    await preview
      .getByRole("button", { name: `Create ${NAME} as a draft` })
      .click();
    await expect(admin).toHaveURL(new RegExp(`/app/admin/seasons/${SLUG}\\?`));
  });

  await test.step("the permit hours are on the new dates", async () => {
    await admin.goto(`/app/admin/seasons/${SLUG}/fields`);
    await expect(
      admin.getByRole("heading", { name: "Fields and permits" }),
    ).toBeVisible();
    await expect(
      admin.getByRole("region", { name: "Permit windows" }),
    ).toContainText("Field 1, McCarren Park");
    // A schedule is published only when its fields have a layout, or an
    // admin's word that they need none.
    const layouts = admin.getByRole("region", { name: "Field layouts" });
    const missing = layouts
      .getByRole("listitem")
      .filter({ hasText: "No layout yet." });
    while ((await missing.count()) > 0) {
      const field = missing.first();
      await field.getByLabel("This field needs no layout").check();
      await field.getByRole("button", { name: /Save layout/ }).click();
      await expect(admin.getByRole("status")).toHaveText("Layout saved.");
    }
    await admin.getByLabel("Minutes per slot").fill("60");
    await admin.getByRole("button", { name: "Cut slots from permits" }).click();
    await expect(admin.getByRole("status")).toContainText("slots added");
    await expectNoAxeViolations(admin);
  });

  await test.step("the schedule is generated and published", async () => {
    await admin.goto(`/app/admin/seasons/${SLUG}/schedule`);
    await admin.getByRole("button", { name: "Generate" }).click();
    await expect(
      admin.getByRole("heading", { name: "Version 1 (draft)" }),
    ).toBeVisible();
    await expectNoAxeViolations(admin);
    // Permit numbers and documents aren't copied, and the owners haven't
    // uploaded the new ones yet, so the admin says why they publish first.
    await admin
      .getByLabel("Why publish before the documents are uploaded?")
      .fill(
        "The league holds these permits; owners upload the documents next.",
      );
    await admin
      .getByRole("button", { name: "Publish version 1 anyway" })
      .click();
    await expect(
      admin.getByRole("status").filter({ hasText: "Published." }),
    ).toBeVisible();
    await expectNoAxeViolations(admin);
  });

  await admin.context().close();
});
