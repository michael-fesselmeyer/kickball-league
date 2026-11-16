import { expect, type Browser, type Page } from "@playwright/test";

/** The demo personas in the banner's picker (src/lib/demo/personas.ts). */
export type Persona = "Player" | "Captain" | "Ref" | "Admin";

/**
 * Signs in as a demo persona with the banner's "Viewing as" picker
 * (docs/adr/0004-demo-mode.md), the same way a demo visitor does.
 */
export async function viewAs(page: Page, persona: Persona) {
  await page.goto("/sign-in");
  const banner = page.getByRole("complementary", { name: "Demo" });
  await banner
    .getByRole("combobox", { name: "Viewing as" })
    .selectOption({ label: persona });
  await banner.getByRole("button", { name: "Go" }).click();
  await expect(page).toHaveURL(/\/app(\/|$)/);
}

/** A separate browser session signed in as a persona. */
export async function pageAs(browser: Browser, persona: Persona) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await viewAs(page, persona);
  return page;
}

/**
 * Personas start without a phone, birth date, shirt size or emergency
 * contact, which registration needs. Fills them in with invented values (555-01xx numbers
 * are reserved for fiction).
 */
export async function completeProfile(page: Page) {
  await page.goto("/app/profile");
  await page.getByLabel("Mobile phone").fill("(718) 555-0142");
  await page.getByLabel("Birth date").fill("1994-05-17");
  // Every sign-up form asks for a size and starts at the profile's.
  await page
    .getByRole("combobox", { name: "Shirt size" })
    .selectOption({ label: "M" });
  const emergency = page.getByRole("group", { name: "Emergency contact" });
  await emergency.getByLabel("Name").fill("Sam Example");
  await emergency.getByLabel("Phone").fill("(718) 555-0199");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page).toHaveURL(/\/app\/profile\?saved=1/);
}
