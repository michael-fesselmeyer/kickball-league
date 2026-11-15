import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { unscoreGameById } from "../support/games";
import { pageAs } from "../support/personas";

/**
 * An admin records a forfeit with a written reason. The ref, who played no
 * part in it, sees the ruling and the reason on the game page; the form
 * won't save a forfeit or a change to a final score without one.
 */
test("an admin rules on a game with a reason the ref can read", async ({
  browser,
}) => {
  test.slow();
  const ref = await pageAs(browser, "Ref");
  // Other flows score these games at the same time, in another worker, so
  // this one takes a game of the ref's that none of them touches.
  const taken = [
    "Pitch Please vs Base Invaders",
    "Grand Slammers vs Foul Play",
    "Grand Slammers vs Red Rubber Ballers",
    "Base Invaders vs The Big Kicks",
    "The Big Kicks vs Kickin' Chicken",
    "Sun Kickers vs Kickin' Chicken",
    "Night Owls vs Porch Lights",
  ];
  const links = await ref
    .getByRole("listitem")
    .filter({ has: ref.getByRole("link", { name: "Score", exact: true }) })
    .filter({ hasNotText: new RegExp(taken.join("|")) })
    .getByRole("link", { name: "Score", exact: true })
    .evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
  // Take the first one that still waits for its score.
  let scorePage = "";
  for (const href of links) {
    await ref.goto(href);
    if (await ref.getByRole("button", { name: "Save the score" }).isVisible()) {
      scorePage = href;
      break;
    }
  }
  expect(scorePage, "a game of the ref's waiting for a score").not.toBe("");
  const gameId = scorePage.split("/").at(-2) ?? "";
  const matchup =
    (await ref.getByRole("heading", { level: 1 }).textContent()) ?? "";
  const [teamA = "", teamB = ""] = matchup.split(" vs ");

  const admin = await pageAs(browser, "Admin");
  await admin.goto(scorePage);
  // The first score for a game nobody reported needs no reason.
  await admin.getByRole("spinbutton", { name: teamA }).fill("6");
  await admin.getByRole("spinbutton", { name: teamB }).fill("5");
  await admin.getByRole("button", { name: "Save the score" }).click();
  await expect(admin.getByRole("status")).toHaveText("Score saved.");
  await expect(
    admin.getByRole("region", { name: "Final score" }),
  ).toContainText(`${teamA} 6, ${teamB} 5`);

  // Changing it is a ruling: a forfeit needs its reason.
  await admin.getByText("Set the score as an admin").click();
  await admin
    .getByLabel("Result")
    .selectOption({ label: `${teamB} forfeited` });
  const reason = admin.getByLabel("Reason for the ruling");
  await expect(reason).toBeVisible();
  await expect(reason).toHaveAttribute("required", "");
  await expectNoAxeViolations(admin);
  await reason.fill("Four players short at 8:15.");
  await admin.getByRole("button", { name: "Save as the final score" }).click();
  const ruling = admin.getByRole("region", { name: "Final score" });
  await expect(ruling).toContainText("Forfeit ruling");
  await expect(ruling).toContainText(`${teamB} forfeited`);
  await expect(ruling).toContainText("Four players short at 8:15.");
  await admin.context().close();

  await ref.goto(scorePage);
  const seen = ref.getByRole("region", { name: "Final score" });
  await expect(seen).toContainText("Four players short at 8:15.");
  await expectNoAxeViolations(ref);
  await ref.context().close();
  await unscoreGameById(gameId);
});
