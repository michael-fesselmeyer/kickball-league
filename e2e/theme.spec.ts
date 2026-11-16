import { expect, test } from "@playwright/test";
import { seededPlayerEmail } from "./support/seed-data";
import { signIn } from "./support/sign-in";

test.use({ colorScheme: "dark" });

test("a chosen theme survives signing in and a rebuilt <html>", async ({
  page,
}) => {
  await page.goto("/");
  const root = page.locator("html");
  // Nothing saved: the device setting (dark here) decides.
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(root).toHaveAttribute("data-theme", "light");

  await signIn(page, await seededPlayerEmail());
  await expect(root).toHaveAttribute("data-theme", "light");
  await expect(
    page.getByRole("button", { name: "Switch to dark mode" }),
  ).toBeVisible();

  // React rebuilding <html> from the server render drops the attribute;
  // the switch puts the saved theme back.
  await page.evaluate(() =>
    document.documentElement.removeAttribute("data-theme"),
  );
  await expect(root).toHaveAttribute("data-theme", "light");
  expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe(
    "light",
  );
});
