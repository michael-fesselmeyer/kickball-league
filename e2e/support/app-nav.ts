import { expect, type Locator, type Page } from "@playwright/test";

/** The signed-in app's tab bar (src/app/app/app-nav.tsx). */
export const appTabs = (page: Page): Locator =>
  page.getByRole("navigation", { name: "App" });

/** Opens the app's grouped menu and returns it, once it's on screen. */
export async function openAppMenu(page: Page): Promise<Locator> {
  await appTabs(page).getByRole("button", { name: "Menu" }).click();
  const menu = page.getByRole("dialog", { name: "Menu" });
  await expect(menu).toBeVisible();
  return menu;
}

/** Opens the app's menu and follows one of its links. */
export async function goViaMenu(page: Page, name: string) {
  const menu = await openAppMenu(page);
  await menu.getByRole("link", { name, exact: true }).click();
}

/** The headings of the menu's groups, in order. */
export async function menuGroups(page: Page): Promise<string[]> {
  const menu = await openAppMenu(page);
  return menu.getByRole("heading", { level: 3 }).allTextContents();
}

/**
 * A tool in League admin's tool list. Only the everyday ones are in sight;
 * the rest sit under "All admin tools", which this opens when needed.
 */
export async function adminTool(page: Page, name: string): Promise<Locator> {
  const tools = page.getByRole("navigation", { name: "Admin tools" });
  const link = tools.getByRole("link", { name, exact: true });
  const more = tools.locator("summary", { hasText: "All admin tools" });
  await expect(async () => {
    if (!(await link.isVisible())) await more.click();
    await expect(link).toBeVisible({ timeout: 1_000 });
  }).toPass();
  return link;
}
