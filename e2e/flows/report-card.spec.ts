import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";
import { download } from "../support/seed-data";

/**
 * The season report card (issue #371) at phone width. On the flows server
 * the demo admin is also the platform operator (playwright.config.ts), who
 * sees what the owners see. The seed's fall season is running, with past
 * seasons before it.
 */
test.use({ viewport: { width: 390, height: 844 } });

test("an owner reads the report card, downloads it and opens the version for sponsors", async ({
  browser,
}) => {
  const page = await pageAs(browser, "Admin");
  await page.goto("/app/owner/fall-2026");
  await page
    .getByRole("main")
    .getByRole("link", { name: "Report card" })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Season report card",
  );
  const main = page.getByRole("main");
  const people = main.getByRole("table", { name: /^People: Fall 2026/ });
  await expect(
    people.getByRole("row", { name: /^Players registered/ }),
  ).toBeVisible();
  await expect(main.getByRole("heading", { name: "Money" })).toBeVisible();
  await expect(main.getByRole("figure").first()).toBeVisible();
  await expectNoAxeViolations(page);

  const csv = await download(main.getByRole("link", { name: "Download CSV" }));
  expect(csv.name).toBe("fall-2026-report-card.csv");
  expect(csv.text).toMatch(/^﻿?Section,Measure,Unit,Fall 2026,/);
  expect(csv.text).toContain("People,Players registered,count,");
  expect(csv.text).toContain("Money,Money in,dollars,");

  await main.getByRole("link", { name: "Shareable version" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Fall 2026 season report",
  );
  const shared = page.getByRole("main");
  await expect(
    shared.getByRole("row", { name: /^Players registered/ }),
  ).toBeVisible();
  // No money and nothing about any one person.
  await expect(shared.getByRole("heading", { name: "Money" })).toHaveCount(0);
  const text = await shared.innerText();
  expect(text).not.toMatch(/\$|@/);
  await expectNoAxeViolations(page);
  await page.context().close();
});

test("only owners see a report card, and only for a season under way", async ({
  browser,
}) => {
  const captain = await pageAs(browser, "Captain");
  for (const path of [
    "/app/owner/fall-2026/report",
    "/app/owner/fall-2026/report/share",
  ]) {
    await captain.goto(path);
    await expect(
      captain.getByRole("heading", { name: "We can't find that page" }),
    ).toBeVisible();
  }
  expect(
    (await captain.request.get("/app/owner/fall-2026/report.csv")).status(),
  ).toBe(404);
  await captain.context().close();

  // The seed's spring season hasn't started yet.
  const owner = await pageAs(browser, "Admin");
  await owner.goto("/app/owner/spring-2027/report");
  await expect(
    owner.getByRole("heading", { name: "We can't find that page" }),
  ).toBeVisible();
  await owner.context().close();
});
