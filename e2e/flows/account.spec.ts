import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs, viewAs } from "../support/personas";
import { download } from "../support/seed-data";

/**
 * A player's own account: which league emails they get, a copy of
 * everything the league holds about them, and deleting the account, which
 * the demo turns off.
 */
test("a player picks their emails, downloads their data and finds deletion off in the demo", async ({
  browser,
}) => {
  const page = await pageAs(browser, "Player");
  await page.goto("/app/profile");
  const emails = page.getByRole("region", { name: "Email settings" });
  // Events emails only: no other flow waits on them.
  const events = emails.getByRole("checkbox", { name: /^Events/ });
  await expect(events).toBeChecked();
  await events.uncheck();
  await emails.getByRole("button", { name: "Save email settings" }).click();
  await expect(page.getByRole("status")).toHaveText("Email settings saved.");
  await expect(events).not.toBeChecked();
  await expectNoAxeViolations(page);
  await events.check();
  await emails.getByRole("button", { name: "Save email settings" }).click();
  await expect(page.getByRole("status")).toHaveText("Email settings saved.");
  await expect(events).toBeChecked();

  const mine = await download(
    page.getByRole("link", { name: "Download your data (JSON)" }),
  );
  expect(mine.text).toContain("pat.player@example.test");
  expect(() => JSON.parse(mine.text) as unknown).not.toThrow();

  await page.getByRole("link", { name: "Delete your account" }).click();
  await expect(page).toHaveURL(/\/app\/profile\/delete$/);
  await expect(
    page.getByText("Account deletion is turned off in the demo."),
  ).toBeVisible();
  await expectNoAxeViolations(page);
  await page.context().close();
});

test("a player's home leads to their team, whatever registration is doing", async ({
  page,
}) => {
  // Fall 2026 is being played and its registration closed long ago, so the
  // home screen's register buttons don't offer it: the team link has to.
  await viewAs(page, "Player");
  const season = page.getByRole("region", { name: "Your season" });
  await season.getByRole("link", { name: "The Big Kicks · Fall 2026" }).click();
  await expect(page).toHaveURL(/\/app\/seasons\/fall-2026\/team$/);
  await expect(
    page.getByRole("heading", { name: "The Big Kicks" }),
  ).toBeVisible();
});
