import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";

/**
 * An admin splits the season into two divisions with a crossover game a
 * team, from the Divisions screen.
 */
async function splitIntoDivisions(page: Page) {
  await page.goto("/app/admin/seasons/spring-2027/divisions");
  await expect(
    page.getByRole("heading", { level: 1, name: "Divisions" }),
  ).toBeVisible();
  await expect(
    page.getByText("No divisions: every team plays in one pool."),
  ).toBeVisible();
  await expectNoAxeViolations(page);

  const ruleSets = page.getByRole("region", { name: "Rule sets" });
  await ruleSets.getByLabel("Rule set name").fill("Social rules");
  await ruleSets.getByLabel("Innings").fill("5");
  await ruleSets.getByLabel("Bunting").check();
  await ruleSets.getByRole("button", { name: "Add rule set" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Rule set added. Pick it for a division above.",
  );

  const divisions = page.getByRole("region", { name: "Divisions" });
  for (const [name, rules] of [
    ["Competitive", "No rule set"],
    ["Social", "Social rules"],
  ] as const) {
    await divisions.getByLabel("New division").fill(name);
    await divisions.getByLabel("Its rule set").selectOption({ label: rules });
    await divisions.getByRole("button", { name: "Add division" }).click();
    await expect(page.getByRole("status")).toHaveText(
      "Division added. Put teams in it below.",
    );
  }

  // Eight teams, alphabetically: the first four play Competitive.
  const teams = page.getByRole("region", { name: "Teams" });
  await expect(teams.getByText("8 teams have no division.")).toBeVisible();
  const pickers = teams.getByRole("combobox");
  await expect(pickers).toHaveCount(8);
  for (let i = 0; i < 8; i++)
    await pickers
      .nth(i)
      .selectOption({ label: i < 4 ? "Competitive" : "Social" });
  await teams.getByRole("button", { name: "Save teams" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "8 teams moved. Generate the schedule again to use the new divisions.",
  );

  const settings = page.getByRole("region", {
    name: "Crossover games and playoffs",
  });
  await settings.getByLabel("Crossover games per team").fill("1");
  await settings.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Saved. Generate the schedule again to change crossover games.",
  );
  await expectNoAxeViolations(page);
}

/**
 * The seed leaves Spring 2027 with teams, fields and slots but no schedule.
 * An admin splits it into two divisions, generates a draft with crossover
 * games, publishes it, and the public schedule and standings show each
 * division.
 */
test("an admin splits a season into divisions and publishes its schedule", async ({
  browser,
  page: visitor,
}) => {
  // The build prerendered the season's schedule from the seeded league. An
  // earlier visitor (in a browser of their own, so the one below starts with
  // nothing saved) gets that stored page until publishing refreshes it. They
  // keep their browser, with its stored copy and the league's service worker.
  const earlier = await browser.newPage();
  await earlier.goto("/seasons/spring-2027/schedule");
  await expect(earlier.getByText("Coming soon", { exact: true })).toBeVisible();
  await earlier.waitForFunction(() => navigator.serviceWorker.controller);

  const page = await pageAs(browser, "Admin");
  await splitIntoDivisions(page);

  await page.goto("/app/admin/seasons/spring-2027/schedule");
  await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: "Divisions: Competitive (4 teams), Social (4 teams), 1 crossover game a team",
    }),
  ).toBeVisible();
  await expect(
    page.getByText("No versions yet. Generate one to start."),
  ).toBeVisible();
  // One round robin in each four-team division; the crossover comes on top.
  await expect(page.getByLabel("Rounds")).toHaveValue("3");
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

  // Anyone can now see it, signed in or not, on their first load: three
  // division rounds and a crossover round of four games each.
  await visitor.goto("/seasons/spring-2027/schedule");
  await expect(visitor.getByRole("heading", { level: 1 })).toHaveText(
    "Schedule",
  );
  await expect(visitor.getByText("Spring 2027", { exact: true })).toBeVisible();
  await expect(visitor.getByRole("status")).toHaveText("Showing all 16 games.");
  await expectNoAxeViolations(visitor);

  // A division's schedule is its own page: its games and its crossovers.
  await visitor
    .getByRole("navigation", { name: "Divisions" })
    .getByRole("link", { name: "Competitive" })
    .click();
  await expect(visitor).toHaveURL(
    /\/seasons\/spring-2027\/schedule\/division\/competitive$/,
  );
  await expect(visitor.getByRole("heading", { level: 1 })).toHaveText(
    "Competitive schedule",
  );
  // Six division games and four crossovers.
  await expect(visitor.getByRole("status")).toHaveText(
    "Showing 10 games for Competitive.",
  );
  await expect(visitor.getByText("Crossover").first()).toBeVisible();
  await expectNoAxeViolations(visitor);

  // Standings have a table for each division.
  await visitor.goto("/seasons/spring-2027/standings");
  for (const division of ["Competitive", "Social"]) {
    const section = visitor.getByRole("region", { name: division });
    await expect(
      section.getByRole("heading", { level: 2, name: division }),
    ).toBeVisible();
    await expect(section.getByRole("row")).toHaveCount(5);
  }
  await expect(visitor.getByText("Social rules: 5 innings")).toBeVisible();
  await expectNoAxeViolations(visitor);

  // The earlier visitor sees the games on their next visit too, not the copy
  // their browser stored before publishing (#204).
  await earlier.goto("/seasons/spring-2027/schedule");
  await expect(earlier.getByRole("status")).toHaveText("Showing all 16 games.");
  await earlier.context().close();
});
