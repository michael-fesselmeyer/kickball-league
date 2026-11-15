import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { unscoreGame } from "../support/games";
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
  await unscoreGame("Pitch Please", "Base Invaders");
  const ref = await pageAs(browser, "Ref");
  await ref
    .getByRole("listitem")
    .filter({ hasText: "Pitch Please vs Base Invaders" })
    .getByRole("link", { name: "Score", exact: true })
    .click();
  const scorePage = ref.url().replace(/\?.*$/, "");

  const admin = await pageAs(browser, "Admin");
  await admin.goto(scorePage);
  // The first score for a game nobody reported needs no reason.
  await admin.getByRole("spinbutton", { name: "Pitch Please" }).fill("6");
  await admin.getByRole("spinbutton", { name: "Base Invaders" }).fill("5");
  await admin.getByRole("button", { name: "Save the score" }).click();
  await expect(admin.getByRole("status")).toHaveText("Score saved.");
  await expect(
    admin.getByRole("region", { name: "Final score" }),
  ).toContainText("Pitch Please 6, Base Invaders 5");

  // Changing it is a ruling: a forfeit needs its reason.
  await admin.getByText("Set the score as an admin").click();
  await admin
    .getByLabel("Result")
    .selectOption({ label: "Base Invaders forfeited" });
  const reason = admin.getByLabel("Reason for the ruling");
  await expect(reason).toBeVisible();
  await expect(reason).toHaveAttribute("required", "");
  await expectNoAxeViolations(admin);
  await reason.fill("Base Invaders had six players at 8:15.");
  await admin.getByRole("button", { name: "Save as the final score" }).click();
  const ruling = admin.getByRole("region", { name: "Final score" });
  await expect(ruling).toContainText("Forfeit ruling");
  await expect(ruling).toContainText("Base Invaders forfeited");
  await expect(ruling).toContainText("Base Invaders had six players at 8:15.");
  await admin.context().close();

  await ref.goto(scorePage);
  const seen = ref.getByRole("region", { name: "Final score" });
  await expect(seen).toContainText("Base Invaders had six players at 8:15.");
  await expectNoAxeViolations(ref);
  await ref.context().close();
  await unscoreGame("Pitch Please", "Base Invaders");
});
