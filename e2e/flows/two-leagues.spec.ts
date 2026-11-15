import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";

/**
 * Two leagues side by side on one deployment (ADR 0048). The seed adds a
 * small flag football league whose season (fall-2026) and one team
 * (the-big-kicks) share their slugs with the kickball league's, so every
 * page has to pick the right league from its path. The demo player plays in
 * both and switches between them in the app; the kickball admin has no
 * rights in the football league; the operator starts a third league and its
 * home page is there at once.
 */
const FOOTBALL = "/l/flag-football";
const FOOTBALL_NAME = "Sunday Flag Football (demo)";
/** The site's not-found page (src/app/[lang]/not-found.tsx). */
const NOT_FOUND = "We can't find that page";

test("each league's public pages show that league's data only, at its own address", async ({
  page,
}) => {
  await page.goto(FOOTBALL);
  await expect(
    page.getByRole("heading", { level: 1, name: FOOTBALL_NAME }),
  ).toBeVisible();
  await expect(page.getByText("Flag football", { exact: true })).toBeVisible();
  await expectNoAxeViolations(page);

  // The same season slug: football's schedule names football teams only.
  await page.goto(`${FOOTBALL}/seasons/fall-2026/schedule`);
  await expect(
    page.getByText("Hail Marys").filter({ visible: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("Sun Kickers")).toHaveCount(0);
  await expectNoAxeViolations(page);
  await page.goto("/seasons/fall-2026/schedule");
  await expect(
    page.getByText("Sun Kickers").filter({ visible: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("Hail Marys")).toHaveCount(0);

  // The same team slug: each league's page is its own team's.
  await page.goto(`${FOOTBALL}/teams/the-big-kicks`);
  await expect(
    page
      .getByText(/Red Zone Regulars|Hail Marys|Sunday Scramblers/)
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
  await expectNoAxeViolations(page);
  // Links on football's pages stay in football's address space.
  const hrefs = await page
    .locator('main a[href^="/"]')
    .evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""));
  for (const href of hrefs.filter((h) => /^\/(seasons|teams|games)\//.test(h)))
    throw new Error(`A football page links to the default league: ${href}`);

  // Standings, for both leagues.
  await page.goto(`${FOOTBALL}/seasons/fall-2026/standings`);
  await expect(page.getByRole("heading", { name: "Standings" })).toBeVisible();
  await expect(
    page.getByText("Hail Marys").filter({ visible: true }).first(),
  ).toBeVisible();
  await expectNoAxeViolations(page);
});

test("the default league keeps one address", async ({ page }) => {
  // Its slug's pages move to the site's own URL. The page does that, so the
  // first answer is the page or, once cached, a redirect: check where the
  // browser lands, not the first answer's status (issue 429).
  await page.goto("/l/demo-league/records");
  await expect(page).toHaveURL(/\/records$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // `_default`, the internal name of the site's own pages, is sent to the
  // site's own URL by the proxy before any page loads. Asked of the server
  // directly, so no navigation can cancel another (issue 429).
  const internal = await page.request.get("/l/_default/history", {
    maxRedirects: 0,
  });
  expect(internal.status()).toBe(308);
  expect(new URL(internal.headers().location ?? "", page.url()).pathname).toBe(
    "/history",
  );

  // A league that doesn't exist, in a page of its own for the same reason.
  const unknown = await page.context().newPage();
  await unknown.goto("/l/no-such-league");
  await expect(unknown.getByRole("heading", { name: NOT_FOUND })).toBeVisible();
});

test("a player in two leagues switches between them in the app", async ({
  browser,
}) => {
  const page = await pageAs(browser, "Player");
  await page.goto("/app");
  const leagues = page.getByRole("navigation", { name: "Your leagues" });
  await expect(leagues).toBeVisible();
  await leagues
    .getByRole("link", { name: `Switch to ${FOOTBALL_NAME}` })
    .click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(
    page
      .getByRole("navigation", { name: "Your leagues" })
      .getByText(FOOTBALL_NAME),
  ).toBeVisible();
  await expectNoAxeViolations(page);
  // And back.
  await page
    .getByRole("navigation", { name: "Your leagues" })
    .getByRole("link", { name: /Switch to Kickball League/ })
    .click();
  await expect(
    page
      .getByRole("navigation", { name: "Your leagues" })
      .getByText("Kickball League (demo)"),
  ).toBeVisible();
  await page.context().close();
});

test("an admin of one league has no admin pages in the other", async ({
  browser,
}) => {
  const page = await pageAs(browser, "Admin");
  await page.goto("/app/admin/seasons");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.goto(
    `/app/league/flag-football?next=${encodeURIComponent("/app/admin/seasons")}`,
  );
  await expect(page.getByRole("heading", { name: NOT_FOUND })).toBeVisible();
  // Back home, the kickball admin pages are there again.
  await page.goto(
    `/app/league/demo-league?next=${encodeURIComponent("/app/admin/seasons")}`,
  );
  await expect(page.getByRole("heading", { name: NOT_FOUND })).toHaveCount(0);
  await page.context().close();
});

test("the operator starts a league and its home page is there at once", async ({
  browser,
}) => {
  // On the flows server the demo admin is the platform operator.
  const page = await pageAs(browser, "Admin");
  const slug = `volleyball-${Date.now().toString(36)}`;
  await page.goto("/operator");
  const form = page.getByRole("group", { name: "Start a league" });
  await form.getByLabel("Name", { exact: true }).fill("Tuesday Volleyball");
  await form.getByLabel("Address").fill(slug);
  await form.getByLabel("Sport").selectOption("volleyball");
  await form.getByRole("button", { name: "Create league" }).click();
  await expect(page.getByRole("status")).toHaveText("League created.");
  await expect(
    page.getByRole("link", { name: `Public pages at /l/${slug}` }),
  ).toBeVisible();
  await expectNoAxeViolations(page);

  await page.goto(`/l/${slug}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Tuesday Volleyball" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "The first season's schedule shows here once it is published.",
    ),
  ).toBeVisible();
  await page.context().close();
});
