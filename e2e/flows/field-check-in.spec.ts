import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { addGameToday } from "../support/game-today";
import { captainEmail, pageSignedInAs } from "../support/sign-in";

/**
 * Field check-in (ADR 0063). On the day of a Foul Play game, Foul Play's
 * captain shows the rotating code; Dana Fairplay (src/seed/discipline.ts)
 * opens its link and taps Check in. The captain sees her checked in, ticks
 * a Pitch Please player in by hand, and finds her game on the team's
 * attendance page. A forged code checks nobody in, and a player who isn't a
 * captain can't open the check-in screen. The game is added for this flow
 * alone, today, and removed at the end with its check-ins.
 */
const DANA = "dana.fairplay@example.test";
const TEAM = "Foul Play";
const OTHER = "Pitch Please";

let today: Awaited<ReturnType<typeof addGameToday>>;
let code = "";

test.describe.serial("field check-in", () => {
  test.beforeAll(async () => {
    today = await addGameToday(TEAM, OTHER);
  });
  test.afterAll(async () => {
    await today.remove();
  });

  test("the captain shows the game's check-in code", async ({ browser }) => {
    const captain = await pageSignedInAs(
      browser,
      await captainEmail(TEAM, "fall-2026"),
    );
    await captain.goto(`/app/games/${today.gameId}/score`);
    await captain.getByRole("link", { name: "Check-in", exact: true }).click();
    await expect(
      captain.getByRole("heading", { name: "Check-in" }),
    ).toBeVisible();
    await expectNoAxeViolations(captain);
    await captain.getByRole("link", { name: "Show the check-in code" }).click();
    await expect(
      captain.getByRole("img", {
        name: `Check-in code for ${TEAM} vs ${OTHER}`,
      }),
    ).toBeVisible();
    code = (await captain.locator("span.font-mono").textContent()) ?? "";
    expect(code).toMatch(/^[a-z2-9]{10}$/);
    await captain.context().close();
  });

  test("a forged code checks nobody in", async ({ browser }) => {
    const page = await pageSignedInAs(browser, DANA);
    await page.goto(`/app/games/${today.gameId}/check-in/abcdefghjk`);
    // The route announcer is an alert too, so pick the page's own.
    await expect(
      page.getByRole("alert").filter({ hasText: "this one has expired" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Check in" })).toHaveCount(0);
    await page.context().close();
  });

  test("a player scans the code and checks in", async ({ browser }) => {
    const page = await pageSignedInAs(browser, DANA);
    await page.goto(`/app/games/${today.gameId}/check-in/${code}`);
    await expect(
      page.getByRole("heading", { name: "Check in for the game" }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
    await page.getByRole("button", { name: "Check in" }).click();
    await expect(
      page.getByRole("heading", { name: "You're checked in" }),
    ).toBeVisible();
    await expect(page.getByRole("status")).toContainText(`playing for ${TEAM}`);
    await page.context().close();
  });

  test("the captain sees her checked in and ticks a player in", async ({
    browser,
  }) => {
    const captain = await pageSignedInAs(
      browser,
      await captainEmail(TEAM, "fall-2026"),
    );
    await captain.goto(`/app/games/${today.gameId}/attendance`);
    const mine = captain.getByRole("group", { name: TEAM });
    await expect(
      mine.getByRole("checkbox", { name: /Dana Fairplay.*Scanned in/ }),
    ).toBeChecked();

    const theirs = captain.getByRole("group", { name: OTHER });
    const first = theirs.getByRole("checkbox").first();
    await first.check();
    await captain.getByRole("button", { name: "Save check-in" }).click();
    await expect(captain.getByRole("status")).toHaveText("Check-in saved.");
    await expect(
      captain.getByRole("group", { name: OTHER }).getByRole("checkbox").first(),
    ).toBeChecked();

    await captain.goto("/app/seasons/fall-2026/team/attendance");
    await expect(
      captain.getByRole("heading", { name: "Attendance" }),
    ).toBeVisible();
    await expect(
      captain.getByRole("listitem").filter({ hasText: "Dana Fairplay" }),
    ).toContainText(/\d+ games?/);
    await expectNoAxeViolations(captain);
    await captain.context().close();
  });

  test("a player who isn't a captain can't open the check-in screen", async ({
    browser,
  }) => {
    const page = await pageSignedInAs(browser, DANA);
    await page.goto(`/app/games/${today.gameId}/attendance`);
    await expect(page.getByText("This page could not be found.")).toBeVisible();
    await page.goto(`/app/games/${today.gameId}/attendance/code`);
    await expect(page.getByText("This page could not be found.")).toBeVisible();
    await page.context().close();
  });
});
