import { expect, test } from "@playwright/test";
import { pageAs } from "../support/personas";

/**
 * Server-rendered HTML must match what React renders in the browser. A
 * mismatch (React error #418) throws the page away and renders it again on
 * the client: slower, and a click in between can be lost. It happened on
 * every signed-in screen when the flows server ran a build made without
 * demo mode (#329), so these screens must load with no console errors.
 */
const PAGES = [
  "/sign-in",
  "/app",
  "/app/admin",
  "/app/books/fall-2026",
  "/app/books/fall-2026/permits",
  "/app/books/fall-2026/permits/capacity",
] as const;

test("signed-in screens hydrate without console errors", async ({
  browser,
}) => {
  const page = await pageAs(browser, "Admin");
  const errors: string[] = [];
  page.on("pageerror", (error) =>
    errors.push(`${page.url()}: ${error.message}`),
  );
  page.on("console", (message) => {
    if (message.type() === "error")
      errors.push(`${page.url()}: ${message.text()}`);
  });
  for (const path of PAGES) {
    await page.goto(path, { waitUntil: "load" });
    // Hydration runs once the scripts have loaded; wait until React is idle.
    await page.evaluate(
      () =>
        new Promise((done) =>
          requestIdleCallback(() => done(null), { timeout: 3000 }),
        ),
    );
  }
  expect(errors).toEqual([]);
  await page.context().close();
});
