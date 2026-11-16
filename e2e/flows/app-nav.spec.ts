/**
 * The signed-in app's navigation (issue #581): a tab bar and a grouped
 * menu whose groups follow the person's roles. A player sees no captain,
 * ref or admin tools; each of those roles sees its own group on top.
 */
import { expect, test } from "@playwright/test";
import { appTabs, menuGroups, openAppMenu } from "../support/app-nav";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";

const PHONE = { width: 390, height: 844 };
const STAFF = ["Captain", "Referee", "League admin", "Owner"];

test("a player gets tabs, a grouped menu and no staff tools", async ({
  browser,
}) => {
  const player = await pageAs(browser, "Player");
  await player.setViewportSize(PHONE);
  await player.goto("/app");

  const tabs = appTabs(player);
  await expect(tabs.getByRole("link", { name: "Home" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(tabs.getByRole("link")).toHaveText(["Home", "Schedule", "Team"]);
  // The bar never hides the end of the page.
  const bar = await tabs.boundingBox();
  const padding = await player.evaluate(() =>
    parseFloat(getComputedStyle(document.body).paddingBottom),
  );
  expect(padding).toBeGreaterThanOrEqual((bar?.height ?? 0) - 1);

  const groups = await menuGroups(player);
  expect(groups).toEqual([
    "My season",
    "Game day",
    "League life",
    "Help",
    "Account",
  ]);
  for (const staff of STAFF) expect(groups).not.toContain(staff);
  const menu = player.getByRole("dialog", { name: "Menu" });
  await expect(menu.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expectNoAxeViolations(player);

  // Escape closes it, and so does following a link.
  await player.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await (
    await openAppMenu(player)
  )
    .getByRole("link", { name: "Events", exact: true })
    .click();
  await expect(player).toHaveURL(/\/app\/events$/);
  await expect(menu).toBeHidden();
  await player.context().close();
});

test("a captain sees a Captain group on top of the player's", async ({
  browser,
}) => {
  const captain = await pageAs(browser, "Captain");
  await captain.goto("/app");
  const groups = await menuGroups(captain);
  expect(groups).toContain("My season");
  expect(groups).toContain("Captain");
  expect(groups).not.toContain("League admin");
  const group = captain
    .getByRole("dialog", { name: "Menu" })
    .getByRole("region", { name: "Captain" });
  await group.getByRole("link", { name: "Message your team" }).click();
  await expect(
    captain.getByRole("heading", { name: "Message your team", level: 1 }),
  ).toBeVisible();
  await captain.context().close();
});

test("a ref sees the Referee group and no admin tools", async ({ browser }) => {
  const ref = await pageAs(browser, "Ref");
  await ref.goto("/app");
  const groups = await menuGroups(ref);
  expect(groups).toContain("Referee");
  expect(groups).not.toContain("League admin");
  expect(groups).not.toContain("Captain");
  await ref.context().close();
});

test("an admin with no team gets admin tools and no player items", async ({
  browser,
}) => {
  const admin = await pageAs(browser, "Admin");
  await admin.setViewportSize(PHONE);
  await admin.goto("/app");
  await expect(appTabs(admin).getByRole("link")).toHaveText([
    "Home",
    "Schedule",
    "Admin",
  ]);
  const groups = await menuGroups(admin);
  expect(groups[0]).toBe("League admin");
  expect(groups).not.toContain("My season");
  expect(groups).not.toContain("Game day");
  expect(groups).not.toContain("Captain");
  await expectNoAxeViolations(admin);
  await admin.keyboard.press("Escape");

  // On a wider screen the same tabs sit in a bar under the header.
  await admin.setViewportSize({ width: 1280, height: 800 });
  await appTabs(admin).getByRole("link", { name: "Admin" }).click();
  await expect(admin).toHaveURL(/\/app\/admin$/);
  await expect(
    appTabs(admin).getByRole("link", { name: "Admin" }),
  ).toHaveAttribute("aria-current", "page");
  await expectNoAxeViolations(admin);
  await admin.context().close();
});
