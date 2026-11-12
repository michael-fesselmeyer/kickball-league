import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/** WCAG 2.2 AA, the project's target (docs/design-system.md). */
const WCAG_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectNoAxeViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(WCAG_AA)
    .analyze();
  const summary = violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help} — ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
  );
  expect(summary).toEqual([]);
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test("home page loads and is accessible", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toContainText(
        "Kick a ball",
      );
      await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test("sign-in page is accessible", async ({ page }) => {
      await page.goto("/sign-in");
      await expect(page.getByLabel("Email")).toBeVisible();
      await expectNoAxeViolations(page);
    });

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
  await expect(page.locator('input[name="next"]')).toHaveValue(
    "/app/teams?season=spring",
  );
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
  for (const path of ["/", "/sign-in", "/style"]) {
    await page.goto(path);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(0);
  }
});
