import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";

/**
 * Playoff formats (ADR 0071), at phone width: an admin adds a playoff-day
 * permit to last fall's season, splits its six teams into a
 * double-elimination top four and a second tier of two, publishes both,
 * and the public list shows game numbers with "winner of / loser of"
 * labels. No other flow uses Fall 2025.
 */
test.use({ viewport: { width: 390, height: 844 } });

const SLUG = "fall-2025";
const PLAYOFF_DAY = "2025-10-19";

test("an admin seeds a double-elimination bracket and a second tier, and the public bracket lists them", async ({
  browser,
}) => {
  const admin = await pageAs(browser, "Admin");

  await test.step("a permit for playoff day gives the season free slots", async () => {
    await admin.goto(`/app/admin/seasons/${SLUG}/fields`);
    const permits = admin.getByRole("region", { name: "Permit windows" });
    for (const field of ["Field 1", "Field 2"]) {
      await permits
        .getByRole("combobox", { name: "Field", exact: true })
        .selectOption({ label: `${field}, McCarren Park` });
      await permits.getByLabel("First date").fill(PLAYOFF_DAY);
      await permits.getByLabel("Weeks").fill("1");
      await permits.getByLabel("From").fill("10:00");
      await permits.getByLabel("To").fill("15:00");
      await permits
        .getByRole("combobox", { name: "Status", exact: true })
        .selectOption({ label: "Confirmed" });
      await permits.getByRole("button", { name: "Add permit hours" }).click();
      await expect(admin.getByRole("status")).toHaveText(
        "1 permit window added. Cut slots to use them.",
      );
    }
    await admin.getByLabel("Minutes per slot").fill("60");
    await admin.getByRole("button", { name: "Cut slots from permits" }).click();
    await expect(admin.getByRole("status")).toContainText("slots added");
  });

  await test.step("the admin drafts two tiers with their own formats", async () => {
    await admin.goto(`/app/admin/seasons/${SLUG}/playoffs`);
    await expect(
      admin.getByRole("heading", { level: 1, name: "Playoffs" }),
    ).toBeVisible();
    await expectNoAxeViolations(admin);

    const top = admin.getByRole("group", { name: "Championship bracket" });
    await top.getByLabel("Teams in the playoffs").fill("4");
    await top.getByLabel("Format").selectOption("double_elimination");
    await top.getByLabel("Playoff day").selectOption(PLAYOFF_DAY);
    const second = admin.getByRole("group", {
      name: "Second tier bracket (optional)",
    });
    await second.getByLabel("Teams", { exact: true }).fill("2");
    await second.getByLabel("Playoff day").selectOption(PLAYOFF_DAY);
    await second.getByLabel("Innings, final").fill("5");
    await admin.getByRole("button", { name: "Make the bracket" }).click();
    await expect(admin.getByRole("status")).toHaveText(
      "Bracket drafted. Check it, then publish it.",
    );

    await expect(
      admin.getByRole("heading", { name: "Championship bracket" }),
    ).toBeVisible();
    await expect(
      admin.getByRole("heading", { name: "Second tier bracket" }),
    ).toBeVisible();
    // The losers' side waits on the first games' losers.
    await expect(
      admin.getByText("Loser of game 1", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      admin.getByRole("heading", { name: "If-necessary final" }),
    ).toBeVisible();
    // Every game found a slot.
    await expect(admin.getByText(/No free slot is left/)).toHaveCount(0);
    await expectNoAxeViolations(admin);

    await admin.getByRole("button", { name: "Publish the brackets" }).click();
    await expect(admin.getByRole("status")).toHaveText(
      "Bracket published. Winners move on as scores become final.",
    );
  });

  await test.step("the public list shows both brackets in game order", async () => {
    await admin.goto(`/seasons/${SLUG}/bracket?view=list`);
    await expect(
      admin.getByRole("heading", { level: 2, name: "Championship bracket" }),
    ).toBeVisible();
    await expect(
      admin.getByRole("heading", { level: 2, name: "Second tier bracket" }),
    ).toBeVisible();
    for (const heading of [
      "Winners' round 1",
      "Winners' final",
      "Losers' round 1",
      "Losers' final",
      "Grand final",
      "If-necessary final",
    ])
      await expect(
        admin.getByRole("heading", { level: 3, name: heading }),
      ).toBeVisible();
    await expect(
      admin.getByText(
        "Game 7 · played only if the winners' side champion loses the grand final",
      ),
    ).toBeVisible();
    await expect(admin.getByText("Game 1 · 5 innings")).toBeVisible();
    await expect(admin.getByText(/Loser of game 3/)).toBeVisible();
    await expectNoAxeViolations(admin);
  });
});
