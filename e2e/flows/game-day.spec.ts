import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";

/**
 * The game-day command center (issue #257) at phone width: an admin keeps
 * it open while the ref checks in from their own phone, and the admin's
 * screen shows it within 15 seconds without a reload. The demo ref has the
 * games of the seed's fifth round (src/seed/demo-personas.ts), on
 * October 13, 2026; the screen opens on a day from its query string.
 */
test.use({ viewport: { width: 390, height: 844 } });

const DAY = "2026-10-13";

test("an admin watches the ref check in on the game-day screen without reloading", async ({
  browser,
}) => {
  const admin = await pageAs(browser, "Admin");
  await admin.goto("/app/admin");
  await expect(
    admin.getByRole("link", { name: "Game day screen" }),
  ).toBeVisible();
  await admin.goto(`/app/admin/today?date=${DAY}`);
  await expect(admin.getByRole("heading", { level: 1 })).toHaveText("Game day");
  const screen = admin.getByRole("main");
  await expect(
    screen.getByRole("link", { name: "Call a rain-out" }),
  ).toHaveAttribute("href", new RegExp(`/rainout\\?date=${DAY}$`));
  await expect(
    screen.getByRole("link", { name: "Send an announcement" }),
  ).toBeVisible();
  const games = screen.getByRole("listitem").filter({ hasText: "Ref " });
  await expect(games.first()).toBeVisible();
  await expect(
    screen.getByText(/: not (here|checked in) yet/).first(),
  ).toBeVisible();
  await expectNoAxeViolations(admin);
  // A marker that a full reload would wipe.
  await admin.evaluate(() => {
    document.body.dataset.sameLoad = "yes";
  });

  // The ref, on their own phone, says they are at the field.
  const ref = await pageAs(browser, "Ref");
  const refereeing = ref.getByRole("region", {
    name: "Games you're refereeing",
  });
  await refereeing
    .getByRole("button", { name: /^I'm at the field/ })
    .first()
    .click();
  await expect(refereeing.getByText("Checked in").first()).toBeVisible();
  await expectNoAxeViolations(ref);
  await ref.context().close();

  // The admin's open screen catches up on its own.
  await expect(screen.getByText(/: at the field$/).first()).toBeVisible({
    timeout: 15_000,
  });
  expect(await admin.evaluate(() => document.body.dataset.sameLoad)).toBe(
    "yes",
  );
  await admin.context().close();
});

test("the game-day screen and its numbers are for admins only", async ({
  browser,
}) => {
  const page = await pageAs(browser, "Captain");
  await page.goto(`/app/admin/today?date=${DAY}`);
  await expect(
    page.getByRole("heading", { name: "This page could not be found." }),
  ).toBeVisible();
  const state = await page.request.get(
    `/app/admin/today/state.json?date=${DAY}`,
  );
  expect(state.status()).toBe(404);
  await page.context().close();
});
