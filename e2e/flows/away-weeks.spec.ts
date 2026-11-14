import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";

/** Players mostly open these screens on phones. */
const PHONE = { width: 390, height: 844 };

/**
 * Pat Player marks a spring week away from the team page's link to the
 * profile (src/seed/away-weeks.ts puts Pat on The Big Kicks' spring
 * roster). Casey Captain opens the kicking order for The Big Kicks' last
 * fall game, whose week the seed left short, and sees who is away and that
 * the team can't field a full lineup.
 */
test("a player marks a week away and the captain sees the week short", async ({
  browser,
}) => {
  test.slow();
  const player = await pageAs(browser, "Player");
  await player.setViewportSize(PHONE);
  await player.goto("/app/seasons/fall-2026/team");
  await player
    .getByRole("link", { name: "Away some weeks? Mark them" })
    .click();
  const away = player.getByRole("region", { name: "Weeks you'll miss" });
  const spring = away.getByRole("group", { name: /Spring 2027/ });
  await expect(spring).toContainText("The Big Kicks");
  const week = spring.getByRole("checkbox", { name: /Week of Apr 12/ });
  await week.check();
  await expectNoAxeViolations(player);
  await away
    .getByRole("button", { name: "Save away weeks for Spring 2027" })
    .click();
  await expect(away.getByRole("status")).toHaveText(/^Away weeks saved\./);
  await expect(
    player
      .getByRole("group", { name: /Spring 2027/ })
      .getByRole("checkbox", { name: /Week of Apr 12/ }),
  ).toBeChecked();

  const captain = await pageAs(browser, "Captain");
  await captain.setViewportSize(PHONE);
  await captain.goto("/app/seasons/fall-2026/team");
  await captain
    .getByRole("listitem")
    .filter({ hasText: "vs Sun Kickers" })
    .getByRole("link", { name: /kicking order$/ })
    .click();
  await expect(
    captain.getByRole("heading", { name: "The Big Kicks vs Sun Kickers" }),
  ).toBeVisible();
  await expect(captain.getByText(/available that week · away: /)).toBeVisible();
  await expect(captain.getByText(/^Short that week: /)).toBeVisible();
  await expectNoAxeViolations(captain);
});
