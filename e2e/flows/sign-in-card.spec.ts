import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";

/**
 * The header and footer are static and can't tell who is signed in, so
 * their "Sign in or open the app" opens /sign-in, which offers someone
 * already signed in the way into the app, or out, instead of the email form.
 */
test("a signed-in player opening /sign-in is offered their games", async ({
  browser,
}) => {
  const page = await pageAs(browser, "Player");
  await page.goto("/sign-in");
  const card = page.getByRole("region", { name: /You're signed in as/ });
  await expect(card).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveCount(0);
  await expectNoAxeViolations(page);

  await card.getByRole("link", { name: "Go to your games" }).click();
  await expect(page).toHaveURL(/\/app$/);

  await page.goto("/sign-in");
  await page
    .getByRole("region", { name: /You're signed in as/ })
    .getByRole("button", { name: "Sign out" })
    .click();
  await expect(page.getByLabel("Email")).toBeVisible();
  await page.context().close();
});
