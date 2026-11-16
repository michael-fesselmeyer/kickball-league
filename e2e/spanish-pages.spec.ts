import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "./support/axe";

/**
 * More public pages in Spanish (ADR 0094): the standings and the help
 * center, read on a phone (this file runs in the phone project too) and
 * checked with axe. Read-only: it only opens pages the seed already has.
 */
test("the standings read in Spanish and keep the visitor in Spanish", async ({
  page,
}) => {
  await page.goto("/es/seasons/fall-2026/standings");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Clasificación",
  );
  // Column abbreviations are explained in Spanish.
  await expect(page.locator('abbr[title="Ganados"]').first()).toHaveText("G");
  await expect(
    page.getByRole("heading", { name: "Ranking de poder" }),
  ).toBeVisible();
  await expect(
    page.locator('link[rel="alternate"][hreflang="en"]'),
  ).toHaveAttribute("href", /\/seasons\/fall-2026\/standings$/);
  await expectNoAxeViolations(page);

  // A team in the table opens its Spanish page.
  const team = page.getByRole("table").first().getByRole("link").first();
  await expect(team).toHaveAttribute("href", /^\/es\/teams\//);
  await team.click();
  await expect(page).toHaveURL(/\/es\/teams\/[a-z0-9-]+$/);
  await expect(
    page.getByRole("heading", { name: "Próximo partido" }),
  ).toBeVisible();
});

test("the help center searches and reads in Spanish", async ({ page }) => {
  await page.goto("/es/help");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("¿Cómo");
  await page.getByLabel("Buscar en el centro de ayuda").fill("pagar");
  const results = page.getByRole("list", { name: "Resultados de la búsqueda" });
  await expect(results.getByRole("link").first()).toHaveText("Paga tu parte");
  await expectNoAxeViolations(page);

  await page.goto("/es/help/captain");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Ayuda para capitanes",
  );
  await expect(
    page.getByRole("heading", { level: 2, name: "Arma el orden de pateo" }),
  ).toBeVisible();
  await expectNoAxeViolations(page);

  // Admin help isn't in Spanish yet: its address goes to the English page.
  await page.goto("/es/help/admin");
  await expect(page).toHaveURL(/\/help\/admin$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});
