import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageSignedInAs } from "../support/sign-in";

/**
 * A dodgeball league (ADR 0072, seeded by src/seed/dodgeball-league.ts):
 * its admin enters a best-of-five match in sets, and the public standings
 * read sets, with no innings and no live scoring anywhere.
 */
const ADMIN = "dot.dodgewell@seed.example";
const LEAGUE = "/l/dodgeball";
/** The first match of the third Thursday, still waiting for its score. */
const GAME = "f0469000-0000-4000-8000-000000000064";

test("a dodgeball admin enters a match in sets and the standings count them", async ({
  browser,
}) => {
  const page = await pageSignedInAs(browser, ADMIN);
  await page.goto(
    `/app/league/dodgeball?next=${encodeURIComponent(`/app/games/${GAME}/score`)}`,
  );
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toContainText(" vs ");
  const [teamA, teamB] = (await heading.innerText()).split(" vs ") as [
    string,
    string,
  ];
  // Sets, not runs: no innings to fill in and no live score.
  await expect(
    page.getByText(/counts with the sets as they stand/),
  ).toBeVisible();
  await expect(page.getByLabel(/Complete innings/)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Keep score live" })).toHaveCount(
    0,
  );
  await expectNoAxeViolations(page);

  // Four sets is more than a best-of-five match holds for one team.
  await page.getByRole("spinbutton", { name: teamA }).fill("3");
  await page.getByRole("spinbutton", { name: teamB }).fill("1");
  await page.getByRole("button", { name: "Save the score" }).click();
  await expect(page.getByRole("status")).toHaveText("Score saved.");
  await expect(page.getByRole("region", { name: "Final score" })).toContainText(
    `${teamA} 3, ${teamB} 1`,
  );
  await page.context().close();

  const visitor = await browser.newPage();
  await visitor.goto(`${LEAGUE}/seasons/winter-2026/standings`);
  const table = visitor.getByRole("table");
  await expect(table.getByRole("columnheader", { name: "SF" })).toBeAttached();
  await expect(table.getByRole("columnheader", { name: "RF" })).toHaveCount(0);
  await expect(
    visitor.getByText(/then set difference, then sets allowed/),
  ).toBeVisible();
  await expectNoAxeViolations(visitor);
  await visitor.close();
});
