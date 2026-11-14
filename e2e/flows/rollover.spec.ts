import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";

/**
 * An admin starts the next season from the demo's fall season: previews
 * what will be copied, names it, unticks a team, and creates it as a
 * draft. Players see nothing of a draft, so other flows are unaffected.
 */
test("an admin starts the next season from the last one", async ({
  browser,
}) => {
  const page = await pageAs(browser, "Admin");
  await page.goto("/app/admin/seasons/fall-2026");
  await page
    .getByRole("link", { name: "Start the next season from this one" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Start the next season" }),
  ).toBeVisible();
  await expectNoAxeViolations(page);

  // Every team that played is ticked. Leave out the teams a demo persona
  // captains, so no persona gets a registration in the new season and the
  // other flows, which look up a persona's newest team, are unaffected.
  const teams = page.getByRole("group", { name: "Teams to bring along" });
  const boxes = teams.getByRole("checkbox");
  expect(await boxes.count()).toBeGreaterThan(1);
  const personaTeams = teams
    .locator("label")
    .filter({ hasText: /Casey Captain|Pat Player|Reese Ref|Addie Admin/ });
  for (const box of await personaTeams.getByRole("checkbox").all())
    await box.uncheck();
  expect(await personaTeams.count()).toBeGreaterThan(0);
  const count = await teams.locator("input[type=checkbox]:checked").count();
  expect(count).toBeGreaterThan(0);
  await page.getByLabel("New season's name").fill("Winter league 2026");
  await page.getByRole("button", { name: "Update the preview" }).click();

  const preview = page.getByRole("region", {
    name: "What Winter league 2026 gets",
  });
  await expect(preview).toContainText(`${count}, with`);
  await expect(preview).toContainText("all as requested");
  await expect(preview.getByRole("list")).toContainText(
    "Waiver signatures (everyone signs again)",
  );
  await expectNoAxeViolations(page);

  await preview
    .getByRole("button", { name: "Create Winter league 2026 as a draft" })
    .click();
  await expect(page).toHaveURL(/\/app\/admin\/seasons\/winter-league-2026\?/);
  await expect(
    page.getByRole("status").filter({ hasText: "Season created as a draft" }),
  ).toContainText(`${count} teams`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Winter league 2026",
  );
  await page.context().close();
});
