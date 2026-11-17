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

/**
 * A tool on a season's admin page. The tools sit in folded groups (Setup,
 * Players and money, Game day, Engagement); this opens the group that holds
 * it when needed.
 */
export async function seasonTool(page: Page, name: string): Promise<Locator> {
  const tools = page.getByRole("navigation", { name: "Season tools" });
  const link = tools.getByRole("link", { name, exact: true });
  const group = tools
    .locator("details")
    // A closed group's links are hidden, so the role query has to include them.
    .filter({
      has: page.getByRole("link", { name, exact: true, includeHidden: true }),
    });
  await expect(group).toHaveCount(1);
  if ((await group.getAttribute("open")) === null)
    await group.locator("summary").click();
  await expect(link).toBeVisible();
  return link;
}

/** Opens a screen's "More" actions (MoreActions), named by its group's label. */
export async function openMoreActions(page: Page, label: string) {
  const nav = page.getByRole("navigation", { name: label });
  const summary = nav.locator("summary", { hasText: "More" });
  if ((await nav.locator("details").getAttribute("open")) === null)
    await summary.click();
  return nav;
}
