import { expect, test } from "@playwright/test";
import { adminTool } from "../support/app-nav";
import { expectNoAxeViolations } from "../support/axe";
import { ownerAccount } from "../support/accounts";
import { pageSignedInAs } from "../support/sign-in";

/**
 * The capacity planner, at phone width: an owner sees how many teams the
 * season's permits fit, asks about more teams than fit, and takes one
 * option's extra field time to the request sheet. The owner is made up for
 * this flow and signs in by email, so no other flow switching the shared
 * demo personas can change who is signed in here. The demo's permit windows
 * are in the fall season (src/seed/books.ts).
 */
test.use({ viewport: { width: 390, height: 844 } });

test("an owner plans for more teams and requests exactly the extra field time", async ({
  browser,
}) => {
  const page = await pageSignedInAs(browser, await ownerAccount("Casey"));
  await page.goto("/app/admin");
  await (await adminTool(page, "Books")).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Books:");
  await page.getByText("Other seasons", { exact: true }).click();
  await page.getByRole("link", { name: "Fall 2026" }).click();
  // The season navigated from stays mounted, hidden, while the new one
  // loads: wait for Fall 2026, then work in the shown page.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Books: Fall 2026",
  );
  await page
    .getByRole("main")
    .getByRole("link", { name: "Permits and insurance" })
    .click();

  // How NYC Parks permits work, with its sources and the date checked.
  const rules = page.getByRole("region", {
    name: "How NYC Parks permits work",
  });
  await expect(rules).toContainText("last checked November 14, 2026");
  await rules.getByText("Why the fall has less room").click();
  await expect(rules).toContainText("soccer, football and lacrosse");
  await expect(
    rules.getByRole("link", { name: "Parks rule 2-12" }).first(),
  ).toHaveAttribute("href", "https://www.nycgovparks.org/rules/section-2-12");
  await expectNoAxeViolations(page);

  await page
    .getByRole("link", { name: "Capacity planner: how many teams fit" })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Capacity planner",
  );
  await expect(
    page.getByRole("heading", {
      name: /^The field time you hold fits \d+ teams$/,
    }),
  ).toBeVisible();
  await expectNoAxeViolations(page);

  // Far more teams than the field time holds.
  await page.getByLabel("Teams that want to play").fill("60");
  await page.getByRole("button", { name: "Work it out" }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: /teams don't fit: the season is \d+ games short/ }),
  ).toBeVisible();
  const options = page.getByRole("region", { name: "Ways to make room" });
  await expect(
    options.getByRole("heading", { name: "Doubleheaders" }),
  ).toBeVisible();
  await expect(
    options.getByRole("heading", { name: "One more field" }),
  ).toBeVisible();
  await expect(
    options.getByRole("heading", { name: "Two divisions on different nights" }),
  ).toBeVisible();

  const nearby = page.getByRole("region", {
    name: "Fields to apply for nearby",
  });
  await expect(nearby.getByRole("listitem").first()).toContainText(
    "McCarren Park",
  );
  await expect(nearby).toContainText("Athletic Facilities");
  await expectNoAxeViolations(page);

  // Take the extra weeknight to the request sheet.
  const night = options
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: /^Add \w+ nights$/ }) });
  const ask = await night
    .getByText(/^For the teams waiting, ask for/)
    .innerText();
  const games = Number(/(\d+) games? each/.exec(ask)?.[1]);
  expect(games).toBeGreaterThan(0);
  await night
    .getByRole("link", { name: /^Put it on the request sheet/ })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "from the capacity planner" }),
  ).toContainText(`Asking for ${games} extra`);
  await expect(
    page.getByLabel("Games each day (optional, instead of teams)"),
  ).toHaveValue(String(games));
  const sheet = page.getByRole("table", { name: /Field bookings to request/ });
  await expect(sheet.getByRole("row").nth(1)).toContainText("18:30");
  await expectNoAxeViolations(page);
  await page.context().close();
});
