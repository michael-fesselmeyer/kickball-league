import { expect, test } from "@playwright/test";
import { viewAs } from "./support/personas";

test.use({ colorScheme: "dark" });

test("a chosen theme survives a re-render of the whole page", async ({
  page,
}) => {
  await page.goto("/");
  const root = page.locator("html");
  // Nothing saved: the device setting (dark here) decides.
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(root).toHaveAttribute("data-theme", "light");
  await expect(
    page.getByRole("button", { name: "Switch to dark mode" }),
  ).toBeVisible();

  // Signing in as a demo persona runs a server action and re-renders <html>.
  await viewAs(page, "Captain");
  await expect(root).toHaveAttribute("data-theme", "light");
  await expect(
    page.getByRole("button", { name: "Switch to dark mode" }),
  ).toBeVisible();

  // Switching the role from the banner re-renders it again.
  await page
    .getByRole("complementary", { name: "Demo" })
    .getByRole("button", { name: "Player", exact: true })
    .click();
  await expect(page).toHaveURL(/\/app(\/|$)/);
  await expect(root).toHaveAttribute("data-theme", "light");
  expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe(
    "light",
  );
});
