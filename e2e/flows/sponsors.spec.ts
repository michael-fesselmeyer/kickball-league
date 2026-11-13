import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";

const HOME_BAR = "/app/sponsor/the-corner-pocket";

/**
 * An admin adds a deal to the home bar and puts up its check-in code. Pat
 * Player scans it, checks in, uses a deal, and the public page and the
 * weekly numbers show it.
 */
test("a player checks in at the home bar and uses a deal", async ({
  browser,
}) => {
  const admin = await pageAs(browser, "Admin");
  await admin.goto(HOME_BAR);
  await expect(admin.getByRole("heading", { level: 1 })).toHaveText(
    "The Corner Pocket",
  );
  await expectNoAxeViolations(admin);
  await admin.getByText("Add a deal").click();
  await admin
    .getByRole("textbox", { name: "What players get" })
    .last()
    .fill("Free lemonade with a check-in");
  await admin.getByRole("button", { name: "Add deal" }).click();
  await expect(admin.getByRole("status")).toHaveText(
    "Deal saved and marked as current.",
  );

  await admin.getByRole("link", { name: "Show the check-in code" }).click();
  await expect(
    admin.getByRole("img", { name: "Check-in code for The Corner Pocket" }),
  ).toBeVisible();
  await expectNoAxeViolations(admin);
  const code = (await admin.locator(".font-mono").first().textContent()) ?? "";
  expect(code).toMatch(/^[a-z2-9]{10}$/);

  const player = await pageAs(browser, "Player");
  // A made-up or old code does not check anyone in.
  await player.goto("/app/check-in/the-corner-pocket/aaaaaaaaaa");
  await expect(player.getByRole("heading", { level: 1 })).toHaveText(
    "That code has moved on",
  );
  await player.goto(`/app/check-in/the-corner-pocket/${code}`);
  await expect(player.getByRole("heading", { level: 1 })).toHaveText(
    "You made it to The Corner Pocket",
  );
  await expectNoAxeViolations(player);
  await player.getByRole("button", { name: "Check in" }).click();
  await expect(player.getByRole("status")).toHaveText(
    "You're checked in. Thanks for coming out!",
  );
  const lemonade = player
    .getByRole("listitem")
    .filter({ hasText: "Free lemonade with a check-in" });
  await lemonade.getByRole("button", { name: "Use this deal" }).click();
  await expect(player.getByRole("status")).toHaveText(
    "Deal used. Show this screen to whoever is serving you.",
  );
  await expect(
    player
      .getByRole("listitem")
      .filter({ hasText: "Free lemonade with a check-in" }),
  ).toContainText("Used at");
  await expectNoAxeViolations(player);

  // Scanning again the same day keeps the one check-in.
  await player.goto(`/app/check-in/the-corner-pocket/${code}`);
  await expect(player.getByText("Checked in", { exact: true })).toBeVisible();
  await player.context().close();

  await admin.goto("/sponsors/the-corner-pocket");
  await expect(
    admin.getByRole("heading", { name: "Free lemonade with a check-in" }),
  ).toBeVisible();

  await admin.goto(`${HOME_BAR}/report`);
  await expect(admin.getByRole("heading", { level: 1 })).toHaveText(
    "Weekly numbers",
  );
  await expect(
    admin.getByRole("row").filter({ hasText: "Free lemonade with a check-in" }),
  ).toContainText("1");
  await expectNoAxeViolations(admin);
  await admin.context().close();
});

test("an admin names the team of the week from the day's best wins", async ({
  browser,
}) => {
  const admin = await pageAs(browser, "Admin");
  await admin.goto("/app/admin/seasons/fall-2026/team-of-the-week");
  await expect(admin.getByRole("heading", { level: 1 })).toHaveText(
    "Team of the week",
  );
  await expectNoAxeViolations(admin);
  const [first] = await admin
    .getByRole("navigation", { name: "Game days" })
    .getByRole("link")
    .all();
  await first?.click();
  await admin
    .getByRole("button", { name: /Name them|Save the change/ })
    .click();
  await expect(admin.getByRole("status")).toHaveText(
    "Saved. It's on the sponsors page now.",
  );
  await admin.context().close();
});
