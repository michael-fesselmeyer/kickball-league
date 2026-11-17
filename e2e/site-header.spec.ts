import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "./support/axe";

/**
 * The public header (docs/information-architecture.md, Navigation): top
 * links and a sign-in button on a wide screen, a Join button and a menu
 * sheet on a phone. Runs in both the phone and the desktop projects.
 */
test("the header leads to the season's standings on any screen", async ({
  page,
  isMobile,
}) => {
  await page.goto("/");
  const header = page.getByRole("banner");
  await expect(header.getByRole("link", { name: "Join" })).toBeVisible();

  if (isMobile) {
    // The links live in a sheet the menu button opens.
    await expect(header.getByRole("navigation", { name: "Main" })).toBeHidden();
    await header.getByRole("button", { name: "Menu" }).click();
    const sheet = page.getByRole("dialog", { name: "Menu" });
    await expect(sheet).toBeVisible();
    await expect(
      sheet.getByRole("link", { name: "Sign in or open the app" }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
    // Following a link closes the sheet on the way.
    await sheet.getByRole("link", { name: "Standings" }).click();
    await expect(sheet).toBeHidden();
  } else {
    const nav = header.getByRole("navigation", { name: "Main" });
    for (const name of ["Schedule", "Standings", "Events", "FAQ"])
      await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
    await expect(
      header.getByRole("link", { name: "Sign in or open the app" }),
    ).toBeVisible();
    await expect(header.getByRole("button", { name: "Menu" })).toBeHidden();
    await expectNoAxeViolations(page);
    await nav.getByRole("link", { name: "Standings", exact: true }).click();
  }

  // "Standings" opens the season being played, titled with its name.
  await expect(page).toHaveURL(/\/seasons\/[a-z0-9-]+\/standings$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    / standings$/,
  );
  await expect(page).toHaveTitle(/ standings · /);
});

test("the menu sheet closes with Escape", async ({ page, isMobile }) => {
  test.skip(!isMobile, "The menu button shows on phones only.");
  await page.goto("/faq");
  await page.getByRole("banner").getByRole("button", { name: "Menu" }).click();
  const sheet = page.getByRole("dialog", { name: "Menu" });
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});
