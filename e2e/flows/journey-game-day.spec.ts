import { expect, type Page, test } from "@playwright/test";
import { Client } from "pg";
import { expectNoAxeViolations } from "../support/axe";
import { addGameKickedOffToday } from "../support/game-today";
import { type Member, memberPage } from "../support/people";
import { captainEmail, pageSignedInAs, playerEmail } from "../support/sign-in";

/**
 * One game, from the first player at the field to the confirmed score,
 * across check-in, the ref's live scoring and the captains' confirmation.
 * Grand Slammers play the Sun Kickers; the game kicked off half an hour
 * ago, so the ref can score it whatever time the flow runs. Their captain shows the
 * check-in code, a Grand Slammers player scans it and the captain sees
 * them checked in. The ref, Rene Marsh (made up for this flow), is
 * assigned, keeps score half-inning by half-inning from their phone and
 * ends the game; the Sun Kickers' captain confirms the score, which is
 * then final for both captains.
 *
 * The game is an exhibition added for this flow alone and removed at the
 * end, so no other flow's list changes.
 */
const SEASON = "fall-2026";
const HOME = "Grand Slammers";
const AWAY = "Sun Kickers";
const GAME = `${HOME} vs ${AWAY}`;
const PHONE = { width: 390, height: 844 };
const ref: Member = {
  first: "Rene",
  last: "Marsh",
  email: "rene.marsh@example.test",
  gender: "Man",
};

/** Counts a half's runs one tap at a time, then ends it. */
async function scoreHalf(page: Page, runs: number) {
  for (let i = 0; i < runs; i++)
    await page.getByRole("button", { name: /^\+1 run/ }).click();
  await page
    .getByRole("button", {
      name: runs === 0 ? "End half, no runs" : /^End half, \d+ runs?$/,
    })
    .click();
}

async function assignRef(gameId: string, email: string) {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query(
      `insert into referee_assignment (game_id, user_id, status, responded_at)
       select $1, u.id, 'accepted', now() from "user" u where u.email = $2`,
      [gameId, email],
    );
  } finally {
    await db.end();
  }
}

test("a game from check-in to a confirmed score", async ({ browser }) => {
  // Five people sign in and the game is scored by hand.
  test.slow();
  const game = await addGameKickedOffToday(HOME, AWAY);
  try {
    const captain = await pageSignedInAs(
      browser,
      await captainEmail(HOME, SEASON),
    );
    const player = await pageSignedInAs(
      browser,
      await playerEmail(HOME, SEASON),
    );
    const quinn = await memberPage(browser, ref);
    for (const page of [captain, player, quinn])
      await page.setViewportSize(PHONE);
    await assignRef(game.gameId, ref.email);
    let code = "";

    await test.step("the captain shows the check-in code and a player scans it", async () => {
      await captain.goto(`/app/games/${game.gameId}/attendance/code`);
      await expect(
        captain.getByRole("img", { name: `Check-in code for ${GAME}` }),
      ).toBeVisible();
      await expectNoAxeViolations(captain);
      code = (await captain.locator("span.font-mono").textContent()) ?? "";
      expect(code).toMatch(/^[a-z2-9]{10}$/);

      await player.goto(`/app/games/${game.gameId}/check-in/${code}`);
      await player.getByRole("button", { name: "Check in" }).click();
      await expect(
        player.getByRole("heading", { name: "You're checked in" }),
      ).toBeVisible();
      await expectNoAxeViolations(player);

      await captain.goto(`/app/games/${game.gameId}/attendance`);
      await expect(
        captain
          .getByRole("group", { name: HOME })
          .getByRole("checkbox", { name: /Scanned in/ })
          .first(),
      ).toBeChecked();
    });

    await test.step("the ref finds the game and keeps score live", async () => {
      await quinn.goto("/app");
      await expect(
        quinn
          .getByRole("region", { name: "Games you're refereeing" })
          .getByRole("listitem")
          .filter({ hasText: GAME }),
      ).toBeVisible();
      await quinn.goto(`/app/games/${game.gameId}/live`);
      await quinn.getByRole("button", { name: HOME }).click();
      await expect(
        quinn.getByRole("heading", { name: "Top of the 1st" }),
      ).toBeVisible();
      await expectNoAxeViolations(quinn);
      // Four complete innings: Grand Slammers 6, Sun Kickers 3.
      const ordinals = ["1st", "2nd", "3rd", "4th", "5th"];
      for (const [i, runs] of [1, 0, 2, 2, 0, 1, 3, 0].entries()) {
        const half = `${i % 2 === 0 ? "Top" : "Bottom"} of the ${ordinals[Math.floor(i / 2)]}`;
        await expect(quinn.getByRole("heading", { name: half })).toBeVisible();
        await scoreHalf(quinn, runs);
      }
      await quinn.getByRole("button", { name: "End the game" }).click();
      await quinn
        .getByRole("button", { name: `Game over: ${HOME} 6, ${AWAY} 3` })
        .click();
      await expect(quinn.getByRole("status")).toHaveText("Score saved.");
      await expect(
        quinn.getByRole("region", { name: "Reported score" }),
      ).toContainText(`${HOME} 6, ${AWAY} 3`);
      await expectNoAxeViolations(quinn);
    });

    await test.step("the other captain confirms and the score is final", async () => {
      const away = await pageSignedInAs(
        browser,
        await captainEmail(AWAY, SEASON),
      );
      await away.setViewportSize(PHONE);
      await away.goto(`/app/games/${game.gameId}/score`);
      await away.getByRole("button", { name: "Confirm" }).click();
      await expect(away.getByRole("status")).toHaveText(
        "Confirmed. The score is final.",
      );
      await captain.goto(`/app/games/${game.gameId}/score`);
      await expect(
        captain.getByRole("region", { name: "Final score" }),
      ).toContainText(`${HOME} 6, ${AWAY} 3`);
      await expectNoAxeViolations(captain);
      await away.context().close();
    });
    for (const page of [captain, player, quinn]) await page.context().close();
  } finally {
    await game.remove();
  }
});
