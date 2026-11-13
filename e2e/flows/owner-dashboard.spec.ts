import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";
import { download } from "../support/seed-data";

/**
 * The owner dashboard and the season money summary (ADR 0035), at phone
 * width. On the flows server the demo admin is the platform operator
 * (playwright.config.ts), who sees what the owners see. The seed records the
 * fall players' fees and publishes the fall summary (src/seed/money-summary.ts).
 */
test.use({ viewport: { width: 390, height: 844 } });

test("an owner reads the dashboard, downloads its numbers and publishes a summary a visitor can read", async ({
  browser,
}) => {
  const page = await pageAs(browser, "Admin");
  await page.goto("/app/admin");
  await page.getByRole("link", { name: "Owner dashboard" }).click();
  await expect(page).toHaveURL(/\/app\/owner\/[a-z0-9-]+$/);
  // The demo's money and sponsor check-ins are in the fall season.
  await page.goto("/app/owner/fall-2026");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Owner dashboard",
  );
  // The page navigated from stays mounted, hidden; work in the shown one.
  const main = page.getByRole("main");
  const members = main.getByRole("table", { name: /Members by season/ });
  await expect(members.getByRole("row", { name: /^Fall 2026/ })).toBeVisible();
  const money = main.getByRole("table", { name: "Money in and out by season" });
  await expect(money.getByRole("row", { name: /^Fall 2026/ })).toContainText(
    "$3,274.50",
  );
  await expect(
    main.getByRole("table", { name: /Fall 2026 teams/ }).getByRole("row", {
      name: /^The Big Kicks/,
    }),
  ).toBeVisible();
  await expect(
    main.getByRole("img", { name: /Check-ins at sponsor bars each week/ }),
  ).toBeVisible();
  await expectNoAxeViolations(page);

  const csv = await download(main.getByRole("link", { name: "Download CSV" }));
  expect(csv.name).toBe("fall-2026-dashboard.csv");
  expect(csv.text).toContain("Membership,Fall 2026,,Members,");
  expect(csv.text).toContain("Money,Fall 2026,Money out,Total ($),3274.5");
  // Counts and totals only: no one's email.
  expect(csv.text).not.toContain("@");

  await main.getByRole("link", { name: "Money summary" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Money summary",
  );
  const summary = page.getByRole("main");
  await summary.getByRole("checkbox", { name: "Refs" }).check();
  await summary.getByRole("button", { name: "Update the preview" }).click();
  const preview = page.getByRole("region", { name: /Preview: Fall 2026/ });
  await expect(preview.getByRole("row", { name: /^Other/ })).toContainText(
    "$300.00",
  );
  await expect(preview.getByRole("row", { name: /^Refs/ })).toHaveCount(0);
  await expectNoAxeViolations(page);
  await page
    .getByRole("main")
    .getByRole("button", { name: "Publish these numbers" })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Published." }),
  ).toBeVisible();
  await page.context().close();

  // A visitor, signed out, sees the new numbers at once.
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto("/seasons/fall-2026/money");
  await expect(visitor.getByRole("heading", { level: 1 })).toHaveText(
    "Where the money goes",
  );
  const shown = visitor.getByRole("main");
  await expect(
    shown.getByRole("row", { name: /^Fields and permits/ }),
  ).toContainText("$1,800.00");
  await expect(shown.getByRole("row", { name: /^Other/ })).toContainText(
    "$300.00",
  );
  await expect(shown.getByRole("row", { name: /^Refs/ })).toHaveCount(0);
  await expect(
    shown.getByRole("heading", { name: "Where a $85.00 player fee goes" }),
  ).toBeVisible();
  // No personal data: no email address, phone number or note.
  const text = await shown.innerText();
  expect(text).not.toMatch(/@|\(\d{3}\) \d{3}-\d{4}|sign-up night/);
  await expectNoAxeViolations(visitor);
  await visitor.context().close();
});

test("someone without the owners' right finds no dashboard", async ({
  browser,
}) => {
  // Admins are kept out the same way (src/db/queries/owner-dashboard.db.test.ts);
  // on this server the demo admin is the operator, so a captain stands in.
  const page = await pageAs(browser, "Captain");
  for (const path of [
    "/app/owner",
    "/app/owner/fall-2026",
    "/app/owner/fall-2026/summary",
  ]) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: "This page could not be found." }),
    ).toBeVisible();
  }
  const csv = await page.request.get("/app/owner/fall-2026/dashboard.csv");
  expect(csv.status()).toBe(404);
  await page.context().close();
});

test("a season without a published summary has no money page", async ({
  page,
}) => {
  await page.goto("/seasons/spring-2027/money");
  await expect(
    page.getByRole("heading", { name: "This page could not be found." }),
  ).toBeVisible();
});
