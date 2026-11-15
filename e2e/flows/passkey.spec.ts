import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";

/**
 * A player adds a passkey from the account page, signs out, and signs back
 * in with it. Chromium's virtual authenticator stands in for Face ID or
 * Touch ID: it holds the passkey and approves each request.
 */
test("a player adds a passkey and signs in with it", async ({ browser }) => {
  const page = await pageAs(browser, "Player");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  // Signing in just now makes the session fresh, so adding is allowed.
  await page.goto("/app/profile/security");
  await expect(
    page.getByRole("heading", { name: "Passkeys and devices" }),
  ).toBeVisible();
  await expect(page.getByText("This device", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add a passkey" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Passkey added. Next time, sign in with it.",
  );
  const passkeys = page.getByRole("region", { name: "Passkeys" });
  await expect(passkeys.getByText("On one device")).toBeVisible();
  await expectNoAxeViolations(page);

  // Signed out, the passkey signs the player back in without an email.
  await page.context().clearCookies();
  await page.goto("/sign-in");
  // The tap can land before the page's script is ready, and the first one
  // loads the passkey code on demand before it signs in, which is slow on a
  // busy runner. So tap again until the player is signed in, and wait for
  // that end state rather than for one redirect to beat a short timeout.
  await expect(async () => {
    if (!new URL(page.url()).pathname.startsWith("/app"))
      await page
        .getByRole("button", { name: "Sign in with a passkey" })
        .click({ timeout: 2_000 });
    await expect(page).toHaveURL(/\/app(\/|$)/, { timeout: 8_000 });
  }).toPass({ timeout: 45_000 });

  await page.goto("/app/profile/security");
  await expect(page.getByText("This device", { exact: true })).toBeVisible();
  await expect(passkeys.getByText("On one device")).toBeVisible();
});
