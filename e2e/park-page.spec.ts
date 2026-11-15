import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "./support/axe";

/** The seeded park (src/seed/generate.ts). */
const PARK = "/fields/mccarren-park";

test("a park's page says who holds the fields, shows the house rules and is accessible", async ({
  page,
}) => {
  await page.goto(PARK);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "McCarren Park",
  );
  await expect(page.getByText("Permitted by NYC Parks")).toBeVisible();
  await expect(page.getByRole("region", { name: "House rules" })).toContainText(
    "No alcohol, glass or speakers",
  );
  // Today's line is worked out in the browser, so it appears after hydration.
  await expect(page.getByRole("status")).toBeVisible();
  // Only a permit's number, field, dates and hours are public.
  await expect(page.locator("main")).not.toContainText(/\$\d|document/i);
  await expectNoAxeViolations(page);
});

test("a park that does not exist is not found", async ({ page }) => {
  const response = await page.goto("/fields/no-such-park");
  expect(response?.status()).toBe(404);
});

test("the park page fits a phone screen", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(PARK);
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
