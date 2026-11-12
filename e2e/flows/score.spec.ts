import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";

/**
 * Reese Ref has games waiting for a score; one is against Casey Captain's
 * team. The ref reports it, the captain confirms, and it is final.
 */
test("a ref enters a score and a captain confirms it", async ({ browser }) => {
  const ref = await pageAs(browser, "Ref");
  const game = ref
    .getByRole("listitem")
    .filter({ hasText: "The Big Kicks vs Kickin' Chicken" });
  await game.getByRole("link", { name: "Score" }).click();
  await expect(ref.getByRole("heading", { level: 1 })).toHaveText(
    "The Big Kicks vs Kickin' Chicken",
  );
  await expectNoAxeViolations(ref);

  await ref.getByRole("spinbutton", { name: "The Big Kicks" }).fill("7");
  await ref.getByRole("spinbutton", { name: "Kickin' Chicken" }).fill("4");
  await ref.getByRole("button", { name: "Save the score" }).click();
  await expect(ref.getByRole("status")).toHaveText("Score saved.");
  const reported = ref.getByRole("region", { name: "Reported score" });
  await expect(reported).toContainText("The Big Kicks 7, Kickin' Chicken 4");
  await expect(reported).toContainText("either captain confirms");
  const scorePage = ref.url().replace(/\?.*$/, "");
  await ref.context().close();

  const captain = await pageAs(browser, "Captain");
  await captain.goto(scorePage);
  await expect(
    captain.getByRole("region", { name: "Reported score" }),
  ).toContainText("Reported by Reese Ref");
  await expectNoAxeViolations(captain);
  await captain.getByRole("button", { name: "Confirm" }).click();
  await expect(captain.getByRole("status")).toHaveText(
    "Confirmed. The score is final.",
  );
  await expect(
    captain.getByRole("region", { name: "Final score" }),
  ).toContainText("The Big Kicks 7, Kickin' Chicken 4");
  await captain.context().close();
});
