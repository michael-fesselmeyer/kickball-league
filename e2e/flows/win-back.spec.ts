import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";

/**
 * The win-back list (issue #370) at phone width. It shows only while a
 * season's registration is open, so the flow makes its own season and
 * opens it; the seed's fall players are on the list. On the flows server
 * the demo admin is also the platform operator (playwright.config.ts), so
 * it sees the owner dashboard too.
 */
test.use({ viewport: { width: 390, height: 844 } });
test.describe.configure({ mode: "serial" });

const SEASON = "Autumn 2027";
const SLUG = "autumn-2027";

test("an admin opens registration and emails a past player to come back", async ({
  browser,
}) => {
  const page = await pageAs(browser, "Admin");
  await page.goto("/app/admin/seasons/new");
  await page.getByLabel("Name").fill(SEASON);
  await page.getByLabel("First game day").fill("2027-09-07");
  await page.getByLabel("Last game day").fill("2027-11-09");
  await page.getByRole("radio", { name: "Per team" }).check();
  await page.getByLabel("Team fee ($)").fill("1200");
  await page.getByLabel("Free agent fee ($)").fill("75");
  await page.getByLabel("Opens", { exact: true }).fill("2026-01-01");
  await page.getByLabel("Closes", { exact: true }).fill("2027-08-31");
  await page.getByLabel("Payment deadline").fill("2027-09-01");
  await page.getByLabel("Smallest roster").fill("12");
  await page.getByLabel("Largest roster").fill("20");
  await page.getByRole("button", { name: "Create season" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/admin/seasons/${SLUG}\\?`));
  await page.getByLabel("Status").selectOption({ label: "Registration open" });
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(/\?saved=1/);

  await page.getByRole("link", { name: "Win back past players" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Win back past players",
  );
  const main = page.getByRole("main");
  const list = main.getByRole("listitem");
  await expect(list.first()).toBeVisible();
  await expectNoAxeViolations(page);

  // One click for the most loyal player on the list.
  const first = list.first();
  const name = (await first.locator(".font-bold").innerText()).trim();
  await first.getByRole("button", { name: `Email ${name}` }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Email queued for 1 player" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("main")
      .getByRole("listitem")
      .filter({ hasText: name })
      .getByText(/^Emailed /),
  ).toBeVisible();

  // The league's own wording.
  const subject = page.getByRole("main").getByLabel("Subject");
  await subject.fill("Your spot for {season} is waiting, {first_name}");
  await page
    .getByRole("main")
    .getByRole("button", { name: "Save the wording" })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Wording saved." }),
  ).toBeVisible();
  await expect(page.getByRole("main").getByLabel("Subject")).toHaveValue(
    "Your spot for {season} is waiting, {first_name}",
  );
  await expectNoAxeViolations(page);

  // The owner dashboard counts the email.
  await page.goto(`/app/owner/${SLUG}`);
  const winBack = page.getByRole("region", { name: "Win-back emails" });
  await expect(winBack.getByText("Emailed", { exact: true })).toBeVisible();
  await expect(winBack).toContainText("1");
  await expectNoAxeViolations(page);
  await page.context().close();
});

test("captains and players never see the win-back list", async ({
  browser,
}) => {
  const page = await pageAs(browser, "Captain");
  await page.goto(`/app/admin/seasons/${SLUG}/win-back`);
  await expect(
    page.getByRole("heading", { name: "We can't find that page" }),
  ).toBeVisible();
  await page.context().close();
});
