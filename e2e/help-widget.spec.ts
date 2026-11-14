import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "./support/axe";

/**
 * A captain looks for help with the kicking order: the search narrows the
 * how-tos as they type, and the result opens the captain page at that
 * how-to. Then a sponsor bar gets the schedule widget: the snippet copies,
 * the preview frames the widget, and the widget itself is a small page with
 * no script.
 */
test("search the help center, then get the schedule widget", async ({
  page,
  context,
  browserName,
}) => {
  await page.goto("/help");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "How do I",
  );
  // Every how-to is in the page before any script runs.
  await expect(
    page.getByRole("link", { name: "Call a rain-out" }),
  ).toBeVisible();
  await expectNoAxeViolations(page);

  await page.getByLabel("Search the help center").fill("kicking order");
  const results = page.getByRole("list", { name: "Search results" });
  await expect(page.getByRole("status")).toHaveText(/^\d+ how-tos? found\.$/);
  // The how-to with the words in its title comes first.
  await expect(results.getByRole("link").first()).toHaveText(
    "Build a kicking order",
  );
  await expectNoAxeViolations(page);

  await page.getByLabel("Search the help center").fill("zeppelin");
  await expect(page.getByRole("status")).toContainText("Nothing matches");

  await page.getByLabel("Search the help center").fill("lineup");
  await results.getByRole("link", { name: "Build a kicking order" }).click();
  await expect(page).toHaveURL(/\/help\/captain#lineup$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Help for captains",
  );
  await expect(
    page.getByRole("heading", { level: 2, name: "Build a kicking order" }),
  ).toBeInViewport();
  await expectNoAxeViolations(page);

  await page.goto("/widget");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "on your site",
  );
  const snippet = page.getByLabel("Paste this into your site's HTML");
  await expect(snippet).toHaveValue(
    /^<iframe src="http:\/\/localhost:\d+\/embed\/schedule" title="Kickball League: next games"/,
  );
  if (browserName === "chromium") {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByRole("button", { name: "Copy" }).first().click();
    await expect(page.getByText("Copied.")).toBeVisible();
  }

  // The preview frames the league's widget, which only /embed allows.
  const preview = page.frameLocator(
    'iframe[title="Kickball League: next games (preview)"]',
  );
  // The heading and the footer both link home; check the heading's.
  const heading = preview.getByRole("heading", { level: 1 });
  await heading.scrollIntoViewIfNeeded();
  await expect(
    heading.getByRole("link", { name: "Kickball League" }),
  ).toBeVisible();

  await page.locator("summary", { hasText: "The Big Kicks" }).click();
  await expect(page.getByLabel("Snippet for The Big Kicks")).toHaveValue(
    /\/embed\/schedule\/the-big-kicks" title="The Big Kicks: next games"/,
  );
  await expectNoAxeViolations(page);

  await page
    .getByRole("link", { name: "Preview the widget for The Big Kicks" })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "The Big Kicks",
  );
  expect(await page.locator("script").count()).toBe(0);
  await expectNoAxeViolations(page);
});

/** Only the widget may be framed by other sites; every other page refuses. */
test("only the schedule widget can be framed", async ({ request }) => {
  for (const path of ["/embed/schedule", "/embed/schedule/the-big-kicks"]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    const headers = response.headers();
    expect(headers["content-security-policy"], path).toContain(
      "frame-ancestors *",
    );
    expect(headers["x-frame-options"], path).toBeUndefined();
  }
  for (const path of ["/", "/help", "/widget", "/sign-in", "/app"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    const headers = response.headers();
    expect(headers["content-security-policy"], path).toContain(
      "frame-ancestors 'none'",
    );
    expect(headers["x-frame-options"], path).toBe("DENY");
  }
});
