import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";

/** Players mostly open game-day screens on phones. */
const PHONE = { width: 390, height: 844 };

const announced = (page: Page) => page.locator("[aria-live=polite]");

/**
 * Casey Captain opens The Big Kicks' kicking order for their game against
 * the Sun Kickers (src/seed/lineups.ts). The saved order has three women
 * in a row; auto-arrange fixes it, Casey moves two players by keyboard and
 * button, and saves. Reese Ref, who referees the game, sees the order
 * without anyone's gender, and Pat Player sees only their own spot.
 */
test("a captain sets a kicking order that keeps to the two-in-a-row rule", async ({
  browser,
}) => {
  // Three people sign in and the page is scanned four times.
  test.slow();
  const captain = await pageAs(browser, "Captain");
  await captain.setViewportSize(PHONE);
  await captain.goto("/app/seasons/fall-2026/team");
  await captain
    .getByRole("listitem")
    .filter({ hasText: "vs Sun Kickers" })
    .getByRole("link", { name: "Edit kicking order" })
    .click();
  await expect(
    captain.getByRole("heading", { name: "The Big Kicks vs Sun Kickers" }),
  ).toBeVisible();
  await expect(captain.getByText(/make three women in a row\./)).toBeVisible();
  await expectNoAxeViolations(captain);

  await captain.getByRole("button", { name: "Auto-arrange" }).click();
  await expect(captain.getByText(/^Keeps to the rule/)).toBeVisible();
  await expect(announced(captain)).toHaveText(/^Arranged so no more than two/);

  // Pick up the first kicker with the keyboard and move them one down.
  const first = captain.getByRole("button", { name: /, 1st of 10$/ });
  await first.focus();
  await captain.keyboard.press("Space");
  await expect(announced(captain)).toHaveText(/^Picked up /);
  await captain.keyboard.press("ArrowDown");
  await captain.keyboard.press("Space");
  await expect(announced(captain)).toHaveText(/now kicks 2nd of 10\.$/);
  await expect(
    captain.getByRole("button", { name: /, 2nd of 10$/ }),
  ).toBeFocused();

  // And the third kicker up one, with a button.
  await captain
    .getByRole("button", { name: /^Move .* up$/ })
    .nth(2)
    .click();
  await expect(announced(captain)).toHaveText(/now kicks 2nd of 10\.$/);
  await expect(captain.getByText(/^Keeps to the rule/)).toBeVisible();
  await expectNoAxeViolations(captain);

  const leadOff = (
    (await captain
      .getByRole("button", { name: /, 1st of 10$/ })
      .getAttribute("aria-label")) ?? ""
  ).replace(/^Move (.*), 1st of 10$/, "$1");
  await captain.getByRole("button", { name: "Save kicking order" }).click();
  await expect(captain.getByRole("status")).toHaveText(/^Saved\. Your players/);

  // The earlier game's order can be copied in.
  await captain.getByRole("button", { name: "Copy last game" }).click();
  await expect(announced(captain)).toHaveText(
    /^Copied the order from your last game\./,
  );

  // Reese Ref sees the saved order on game day, names only.
  const ref = await pageAs(browser, "Ref");
  await ref.setViewportSize(PHONE);
  await ref
    .getByRole("link", {
      name: "Kicking orders for The Big Kicks vs Sun Kickers",
    })
    .click();
  const bigKicks = ref.getByRole("region", { name: "The Big Kicks" });
  await expect(bigKicks.getByRole("listitem")).toHaveCount(10);
  await expect(bigKicks).toContainText("Keeps to the two-in-a-row rule");
  await expect(bigKicks.getByRole("listitem").first()).toContainText(leadOff);
  await expect(ref.getByText(/Counts with/)).toHaveCount(0);
  await expect(ref.getByRole("region", { name: "Sun Kickers" })).toContainText(
    "No order saved yet.",
  );
  await expectNoAxeViolations(ref);

  // Pat Player sees their own spot, not the whole order.
  const player = await pageAs(browser, "Player");
  await player.setViewportSize(PHONE);
  await player.goto("/app/seasons/fall-2026/team");
  await player
    .getByRole("listitem")
    .filter({ hasText: "vs Sun Kickers" })
    .getByRole("link", { name: /^You kick \d+(st|nd|rd|th) of 10$/ })
    .click();
  await expect(
    player.getByText(/^You kick \d+(st|nd|rd|th) of 10\.$/),
  ).toBeVisible();
  await expect(
    player.getByRole("region", { name: "The Big Kicks" }).getByRole("listitem"),
  ).toHaveCount(0);
  await expectNoAxeViolations(player);
});
