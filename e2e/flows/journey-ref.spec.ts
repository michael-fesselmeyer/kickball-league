import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { unscoreGame } from "../support/games";
import { type Member, memberPage } from "../support/people";
import { pageAs } from "../support/personas";
import { captainEmail, pageSignedInAs } from "../support/sign-in";

/**
 * A new ref's first game, across referee assignment, the home screen, the
 * park permit at the field, kicking orders, scores and the captains'
 * confirmation. Quinn Harrow (made up for this flow) signs in once, the
 * admin assigns Quinn to Pitch Please vs Red Rubber Ballers, and Quinn
 * finds it on their home screen, opens the park permit a park officer
 * might ask for, checks the kicking orders and reports the score. Pitch
 * Please's captain confirms it, and the game leaves Quinn's list.
 *
 * No other flow refs or scores this game; it is reset first, so a rerun
 * starts from the seed's state.
 */
const SEASON = "fall-2026";
const GAME = "Pitch Please vs Red Rubber Ballers";
const ref: Member = {
  first: "Quinn",
  last: "Harrow",
  email: "quinn.harrow@example.test",
  gender: "Man",
};

test("an admin assigns a new ref, who checks the permit, reports the score and sees it confirmed", async ({
  browser,
}) => {
  // Three people sign in.
  test.slow();
  await unscoreGame("Pitch Please", "Red Rubber Ballers");
  // An account must exist before the admin can assign it.
  const quinn = await memberPage(browser, ref);

  await test.step("the admin assigns the ref by email", async () => {
    const admin = await pageAs(browser, "Admin");
    await admin.goto(`/app/admin/seasons/${SEASON}/referees`);
    await admin.getByLabel(`Referee's email for ${GAME}`).fill(ref.email);
    await admin
      .getByRole("listitem")
      .filter({ hasText: GAME })
      .getByRole("button", { name: "Assign" })
      .click();
    await expect(admin.getByRole("status")).toHaveText(
      "Referee assigned. They'll see the game on their home screen.",
    );
    await admin.context().close();
  });

  await test.step("the ref finds the game, its permit and the kicking orders", async () => {
    await quinn.goto("/app");
    const game = quinn
      .getByRole("region", { name: "Games you're refereeing" })
      .getByRole("listitem")
      .filter({ hasText: GAME });
    await expectNoAxeViolations(quinn);
    await game.getByRole("link", { name: "Score" }).click();
    await expect(quinn.getByRole("heading", { level: 1 })).toHaveText(GAME);

    await quinn
      .getByRole("link", { name: "Park permit for this game" })
      .click();
    await expect(
      quinn.getByRole("heading", { name: "Park permit" }),
    ).toBeVisible();
    await expect(
      quinn.getByRole("img", { name: /park permit SAMPLE-0042/ }),
    ).toBeVisible();
    await expectNoAxeViolations(quinn);
    await quinn.goBack();

    await quinn.getByRole("link", { name: "Kicking orders" }).click();
    await expect(quinn.getByRole("main")).toContainText("Pitch Please");
    await expect(quinn.getByRole("main")).toContainText("Red Rubber Ballers");
    // A ref sees names only, never anyone's gender.
    await expect(quinn.getByText(/\b(Woman|Man|Women|Men)\b/)).toHaveCount(0);
    await quinn.goBack();
  });

  await test.step("the ref reports the score and a captain confirms it", async () => {
    await quinn.getByRole("spinbutton", { name: "Pitch Please" }).fill("8");
    await quinn
      .getByRole("spinbutton", { name: "Red Rubber Ballers" })
      .fill("6");
    await quinn.getByRole("button", { name: "Save the score" }).click();
    await expect(quinn.getByRole("status")).toHaveText("Score saved.");
    await expect(
      quinn.getByRole("region", { name: "Reported score" }),
    ).toContainText("either captain confirms");
    const scorePage = quinn.url().replace(/\?.*$/, "");

    const captain = await pageSignedInAs(
      browser,
      await captainEmail("Pitch Please", SEASON),
    );
    await captain.goto(scorePage);
    await expect(
      captain.getByRole("region", { name: "Reported score" }),
    ).toContainText("Reported by Quinn Harrow");
    await captain.getByRole("button", { name: "Confirm" }).click();
    await expect(captain.getByRole("status")).toHaveText(
      "Confirmed. The score is final.",
    );
    await captain.context().close();

    // A final game leaves the ref's list.
    await quinn.goto("/app");
    await expect(quinn.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      quinn.getByRole("listitem").filter({ hasText: GAME }),
    ).toHaveCount(0);
    await quinn.context().close();
  });
});
