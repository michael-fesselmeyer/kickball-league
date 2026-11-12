import { expect, test, type Page } from "@playwright/test";

/**
 * The installable app (docs/architecture.md, section 14), in a production
 * build: Chrome's own installability check, the service worker, and what it
 * serves with no signal. Lighthouse dropped its installability audit in
 * version 12, so this asks Chrome directly, the way that audit did.
 */

async function workerReady(page: Page) {
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // The first load is not controlled yet; the next one is.
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(() => navigator.serviceWorker.controller !== null),
    )
    .toBe(true);
  // Installing saves the shell; wait until the offline page is in it.
  await expect
    .poll(() =>
      page.evaluate(async () => Boolean(await caches.match("/offline"))),
    )
    .toBe(true);
}

test("Chrome finds the app installable", async ({ page }) => {
  await workerReady(page);
  const cdp = await page.context().newCDPSession(page);
  const { installabilityErrors } = await cdp.send(
    "Page.getInstallabilityErrors",
  );
  expect(installabilityErrors).toEqual([]);

  const manifest = await page.evaluate(async () => {
    const link = document.querySelector<HTMLLinkElement>(
      'link[rel="manifest"]',
    );
    return link ? (await fetch(link.href)).json() : null;
  });
  expect(manifest).toMatchObject({
    display: "standalone",
    start_url: "/app",
    icons: expect.arrayContaining([
      expect.objectContaining({ sizes: "512x512", purpose: "maskable" }),
    ]),
  });
  // Light and dark browser chrome.
  await expect(page.locator('meta[name="theme-color"]')).toHaveCount(2);
});

test("with no signal, a page that is not saved shows the offline page", async ({
  page,
  context,
}) => {
  await workerReady(page);
  await context.setOffline(true);
  await page.goto("/about");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("No signal");
  // Saved with its styles, so it looks like the rest of the app.
  const background = await page.evaluate(
    () => getComputedStyle(document.body).backgroundColor,
  );
  expect(background).not.toBe("rgba(0, 0, 0, 0)");
  await context.setOffline(false);
});

test("signed-in screens are never kept on the device", async ({ page }) => {
  await workerReady(page);
  await page.goto("/app");
  await page.goto("/sign-in");
  const saved = await page.evaluate(async () => {
    const paths: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys())
        paths.push(new URL(request.url).pathname);
    }
    return paths;
  });
  expect(saved).toContain("/offline");
  expect(
    saved.filter((p) => p.startsWith("/app") || p.startsWith("/api")),
  ).toEqual([]);
});
