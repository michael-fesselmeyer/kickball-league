import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";

const EVENT = "/events/harbor-cup-charity-tournament-2027-06-12";
const ADMIN_EVENT =
  "/app/admin/events/harbor-cup-charity-tournament-2027-06-12";
const TEAM = "Southside Sluggers";

/**
 * A guest captain from another league signs up on the public tournament
 * page and gets a waiver link; a guest player signs through it. An admin
 * sees the team and its signature count, draws the bracket, enters scores,
 * and a visitor sees the champion on the static page.
 */
test("a guest team signs up, its players sign the waiver and the bracket plays out", async ({
  browser,
}) => {
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  await visitor.goto(EVENT);
  await expect(
    visitor.getByRole("heading", {
      name: "Playing for Neighborhood Food Pantry (demo)",
    }),
  ).toBeVisible();
  await expect(
    visitor.getByRole("link", { name: /Give at pantry\.example\.test/ }),
  ).toBeVisible();
  await expect(
    visitor.getByText("never takes or holds donations"),
  ).toBeVisible();
  await expect(visitor.getByText("Borough Bases Blue")).toBeVisible();
  // The public page names teams and nothing about their captains.
  await expect(visitor.getByText("sam@example.test")).toHaveCount(0);
  await expectNoAxeViolations(visitor);

  await visitor.getByLabel("Team name").fill(TEAM);
  await visitor.getByLabel("Captain's name").fill("Jo Example");
  await visitor.getByLabel("Captain's email").fill("jo@example.test");
  await visitor.getByLabel("How many players?").fill("6");
  await visitor.getByRole("button", { name: "Enter our team" }).click();
  await expect(
    visitor.getByRole("status").filter({ hasText: "You're in!" }),
  ).toBeVisible();
  const link = await visitor
    .getByLabel("Waiver link for your team")
    .inputValue();
  expect(link).toContain("/guest/");

  const player = await visitorContext.newPage();
  await player.goto(link);
  await expect(
    player.getByRole("heading", {
      level: 1,
      name: "Harbor Cup charity tournament",
    }),
  ).toBeVisible();
  await expect(player.getByText("0 of 6 players have signed")).toBeVisible();
  await expectNoAxeViolations(player);
  await player.getByLabel("Your full name").fill("Pat Guest");
  await player.getByLabel("I have read the waiver").check();
  await player.getByRole("button", { name: "Sign the waiver" }).click();
  await expect(
    player.getByRole("status").filter({ hasText: "Signed!" }),
  ).toBeVisible();
  await visitorContext.close();

  const admin = await pageAs(browser, "Admin");
  await admin.goto(ADMIN_EVENT);
  const panel = admin.getByRole("region", { name: "Guest teams and charity" });
  await expect(panel.getByText(TEAM, { exact: true })).toBeVisible();
  await expect(panel.getByText("jo@example.test")).toBeVisible();
  await expect(
    panel.getByText("1 of 6 players have signed the waiver."),
  ).toBeVisible();
  await expectNoAxeViolations(admin);

  await panel.getByRole("button", { name: "Draw the bracket" }).click();
  await expect(
    admin.getByRole("status").filter({ hasText: "Bracket drawn" }),
  ).toBeVisible();

  const semi = admin
    .getByRole("listitem")
    .filter({ hasText: "Semifinals, game 1:" });
  await semi.getByLabel(`${TEAM} runs`).fill("2");
  await semi.getByLabel("Borough Bases Gold runs").fill("5");
  await semi.getByRole("button", { name: "Save score" }).click();
  await expect(
    admin.getByRole("status").filter({ hasText: "Score saved" }),
  ).toBeVisible();

  const final = admin
    .getByRole("listitem")
    .filter({ hasText: "Final, game 1:" });
  await final.getByLabel("Borough Bases Blue runs").fill("7");
  await final.getByLabel("Borough Bases Gold runs").fill("3");
  await final.getByRole("button", { name: "Save score" }).click();
  await expect(
    admin.getByRole("status").filter({ hasText: "Score saved" }),
  ).toBeVisible();
  await admin.context().close();

  const after = await (await browser.newContext()).newPage();
  await after.goto(EVENT);
  await expect(after.getByRole("heading", { name: "Bracket" })).toBeVisible();
  await expect(after.getByText("Borough Bases Blue: champions")).toBeVisible();
  await expectNoAxeViolations(after);
});

test("the Friends page shows a card for the partner league's tournament", async ({
  page,
}) => {
  await page.goto("/friends");
  const card = page
    .getByRole("listitem")
    .filter({ hasText: "Harbor Cup charity tournament" });
  await expect(card).toContainText("With Borough Bases Kickball");
  await card.getByRole("link", { name: "See the tournament" }).click();
  await expect(page).toHaveURL(new RegExp(`${EVENT}$`));
});
