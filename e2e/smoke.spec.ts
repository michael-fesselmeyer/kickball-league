import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "./support/axe";

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test("home page loads and is accessible", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toContainText(
        "Kick a ball",
      );
      await expect(
        page.getByRole("link", { name: "Sign up for a season" }),
      ).toBeVisible();
      await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
      await expectNoAxeViolations(page);
    });

    for (const [path, heading, schemaType] of [
      ["/about", "meeting people", "SportsOrganization"],
      ["/faq", "Questions, answered", "FAQPage"],
      ["/parks/mccarren-park", "McCarren Park", "Park"],
      ["/nyc-kickball-league", "NYC kickball league", "SportsOrganization"],
      ["/free-agents", "on your own", "FAQPage"],
      ["/news/how-to-play-kickball", "How to play", "Article"],
    ] as const) {
      test(`${path} loads, carries structured data and is accessible`, async ({
        page,
      }) => {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toContainText(
          heading,
        );
        const jsonLd = await page
          .locator('script[type="application/ld+json"]')
          .textContent();
        const types = (JSON.parse(jsonLd ?? "[]") as { "@type": string }[]).map(
          (node) => node["@type"],
        );
        expect(types).toContain(schemaType);
        await expectNoAxeViolations(page);
      });
    }

    test("sign-in page is accessible", async ({ page }) => {
      await page.goto("/sign-in");
      await expect(page.getByLabel("Email")).toBeVisible();
      await expectNoAxeViolations(page);
    });

    for (const [path, heading] of [
      ["/history", "League history"],
      ["/records", "League records"],
      ["/seasons/fall-2026/bracket", "Playoffs"],
      ["/paused", "Everything is running"],
    ] as const) {
      test(`${path} is accessible`, async ({ page }) => {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(
          heading,
        );
        await expectNoAxeViolations(page);
      });
    }

    test("style guide is accessible", async ({ page }) => {
      await page.goto("/style");
      await expect(
        page.getByRole("img", { name: "The Big Kicks logo" }).first(),
      ).toBeVisible();
      await expectNoAxeViolations(page);
    });
  });
}

test("a signed-out visitor to /app is sent to sign in, and comes back after", async ({
  page,
}) => {
  await page.goto("/app/teams?season=spring");
  await expect(page).toHaveURL(
    /\/sign-in\?next=%2Fapp%2Fteams%3Fseason%3Dspring$/,
  );
  // Scoped to main: while the form streams in, React holds the new copy in a
  // hidden element outside it, next to the fallback's.
  await expect(
    page.getByRole("main").locator('input[name="next"]'),
  ).toHaveValue("/app/teams?season=spring");
});

test("Google sign-in stays hidden until it is configured", async ({ page }) => {
  // CI and local runs have no Google credentials, so only the email form shows.
  await page.goto("/sign-in");
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toHaveCount(0);
});

test("the theme switch remembers a choice across page loads", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Dark" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: "Dark" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("the page fits a phone screen without sideways scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  for (const path of [
    "/",
    "/about",
    "/faq",
    "/parks/mccarren-park",
    "/nyc-kickball-league",
    "/free-agents",
    "/news/how-to-play-kickball",
    "/friends",
    "/sign-in",
    "/style",
  ]) {
    await page.goto(path);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(0);
  }
});

test("robots.txt keeps search engines off a non-production build", async ({
  request,
}) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /");
  expect(robots).not.toContain("Sitemap:");
});

test("demo mode is off by default: no banner and no view-as", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("complementary", { name: "Demo" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "Admin" })).toHaveCount(0);
});
