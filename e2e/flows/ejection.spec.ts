import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { addGameUnderWayWithOrder } from "../support/game-today";
import { pageAs } from "../support/personas";

const PHONE = { width: 390, height: 844 };

/**
 * Reese Ref ejects a player from the live game screen during a game they
 * referee. The league gets an ejection report, and the player is gone from
 * their team's kicking order for the rest of the game, while the others
 * move up.
 */
test("a ref ejects a player, who leaves the kicking order", async ({
  browser,
}) => {
  const game = await addGameUnderWayWithOrder("Pitch Please", "Base Invaders");
  try {
    const [first, out, last] = game.order;
    if (!first || !out || !last) throw new Error("The order needs three");
    const ref = await pageAs(browser, "Ref");
    await ref.setViewportSize(PHONE);
    await ref.goto(`/app/games/${game.gameId}/live`);
    const section = ref.getByRole("region", { name: "Eject a player" });
    await expect(section).toBeVisible();
    await expectNoAxeViolations(ref);

    await section.getByLabel("Player").selectOption({ label: out });
    await section
      .getByLabel("Reason (optional)")
      .fill("Argued after a warning");
    await section.getByRole("button", { name: "Eject the player" }).click();
    await expect(section.getByRole("status")).toContainText("Ejected.");
    await expect(section).toContainText(`Ejected this game: ${out}.`);
    // They can't be ejected twice.
    await expect(
      section.getByRole("option", { name: out, exact: true }),
    ).toHaveCount(0);
    await expectNoAxeViolations(ref);

    await ref.goto(`/app/games/${game.gameId}/lineup`);
    const team = ref.getByRole("region", { name: "Pitch Please" });
    const order = team.getByRole("listitem");
    await expect(order).toHaveCount(2);
    await expect(order.nth(0)).toContainText(first);
    await expect(order.nth(1)).toContainText(last);
    await expect(team).toContainText(
      `Ejected by the ref, out for the rest of the game: ${out}.`,
    );
    await expectNoAxeViolations(ref);
  } finally {
    await game.remove();
  }
});
