import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { addGameToday } from "../support/game-today";
import { captainEmail, pageSignedInAs } from "../support/sign-in";

/**
 * Dana Fairplay (src/seed/discipline.ts) saves an emergency contact and a
 * first-aid note on her profile. On the day of a Foul Play game, Foul
 * Play's captain opens the game's emergency contacts and finds them; Dana,
 * a player and not a captain, can't open that page. The game is added for
 * this flow alone, today, and removed at the end.
 */
const DANA = "dana.fairplay@example.test";
const TEAM = "Foul Play";

let today: Awaited<ReturnType<typeof addGameToday>>;

test.describe.serial("emergency contacts on game day", () => {
  test.beforeAll(async () => {
    today = await addGameToday(TEAM, "Pitch Please");
  });
  test.afterAll(async () => {
    await today.remove();
  });

  test("a player saves an emergency contact, told who sees it and when", async ({
    browser,
  }) => {
    const page = await pageSignedInAs(browser, DANA);
    await page.goto("/app/profile");
    const emergency = page.getByRole("group", { name: "Emergency contact" });
    await expect(emergency).toContainText(
      "Only the two captains and the ref of a game you're in can see it, and only on that game's day",
    );
    await page.getByLabel("Mobile phone").fill("(718) 555-0142");
    await page.getByLabel("Birth date").fill("1994-05-17");
    await emergency.getByLabel("Name").fill("Lee Example");
    await emergency.getByLabel("Relationship (optional)").fill("sister");
    await emergency.getByLabel("Phone").fill("(718) 555-0177");
    await emergency
      .getByLabel("First-aid note (optional)")
      .fill("Allergic to peanuts; EpiPen in my bag.");
    await expectNoAxeViolations(page);
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page).toHaveURL(/\/app\/profile\?saved=1/);
    await expect(
      page
        .getByRole("group", { name: "Emergency contact" })
        .getByLabel("Relationship (optional)"),
    ).toHaveValue("sister");
    await page.context().close();
  });

  test("the captain reads it on game day", async ({ browser }) => {
    const captain = await pageSignedInAs(
      browser,
      await captainEmail(TEAM, "fall-2026"),
    );
    await captain.goto(`/app/games/${today.gameId}/emergency`);
    await expect(
      captain.getByRole("heading", { name: "Emergency contacts" }),
    ).toBeVisible();
    const team = captain.getByRole("region", { name: TEAM });
    const dana = team
      .getByRole("listitem")
      .filter({ hasText: "Dana Fairplay" });
    await expect(dana).toContainText("Lee Example · sister");
    await expect(dana).toContainText("First aid: Allergic to peanuts");
    await expect(
      dana.getByRole("link", { name: /^Call Lee Example for Dana Fairplay/ }),
    ).toHaveAttribute("href", "tel:+17185550177");
    await expectNoAxeViolations(captain);
    await captain.context().close();
  });

  test("a player who isn't a captain can't open it", async ({ browser }) => {
    const page = await pageSignedInAs(browser, DANA);
    await page.goto(`/app/games/${today.gameId}/emergency`);
    await expect(page.getByText("This page could not be found.")).toBeVisible();
    await expect(page.getByText("Lee Example")).toHaveCount(0);
    await page.context().close();
  });
});
