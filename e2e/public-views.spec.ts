import { expect, type Page, test } from "@playwright/test";

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

// Kickoff times are the league's: a phone set to another zone, a visitor
// from Tokyo or a player back from a trip west, reads the same times.
for (const path of [
  "/seasons/fall-2026/schedule",
  "/teams/the-big-kicks",
  "/events",
]) {
  test(`${path} reads the same on a phone in another time zone`, async ({
    browser,
    baseURL,
  }) => {
    const textIn = async (timezoneId: string) => {
      const context = await browser.newContext({
        ...(baseURL ? { baseURL } : {}),
        timezoneId,
      });
      const page = await context.newPage();
      await page.goto(path);
      await expect(page.locator("main")).not.toContainText("Loading");
      const text = await page.locator("main").innerText();
      await context.close();
      return text;
    };
    const [home, away] = await Promise.all([
      textIn("America/New_York"),
      textIn("Asia/Tokyo"),
    ]);
    expect(home.length).toBeGreaterThan(0);
    expect(away).toBe(home);
  });
}

/** The structured data a page carries, as a list of its nodes' types. */
async function jsonLdTypes(page: Page) {
  const scripts = await page
    .locator('script[type="application/ld+json"]')
    .allTextContents();
  return scripts
    .flatMap((s) => [JSON.parse(s) as unknown].flat())
    .map((node) => (node as { "@type": string })["@type"]);
}

test("team and game pages carry SportsTeam and SportsEvent structured data", async ({
  page,
}) => {
  await page.goto("/teams/the-big-kicks");
  expect(await jsonLdTypes(page)).toContain("SportsTeam");

  await page.goto("/seasons/fall-2026/schedule");
  const game = await page
    .locator('main a[href^="/games/"]')
    .first()
    .getAttribute("href");
  expect(game).toBeTruthy();
  await page.goto(game ?? "/");
  expect(await jsonLdTypes(page)).toContain("SportsEvent");
});

test("the sitemap lists team and schedule pages", async ({ request }) => {
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).toMatch(/\/teams\/the-big-kicks</);
  expect(sitemap).toMatch(/\/seasons\/fall-2026\/schedule</);
});
