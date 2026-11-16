import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { addRefereedGameStarted } from "../support/game-today";
import { pageAs } from "../support/personas";

/**
 * Start on time and finish before the field must be clear (issue #467), at
 * phone width. Reese Ref opens a game that was due ten minutes ago: the
 * clock says when play must end and that first pitch is late. One tap
 * records first pitch, the ref says who held it up, and the clock counts
 * down the play that is left. The game's score screen shows the same clock,
 * and the admins' start times list the late start against that team. The
 * game is on a lit field of its own with a 90-minute permit, so play ends
 * at the permit whatever the time of day.
 */
test.use({ viewport: { width: 390, height: 844 } });

const A = "Kickin' Chicken";
const B = "Sun Kickers";

let game: Awaited<ReturnType<typeof addRefereedGameStarted>>;

test.describe.serial("the daylight and field-time clock", () => {
  test.beforeAll(async () => {
    game = await addRefereedGameStarted(A, B, 10);
  });
  test.afterAll(async () => {
    await game.remove();
  });

  test("a ref records a late first pitch and sees the play that is left", async ({
    browser,
  }) => {
    const ref = await pageAs(browser, "Ref");
    await ref.goto(`/app/games/${game.gameId}/live`);
    const clock = ref.getByRole("region", { name: "End of play" });
    await expect(clock).toContainText("Play must end by");
    await expect(clock).toContainText("the field must be clear");
    await expect(clock.getByRole("timer")).toContainText(
      /First pitch was due \d+ minutes ago\. Every minute late comes off the game/,
    );
    await expectNoAxeViolations(ref);

    await ref
      .getByRole("button", { name: "First pitch: start the clock" })
      .click();
    await expect(
      ref.getByRole("heading", { name: /^First pitch at / }),
    ).toBeVisible();
    await expect(ref.getByText(/minutes after the scheduled/)).toBeVisible();
    await expect(clock.getByRole("timer")).toContainText(
      /\d+ minutes of play left before the field must be clear\./,
    );

    // Late, so the ref says who held it up; the question then goes away.
    await expect(ref.getByText("Who held up the start?")).toBeVisible();
    await expectNoAxeViolations(ref);
    await ref.getByRole("button", { name: `${B} weren’t ready` }).click();
    await expect(ref.getByText(`${B} weren’t ready.`)).toBeVisible();
    await expect(ref.getByText("Who held up the start?")).toHaveCount(0);

    // The score screen, where captains report, shows the same clock.
    await ref.goto(`/app/games/${game.gameId}/score`);
    await expect(
      ref.getByRole("region", { name: "End of play" }).getByRole("timer"),
    ).toContainText("of play left before the field must be clear");
    await expectNoAxeViolations(ref);
    await ref.context().close();
  });

  test("admins see the late start against the team that held it up", async ({
    browser,
  }) => {
    const admin = await pageAs(browser, "Admin");
    await admin.goto(`/app/admin/seasons/${game.seasonSlug}/starts`);
    await expect(
      admin.getByRole("heading", { name: "Start times", level: 1 }),
    ).toBeVisible();
    const row = (team: string) =>
      admin
        .getByRole("region", { name: "By team" })
        .getByRole("row", { name: new RegExp(team) });
    // Starts, late starts of their own doing, then minutes lost.
    await expect(row(B).getByRole("cell").nth(0)).toHaveText("1");
    await expect(row(B).getByRole("cell").nth(1)).toHaveText("1");
    await expect(row(A).getByRole("cell").nth(1)).toHaveText("0");
    await expect(
      admin.getByRole("region", { name: "1 late start" }),
    ).toContainText(`held up by ${B}`);
    await expectNoAxeViolations(admin);
    await admin.context().close();
  });
});
