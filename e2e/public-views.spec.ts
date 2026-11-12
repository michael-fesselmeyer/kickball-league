import { expect, test } from "@playwright/test";

/**
 * The schedule, standings and team pages are cached and served as static
 * HTML. Their query-string views are rewritten to a path segment by
 * src/proxy.ts; these check the views still work at the same addresses.
 */
test("the schedule filters to one team with ?team=", async ({ page }) => {
  await page.goto("/seasons/fall-2026/schedule?team=the-big-kicks");
  await expect(page).toHaveURL(/\?team=the-big-kicks$/);
  await expect(page.getByRole("status")).toHaveText(
    /^Showing \d+ games for The Big Kicks\.$/,
  );
  await expect(
    page.getByRole("link", { name: "The Big Kicks team page and calendar" }),
  ).toBeVisible();
});

test("choosing All teams goes back to the whole schedule", async ({ page }) => {
  await page.goto("/seasons/fall-2026/schedule?team=the-big-kicks");
  await page.getByLabel("Team").selectOption({ label: "All teams" });
  await page.getByRole("button", { name: "Show" }).click();
  await expect(page.getByRole("status")).toHaveText(
    /^Showing all \d+ games\.$/,
  );
});

test("a team page shows another season with ?season=", async ({ page }) => {
  await page.goto("/teams/the-big-kicks?season=spring-2026");
  await expect(page).toHaveURL(/\?season=spring-2026$/);
  await expect(
    page.getByRole("navigation", { name: "Seasons" }).getByRole("link", {
      name: "Spring 2026",
    }),
  ).toHaveAttribute("aria-current", "page");
});

for (const path of [
  "/seasons/no-such-season/schedule",
  "/seasons/no-such-season/standings",
  "/teams/no-such-team",
]) {
  // The lookup runs inside a Suspense boundary, after the page has started
  // streaming, so the status is already sent: check the page instead.
  test(`${path} shows the not-found page`, async ({ page }) => {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: "This page could not be found." }),
    ).toBeVisible();
  });
}
