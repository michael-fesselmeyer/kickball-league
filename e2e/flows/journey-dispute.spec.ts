import { type Browser, expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { unscoreGame } from "../support/games";
import { pageAs } from "../support/personas";
import { captainEmail, pageSignedInAs } from "../support/sign-in";

/**
 * A captain's disagreement with the other side's score, from the report to
 * the standings. Kickin' Chicken's captain reports a win over the Grand
 * Slammers, the Grand Slammers' captain disputes it with a note, and the
 * game moves from "waiting" to the admins' Disputed list with both
 * versions. An admin sets the final score, which needs nobody's
 * confirmation, and both captains and the public standings see that score,
 * not the first report.
 *
 * Both captains are seeded players, not demo personas. No other flow scores
 * this game; it is reset first, so a rerun starts from the seed's state.
 */
const SEASON = "fall-2026";
const HOME = "Kickin' Chicken";
const AWAY = "Grand Slammers";
const GAME = `${HOME} vs ${AWAY}`;
const NOTE = "We had them out at third, so that run doesn't count.";

/** The home team's wins in the public standings, read by a new visitor. */
async function wins(browser: Browser): Promise<number> {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`/seasons/${SEASON}/standings`);
  const cell = page
    .getByRole("row", { name: new RegExp(HOME) })
    .getByRole("cell")
    .nth(1);
  const count = Number(await cell.textContent());
  await page.context().close();
  return count;
}

test("a captain disputes a reported score and an admin settles it", async ({
  browser,
}) => {
  // Three people sign in and the public standings are read twice.
  test.slow();
  await unscoreGame(HOME, AWAY, SEASON);
  const before = await wins(browser);

  const home = await pageSignedInAs(browser, await captainEmail(HOME, SEASON));
  const away = await pageSignedInAs(browser, await captainEmail(AWAY, SEASON));
  let scorePage = "";

  await test.step("the home captain reports a win", async () => {
    await home.setViewportSize({ width: 390, height: 844 });
    await home.goto(`/app/seasons/${SEASON}/team`);
    await home
      .getByRole("listitem")
      .filter({ hasText: `vs ${AWAY}` })
      .getByRole("link", { name: "Enter score" })
      .click();
    await expect(home.getByRole("heading", { level: 1 })).toHaveText(GAME);
    await home.getByRole("spinbutton", { name: HOME }).fill("6");
    await home.getByRole("spinbutton", { name: AWAY }).fill("5");
    await home.getByRole("button", { name: "Save the score" }).click();
    await expect(home.getByRole("status")).toHaveText("Score saved.");
    scorePage = home.url().replace(/\?.*$/, "");
  });

  await test.step("the other captain disputes it with a note", async () => {
    await away.setViewportSize({ width: 390, height: 844 });
    await away.goto(scorePage);
    const reported = away.getByRole("region", { name: "Reported score" });
    await expect(reported).toContainText(`${HOME} 6, ${AWAY} 5`);
    await expectNoAxeViolations(away);
    await reported.getByLabel("Note, if you dispute it").fill(NOTE);
    await reported.getByRole("button", { name: "Dispute" }).click();
    await expect(away.getByRole("status")).toHaveText(
      "Disputed. An admin will sort it out.",
    );
    const disputed = away.getByRole("region", { name: "Disputed score" });
    await expect(disputed).toContainText(NOTE);
    await expect(disputed).toContainText("An admin will set the final score.");
    await expectNoAxeViolations(away);

    // A disputed game is not final: the standings haven't moved.
    expect(await wins(browser)).toBe(before);
  });

  const admin = await pageAs(browser, "Admin");
  await test.step("the admin finds it in the Disputed list and sets the final score", async () => {
    await admin.goto(`/app/admin/seasons/${SEASON}/scores`);
    const disputed = admin.getByRole("region", { name: /^Disputed/ });
    await expectNoAxeViolations(admin);
    await disputed
      .getByRole("listitem")
      .filter({ hasText: GAME })
      .getByRole("link")
      .click();
    await expect(admin.getByRole("heading", { level: 1 })).toHaveText(GAME);
    await expect(
      admin.getByRole("region", { name: "Disputed score" }),
    ).toContainText(NOTE);
    await admin.getByText("Set the score as an admin").click();
    await admin.getByRole("spinbutton", { name: HOME }).fill("5");
    await admin.getByRole("spinbutton", { name: AWAY }).fill("5");
    await admin
      .getByRole("button", { name: "Save as the final score" })
      .click();
    await expect(admin.getByRole("status")).toHaveText("Score saved.");
    await expect(
      admin.getByRole("region", { name: "Final score" }),
    ).toContainText(`${HOME} 5, ${AWAY} 5`);

    await admin.goto(`/app/admin/seasons/${SEASON}/scores`);
    await expect(
      admin.getByRole("listitem").filter({ hasText: GAME }),
    ).toHaveCount(0);
  });

  await test.step("both captains and the public see the admin's score", async () => {
    for (const captain of [home, away]) {
      await captain.goto(scorePage);
      await expect(
        captain.getByRole("region", { name: "Final score" }),
      ).toContainText(`${HOME} 5, ${AWAY} 5`);
    }
    // A tie is not a win for the team that first reported one.
    expect(await wins(browser)).toBe(before);
  });
  await home.context().close();
  await away.context().close();
  await admin.context().close();
});
