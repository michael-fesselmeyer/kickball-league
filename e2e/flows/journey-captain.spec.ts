import { type Browser, expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { unscoreGame } from "../support/games";
import { pageAs } from "../support/personas";
import { captainEmail, pageSignedInAs } from "../support/sign-in";

/**
 * A captain's game day after the whistle, across scores, standings, team
 * pages, sportsmanship and incidents. The Sun Kickers' captain reports the
 * score of their game against Kickin' Chicken, which had no ref; Kickin'
 * Chicken's captain confirms it, and the public standings and the Sun
 * Kickers' team page count the win. The Sun Kickers' captain rates the
 * other team's sportsmanship, Kickin' Chicken's captain reports an
 * incident from the same game, and an admin finds it waiting for review.
 *
 * Both captains are seeded players, not demo personas, and no other flow
 * scores this game or finalizes another Sun Kickers game, so the counts
 * here are this flow's alone. The game is reset first, so a rerun starts
 * from the seed's state.
 */
const SEASON = "fall-2026";
const HOME = "Sun Kickers";
const AWAY = "Kickin' Chicken";

/**
 * The Sun Kickers' wins in the public standings, read by a new visitor each
 * time: a browser that kept the page may show its own copy once more
 * (stale-while-revalidate), which is a returning visitor's story, not this
 * one's.
 */
async function wins(browser: Browser): Promise<number> {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`/seasons/${SEASON}/standings`);
  // Cells after the team name: rank, then wins, losses and ties.
  const cell = page
    .getByRole("row", { name: new RegExp(HOME) })
    .getByRole("cell")
    .nth(1);
  const count = Number(await cell.textContent());
  await expectNoAxeViolations(page);
  await page.context().close();
  return count;
}

test("a captain reports a score, the other confirms, standings move and an incident reaches the admins", async ({
  browser,
}) => {
  // Three people sign in and two public pages are read twice.
  test.slow();
  await unscoreGame(HOME, AWAY, SEASON);
  const before = await wins(browser);

  const home = await pageSignedInAs(browser, await captainEmail(HOME, SEASON));
  await test.step("the home captain reports the score", async () => {
    await home.goto(`/app/seasons/${SEASON}/team`);
    await home
      .getByRole("listitem")
      .filter({ hasText: `vs ${AWAY}` })
      .getByRole("link", { name: "Enter score" })
      .click();
    await expect(home.getByRole("heading", { level: 1 })).toHaveText(
      `${HOME} vs ${AWAY}`,
    );
    await home.getByRole("spinbutton", { name: HOME }).fill("5");
    await home.getByRole("spinbutton", { name: AWAY }).fill("2");
    await home.getByRole("button", { name: "Save the score" }).click();
    await expect(home.getByRole("status")).toHaveText("Score saved.");
    await expect(
      home.getByRole("region", { name: "Reported score" }),
    ).toContainText(`${HOME} 5, ${AWAY} 2`);
  });
  const scorePage = home.url().replace(/\?.*$/, "");

  const away = await pageSignedInAs(browser, await captainEmail(AWAY, SEASON));
  await test.step("the other captain confirms it and it counts", async () => {
    await away.goto(scorePage);
    await away.getByRole("button", { name: "Confirm" }).click();
    await expect(away.getByRole("status")).toHaveText(
      "Confirmed. The score is final.",
    );
    await expect(
      away.getByRole("region", { name: "Final score" }),
    ).toContainText(`${HOME} 5, ${AWAY} 2`);

    expect(await wins(browser)).toBe(before + 1);
    const visitor = await (await browser.newContext()).newPage();
    await visitor.goto("/teams/sun-kickers");
    await expect(visitor.getByRole("main")).toContainText(AWAY);
    await expect(visitor.getByRole("main")).toContainText(/5\s*[–-]\s*2/);
    await visitor.context().close();
  });

  await test.step("the home captain rates the other team", async () => {
    await home.goto(scorePage);
    const rating = home.getByRole("region", { name: /sportsmanship$/ });
    await rating.getByLabel("5").check();
    await rating
      .getByLabel("Note for the admins (optional)")
      .fill("Gracious about a close call at first.");
    await rating.getByRole("button", { name: "Save rating" }).click();
    await expect(home.getByRole("status")).toContainText(
      "Your rating is saved.",
    );
    await home.context().close();
  });

  const detail = "A thrown bat in the 4th; nobody was hurt.";
  await test.step("the other captain reports an incident from the game", async () => {
    await away.goto(scorePage);
    await away.getByRole("link", { name: "Report an incident" }).click();
    await away
      .getByLabel("What kind of incident")
      .selectOption({ label: "Safety" });
    await away.getByLabel("What happened").fill(detail);
    await expectNoAxeViolations(away);
    await away.getByRole("button", { name: "Send the report" }).click();
    await expect(away.getByRole("status")).toContainText("Report sent");
    await away.context().close();
  });

  await test.step("an admin finds the report waiting for review", async () => {
    const admin = await pageAs(browser, "Admin");
    await admin.goto("/app/admin/incidents");
    await admin
      .getByRole("region", { name: /^To review/ })
      .getByRole("link", { name: `Safety: ${HOME} vs ${AWAY}` })
      .first()
      .click();
    await expect(admin.getByRole("main")).toContainText(detail);
    await admin.context().close();
  });
});
