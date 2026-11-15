import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";
import { addPlayoffSlots } from "../support/playoff-slots";

/**
 * Playoffs, from the standings to a champion, at phone width. An admin
 * adds a playoff evening's slots, seeds a four-team bracket from the
 * standings, checks the draft and publishes it. Each playoff game's score
 * is set from the Scores list: a tie is refused, the winners move on, and
 * the final is placed once both teams are known. The champion shows on
 * the admin's page and on the public bracket.
 *
 * Publishing a bracket moves the whole of Fall 2026 into playoffs, so this
 * runs with the site-wide flows, alone and after the rest.
 */
test.use({ viewport: { width: 390, height: 844 } });

const SEASON = "fall-2026";
// The seeded standings give semifinals of seeds 1 v 4 and 2 v 3; the run
// reseeds the league first, so they are these.
const [a1, b1] = ["The Big Kicks", "Red Rubber Ballers"] as const;
const [a2, b2] = ["Pitch Please", "Kickin' Chicken"] as const;

/** Sets a game's score from the season's Scores list, as the admin. */
async function setScore(
  admin: Page,
  teams: RegExp,
  scores: readonly [string, string],
  names: readonly [string, string],
) {
  await admin.goto(`/app/admin/seasons/${SEASON}/scores`);
  await admin
    .getByRole("listitem")
    .filter({ hasText: teams })
    .getByRole("link", { name: "Set score" })
    .click();
  await admin.getByRole("spinbutton", { name: names[0] }).fill(scores[0]);
  await admin.getByRole("spinbutton", { name: names[1] }).fill(scores[1]);
  await admin.getByRole("button", { name: "Save the score" }).click();
}

test("an admin seeds a bracket, scores the playoffs and crowns a champion", async ({
  browser,
}) => {
  test.slow();
  const day = await addPlayoffSlots();
  const admin = await pageAs(browser, "Admin");

  await test.step("the draft bracket is seeded from the standings", async () => {
    await admin.goto(`/app/admin/seasons/${SEASON}/playoffs`);
    await expect(admin.getByRole("heading", { level: 1 })).toHaveText(
      "Playoffs",
    );
    await admin.getByLabel("Teams in the playoffs").fill("4");
    await admin.getByLabel("Playoff day").selectOption({ value: day });
    await expectNoAxeViolations(admin);
    await admin.getByRole("button", { name: "Make the bracket" }).click();
    await expect(admin.getByRole("status")).toHaveText(
      "Bracket drafted. Check it, then publish it.",
    );
    const semi = admin.getByRole("article", { name: "Semifinals, game 1" });
    await expect(semi).toContainText("1");
    await expect(admin.getByRole("article")).toHaveCount(3);
    await expectNoAxeViolations(admin);
  });

  await test.step("publishing puts the semifinals on the schedule", async () => {
    await admin.getByRole("button", { name: "Publish the bracket" }).click();
    await expect(admin.getByRole("status")).toHaveText(
      "Bracket published. Winners move on as scores become final.",
    );
    await expect(
      admin.getByRole("link", { name: "See the public bracket" }),
    ).toBeVisible();
    await expectNoAxeViolations(admin);
  });

  await test.step("a playoff game can't end in a tie", async () => {
    await setScore(
      admin,
      new RegExp(`${a1} vs ${b1}|${b1} vs ${a1}`),
      ["4", "4"],
      [a1, b1],
    );
    await expect(
      admin.getByRole("alert").filter({ hasText: "tie" }),
    ).toContainText("Playoff games can't end in a tie. Play it out.");
  });

  await test.step("the winners of both semifinals move on to the final", async () => {
    await setScore(
      admin,
      new RegExp(`${a1} vs ${b1}|${b1} vs ${a1}`),
      ["7", "3"],
      [a1, b1],
    );
    await expect(admin.getByRole("status")).toHaveText("Score saved.");
    await setScore(
      admin,
      new RegExp(`${a2} vs ${b2}|${b2} vs ${a2}`),
      ["5", "2"],
      [a2, b2],
    );
    await expect(admin.getByRole("status")).toHaveText("Score saved.");

    await admin.goto(`/app/admin/seasons/${SEASON}/playoffs`);
    await expect(
      admin.getByRole("article", { name: "Final, game 1" }),
    ).toContainText(a1);
    await expect(
      admin.getByRole("article", { name: "Final, game 1" }),
    ).toContainText(a2);
    await expectNoAxeViolations(admin);
  });

  await test.step("the final crowns a champion, on the admin page and the public bracket", async () => {
    await setScore(
      admin,
      new RegExp(`${a1} vs ${a2}|${a2} vs ${a1}`),
      ["9", "4"],
      [a1, a2],
    );
    await expect(admin.getByRole("status")).toHaveText("Score saved.");

    await admin.goto(`/app/admin/seasons/${SEASON}/playoffs`);
    await expect(admin.getByText(`${a1}: champions`)).toBeVisible();

    const visitor = await (await browser.newContext()).newPage();
    await visitor.goto(`/seasons/${SEASON}/bracket`);
    await expect(visitor.getByText(`${a1}: champions`)).toBeVisible();
    await expectNoAxeViolations(visitor);
    await visitor.context().close();
  });
  await admin.context().close();
});
