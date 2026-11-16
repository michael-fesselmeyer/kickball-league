import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { addGamesNextWeek } from "../support/game-today";
import { pageAs } from "../support/personas";

/**
 * Assign refs, then pay them (issue #368), at phone width. The seed puts
 * Reese Ref in the league's ref pool with two fall games checked in for,
 * at $25 a game (src/seed/referee-pool.ts). Two exhibition games next week
 * at the same time give the assigner something to staff: Reese can take
 * one, and nobody is left for the other.
 */
test.use({ viewport: { width: 390, height: 844 } });

/** Fall 2026, where the seed has Reese check in for two games. */
const BASE = "/app/admin/seasons/fall-2026/referees";
let games: Awaited<ReturnType<typeof addGamesNextWeek>>;

test.describe.serial("ref assigner and pay sheet", () => {
  test.beforeAll(async () => {
    games = await addGamesNextWeek([
      ["Grand Slammers", "Foul Play"],
      ["Sun Kickers", "Base Invaders"],
    ]);
  });
  test.afterAll(async () => {
    await games?.remove();
  });

  test("a ref says when they can work, an admin accepts the proposal, then pays them", async ({
    browser,
  }) => {
    // The ref ticks next week's game time.
    const ref = await pageAs(browser, "Ref");
    await ref
      .getByRole("link", { name: /^Reffing: when you can work/ })
      .click();
    await expect(ref.getByRole("heading", { level: 1 })).toHaveText("Reffing");
    const fall = ref.getByRole("region", { name: "Fall 2026" });
    await expect(
      // The seed checks Reese in for two games; other flows may add more.
      fall.getByText(/\d+ games worked at \$25\.00 each · \$[\d,.]+ earned/),
    ).toBeVisible();
    const legend = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${games.day}T12:00:00Z`));
    const week = ref.getByRole("region", { name: games.name });
    const when = week.getByRole("group", { name: legend });
    await expect(when.getByRole("checkbox")).toHaveCount(1);
    await when.getByRole("checkbox").first().check();
    await week.getByRole("button", { name: "Save when I can ref" }).click();
    await expect(ref.getByRole("status")).toHaveText("Saved. Thanks!");
    await expect(when.getByRole("checkbox").first()).toBeChecked();
    await expectNoAxeViolations(ref);

    // The admin opens the assigner for that day and accepts its proposal.
    const admin = await pageAs(browser, "Admin");
    const assign = `/app/admin/seasons/${games.slug}/referees`;
    await admin.goto(assign);
    await admin.getByRole("link", { name: "Assign refs" }).click();
    await expect(admin.getByRole("heading", { level: 1 })).toHaveText(
      "Assign refs",
    );
    await admin.goto(`${assign}/assign?day=${games.day}`);
    await expect(
      admin.getByText("1 of 2 games have a proposed ref."),
    ).toBeVisible();
    await expect(
      admin.getByText(/^Everyone free then plays in it, has another game/),
    ).toBeVisible();
    await expectNoAxeViolations(admin);
    await admin.getByRole("button", { name: "Accept all 1" }).click();
    await expect(admin.getByRole("status")).toHaveText("1 ref assigned.");
    await expect(
      admin.getByText("0 of 1 games have a proposed ref."),
    ).toBeVisible();
    await expect(
      admin.getByRole("button", { name: "Accept all 0" }),
    ).toBeDisabled();

    // The ref's time is now fixed: it's a game they ref.
    await ref.reload();
    await expect(
      week.getByText(
        /\(you ref (Grand Slammers vs Foul Play|Sun Kickers vs Base Invaders);/,
      ),
    ).toBeVisible();
    await expectNoAxeViolations(ref);

    // The admin pays what's owed, which lands in the books.
    await admin.goto(`${BASE}/pay`);
    const reese = admin.getByRole("listitem", { name: "Reese Ref" });
    await expect(reese).toContainText(
      /\d+ games · \$[\d,.]+ owed · \$0\.00 paid/,
    );
    // The amount starts at what's owed.
    const amount = await reese
      .getByLabel("Amount paid to Reese Ref")
      .inputValue();
    expect(Number(amount)).toBeGreaterThanOrEqual(50);
    const paid = `$${Number(amount).toFixed(2)}`;
    await expectNoAxeViolations(admin);
    await reese.getByRole("button", { name: "Mark paid to Reese Ref" }).click();
    await expect(admin.getByRole("status")).toContainText(
      "Payment recorded and added to the books as a Refs expense.",
    );
    await expect(reese).toContainText(`${paid} paid`);

    // The ref sees the payment on their own page.
    await ref.reload();
    await expect(fall.getByText(`Paid ${paid} by Venmo on`)).toBeVisible();
    await ref.context().close();
    await admin.context().close();
  });

  test("the assigner and the pay sheet are for admins, and a captain who doesn't ref has no ref page", async ({
    browser,
  }) => {
    const ref = await pageAs(browser, "Ref");
    for (const path of [`${BASE}/assign`, `${BASE}/pay`]) {
      await ref.goto(path);
      await expect(
        ref.getByRole("heading", { name: "We can't find that page" }),
      ).toBeVisible();
    }
    await ref.context().close();
    const captain = await pageAs(browser, "Captain");
    await captain.goto("/app/referee");
    await expect(
      captain.getByRole("heading", { name: "We can't find that page" }),
    ).toBeVisible();
    await captain.context().close();
  });
});
