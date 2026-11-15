import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";

/**
 * The rules page and its change log (ADR 0062), at phone width. The seed
 * publishes sample rules for the demo league (src/seed/rules.ts).
 */
test.use({ viewport: { width: 390, height: 844 } });

/** A day in New York, the demo league's time zone, `days` from today. */
function nyDay(days: number): string {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return new Date(Date.parse(`${today}T12:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

test("an admin publishes a rule change with a notice, and the rules page shows it", async ({
  browser,
}) => {
  const admin = await pageAs(browser, "Admin");
  await admin.goto("/app/admin/rules");
  await expect(admin.getByRole("heading", { level: 1 })).toHaveText(
    "League rules",
  );
  const fielding = admin.getByRole("group", { name: /^Section \d+$/ }).filter({
    has: admin.locator('input[name="title"][value="Fielding"]'),
  });
  const newText =
    "Sample rules for the demo league.\n\nNine players field at a time.";
  await fielding.getByLabel("Text").fill(newText);
  await admin
    .getByLabel("What changed, in one line")
    .fill("Nine players field, not ten");
  await admin.getByLabel("Email every player in the active seasons").check();
  await admin.getByLabel("Takes effect").fill(nyDay(1));
  await admin.getByRole("button", { name: "Publish the change" }).click();
  // Too soon for a notice: refused, and nothing typed is lost.
  await expect(
    admin.getByRole("alert").filter({ hasText: "3 days' notice" }),
  ).toBeVisible();
  await expect(fielding.getByLabel("Text")).toHaveValue(newText);
  await expectNoAxeViolations(admin);

  await admin.getByLabel("Takes effect").fill(nyDay(3));
  await admin.getByRole("button", { name: "Publish the change" }).click();
  await expect(admin.getByRole("status").first()).toContainText(
    /Published\. The notice is on its way to \d+ players\./,
  );
  await admin.context().close();

  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto("/rules");
  await expect(visitor.getByRole("heading", { level: 1 })).toHaveText(
    "League rules",
  );
  const section = visitor.getByRole("region", { name: "Fielding" });
  await expect(section).toContainText("Nine players field at a time.");
  await expect(section).toContainText("New wording from");
  const changes = visitor.getByRole("region", { name: "What changed" });
  await expect(changes.getByRole("listitem").first()).toContainText(
    "Nine players field, not ten",
  );
  await expect(
    changes
      .getByRole("listitem")
      .first()
      .getByRole("link", { name: "Fielding" }),
  ).toHaveAttribute("href", "#fielding");
  await expectNoAxeViolations(visitor);
  await visitor.context().close();
});

test("the help center links to the rules", async ({ page }) => {
  await page.goto("/help");
  await page.getByRole("link", { name: "league rules" }).click();
  await expect(page).toHaveURL(/\/rules$/);
  await expect(page.getByRole("region", { name: "Lineups" })).toBeVisible();
});
