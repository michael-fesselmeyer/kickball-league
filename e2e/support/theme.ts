import type { Locator, Page } from "@playwright/test";

/**
 * The theme button named `name`. It sits in the header on a wide screen
 * and inside the app; on a phone's public pages it is in the menu sheet
 * (src/components/site-header.tsx), so this opens the sheet first.
 */
export async function themeButton(page: Page, name: string): Promise<Locator> {
  const header = page.getByRole("banner");
  const inHeader = header.getByRole("button", { name });
  if (await inHeader.isVisible()) return inHeader;
  await header.getByRole("button", { name: "Menu" }).click();
  return page
    .getByRole("dialog", { name: "Menu" })
    .getByRole("button", { name });
}
