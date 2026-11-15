import { expect, test } from "@playwright/test";
import { pageAs } from "../support/personas";

/**
 * Language support (ADR 0065). Every page is served from its language's
 * route tree; English keeps the site's own addresses. Until a page is
 * translated, its other-language address goes to the English page.
 */
test("English pages keep their addresses and say they are in English", async ({
  page,
}) => {
  await page.goto("/faq");
  await expect(page).toHaveURL(/\/faq$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.goto("/en/faq");
  await expect(page).toHaveURL(/\/faq$/);
  // A page not translated yet goes to its English page.
  await page.goto("/es/seasons");
  await expect(page).toHaveURL(/\/seasons$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  // An address no page has is still the site's own not-found page.
  const missing = await page.goto("/no-such-page");
  expect(missing?.status()).toBe(404);
});

test("a player picks the language their emails come in", async ({
  browser,
}) => {
  const player = await pageAs(browser, "Player");
  await player.goto("/app/profile");
  const section = player.getByRole("region", { name: "Language" });
  await section.getByRole("radio", { name: "Español" }).check();
  await section.getByRole("button", { name: "Save language" }).click();
  const saved = player.getByRole("region", { name: "Idioma" });
  await expect(saved.getByRole("status")).toContainText("Español");
  await expect(saved.getByRole("radio", { name: "Español" })).toBeChecked();
  // The app's screens stay in English for now.
  await expect(player.locator("html")).toHaveAttribute("lang", "en");
  // Back to English, from the Spanish words.
  await saved.getByRole("radio", { name: "English" }).check();
  await saved.getByRole("button", { name: "Guardar idioma" }).click();
  await expect(
    player.getByRole("region", { name: "Language" }).getByRole("status"),
  ).toContainText("English");
  await player.context().close();
});
