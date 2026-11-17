import { expect, test, type Page } from "@playwright/test";

/**
 * The footer's language links (ADR 0094) once the service worker controls
 * the page, as it does from the second page view on. The worker fetches
 * pages itself, so a link that leaned on the Referer alone used to land on
 * `/sw.js` or the language's home page.
 */

async function workerInCharge(page: Page, path: string) {
  await page.goto(path);
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
}

const languageLink = (page: Page, name: string) =>
  page.locator("footer").getByRole("link", { name, exact: true });

test("switching language keeps the page, with the service worker in charge", async ({
  page,
}) => {
  await workerInCharge(page, "/faq");

  await languageLink(page, "Español").click();
  await expect(page).toHaveURL(/\/es\/faq$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "es");

  await languageLink(page, "English").click();
  await expect(page).toHaveURL(/\/faq$/);
  expect(new URL(page.url()).pathname).toBe("/faq");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("the worker passes the page's own Referer on to the switch", async ({
  page,
}) => {
  await workerInCharge(page, "/es/faq");
  // Leave the link as the server renders it, so only the Referer names the
  // page: this is the path a phone with the script blocked takes.
  await page.evaluate(() => {
    for (const link of document.querySelectorAll("a[data-language-switch]"))
      link.removeAttribute("data-language-switch");
  });

  await languageLink(page, "English").click();
  await expect(page).toHaveURL(/\/faq$/);
  expect(new URL(page.url()).pathname).toBe("/faq");
});
