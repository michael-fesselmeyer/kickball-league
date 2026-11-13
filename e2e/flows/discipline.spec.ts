import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";
import { captainEmail, pageSignedInAs } from "../support/sign-in";

/** The person and team the seed adds for this flow (src/seed/discipline.ts). */
const DISCIPLINE_PLAYER = {
  firstName: "Dana",
  lastName: "Fairplay",
  email: "dana.fairplay@example.test",
};
const DISCIPLINE_TEAM = "Foul Play";
const PLAYER = `${DISCIPLINE_PLAYER.firstName} ${DISCIPLINE_PLAYER.lastName}`;
const GAME = `Grand Slammers vs ${DISCIPLINE_TEAM}`;

/**
 * Reese Ref reports Dana Fairplay for outside alcohol at the sponsor bar
 * after a game Reese refs. Addie Admin reviews it and suspends Dana for
 * the rulebook's first step, one game. Foul Play's captain sees that Dana
 * is suspended, not why, and rates an opponent; Dana is told they can't
 * say they're in for a game. The admin then lifts the suspension.
 *
 * Dana and Foul Play exist for this flow alone (src/seed/discipline.ts),
 * so a suspension here never changes what another flow sees, whatever
 * order the flows run in; the lift at the end tidies up all the same.
 * Five people sign in one after another, so each step is its own test in
 * a serial group: each gets the full time budget, and a later step never
 * runs once an earlier one fails.
 */
test.describe
  .serial("a ref reports, an admin suspends, the player can't RSVP in", () => {
  test("the ref reports Dana for outside alcohol", async ({ browser }) => {
    const ref = await pageAs(browser, "Ref");
    await ref
      .getByRole("listitem")
      .filter({ hasText: GAME })
      .getByRole("link", { name: "Score" })
      .click();
    await ref.getByRole("link", { name: "Report an incident" }).click();
    await expect(
      ref.getByRole("heading", { name: "Report an incident" }),
    ).toBeVisible();
    await expectNoAxeViolations(ref);
    await ref
      .getByLabel("What kind of incident")
      .selectOption({ label: "Outside alcohol at the sponsor bar" });
    await ref
      .getByRole("group", { name: `People involved from ${DISCIPLINE_TEAM}` })
      .getByLabel(
        `${DISCIPLINE_PLAYER.firstName} ${DISCIPLINE_PLAYER.lastName[0]}.`,
      )
      .check();
    await ref
      .getByLabel("What happened")
      .fill(
        "Brought a cooler of their own cans to the sponsor bar after the game.",
      );
    await ref.getByRole("button", { name: "Send the report" }).click();
    await expect(ref.getByRole("status")).toContainText("Report sent");
    await ref.context().close();
  });

  test("an admin suspends Dana from the ladder's suggestion and resolves the report", async ({
    browser,
  }) => {
    const admin = await pageAs(browser, "Admin");
    await admin.goto("/app/admin/incidents");
    await expectNoAxeViolations(admin);
    await admin
      .getByRole("region", { name: /^To review/ })
      .getByRole("link", {
        name: `Outside alcohol at the sponsor bar: ${GAME}`,
      })
      .first()
      .click();
    await expect(
      admin.getByRole("heading", {
        name: "Outside alcohol at the sponsor bar",
      }),
    ).toBeVisible();
    await expect(
      admin.getByText(`Rulebook 4.0 suggests 1 game for ${PLAYER}`),
    ).toBeVisible();
    await expectNoAxeViolations(admin);
    await admin.getByRole("button", { name: `Suspend ${PLAYER}` }).click();
    await expect(admin.getByRole("status")).toContainText("Suspended.");
    await expect(
      admin.getByRole("region", { name: "Suspensions" }),
    ).toContainText(`${PLAYER} · 1 game, 1 more to serve`);
    await admin.getByLabel("Add a note").fill("Spoke with Dana at the field.");
    await admin.getByRole("button", { name: "Add note" }).click();
    await expect(admin.getByRole("status")).toContainText("Note added.");
    await admin.getByRole("button", { name: "Mark resolved" }).click();
    await expect(admin.getByRole("status")).toContainText("Resolved.");
    await expectNoAxeViolations(admin);
    await admin.context().close();
  });

  test("the captain sees the suspension, not why, and rates an opponent", async ({
    browser,
  }) => {
    const captain = await pageSignedInAs(
      browser,
      await captainEmail(DISCIPLINE_TEAM, "fall-2026"),
    );
    await captain.goto("/app/seasons/fall-2026/team");
    await expect(
      captain.getByRole("row", { name: new RegExp(PLAYER) }),
    ).toContainText("Suspended, 1 more game");
    await expect(captain.getByText("Outside alcohol")).toHaveCount(0);
    // Rate the other team in the season's first game, which is final.
    await captain.getByRole("link", { name: "See score" }).first().click();
    const rating = captain.getByRole("region", { name: /sportsmanship$/ });
    await rating.getByLabel("4").check();
    await rating
      .getByLabel("Note for the admins (optional)")
      .fill("Good sports");
    await rating.getByRole("button", { name: "Save rating" }).click();
    await expect(captain.getByRole("status")).toContainText(
      "Your rating is saved.",
    );
    await expectNoAxeViolations(captain);
    await captain.context().close();
  });

  test("Dana is told they can't say they're in for a game", async ({
    browser,
  }) => {
    const player = await pageSignedInAs(browser, DISCIPLINE_PLAYER.email);
    await player.goto("/app/seasons/fall-2026/team");
    await expect(
      player.getByText(
        "Suspended, 1 more game. While you're suspended you can't say you're in for a game",
      ),
    ).toBeVisible();
    // Every "In" button on the page is off while the suspension lasts.
    for (const button of await player
      .getByRole("button", { name: "In", exact: true })
      .all())
      await expect(button).toBeDisabled();
    await expectNoAxeViolations(player);
    await player.context().close();
  });

  test("the admin lifts the suspension", async ({ browser }) => {
    const admin = await pageAs(browser, "Admin");
    await admin.goto("/app/admin/incidents");
    const suspended = admin.getByRole("region", { name: /^Suspended now/ });
    await expect(suspended).toContainText(PLAYER);
    await suspended
      .getByRole("listitem")
      .filter({ hasText: PLAYER })
      .getByRole("link", { name: "See the report" })
      .click();
    await admin
      .getByRole("button", { name: `Lift ${PLAYER}'s suspension` })
      .click();
    await expect(admin.getByRole("status")).toContainText("Suspension lifted.");
    await expect(
      admin.getByRole("region", { name: "Suspensions" }),
    ).toContainText(`${PLAYER} · 1 game, lifted`);
    await expectNoAxeViolations(admin);
    await admin.context().close();
  });
});
