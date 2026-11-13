import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { unscoreGame } from "../support/games";
import { pageAs } from "../support/personas";

/**
 * The field has no signal (ADR 0025). Reese Ref enters scores with the app
 * offline; they are saved on the phone and go to the server once when the
 * signal comes back.
 */

/** Opens one of the ref's games' score screen, run by the service worker. */
async function openScoreScreen(page: Page, matchup: string) {
  await page
    .getByRole("listitem")
    .filter({ hasText: matchup })
    .getByRole("link", { name: "Score" })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(matchup);
  // The first page load installs the worker; the outbox needs it running.
  await page.waitForFunction(() => navigator.serviceWorker.controller);
}

const waiting = (page: Page) =>
  page.getByRole("region", { name: "Waiting to send" });

test("a final score entered with no signal is saved once when signal returns", async ({
  browser,
}) => {
  await unscoreGame("Pitch Please", "Base Invaders");
  const ref = await pageAs(browser, "Ref");
  await openScoreScreen(ref, "Pitch Please vs Base Invaders");

  await ref.context().setOffline(true);
  await ref.getByRole("spinbutton", { name: "Pitch Please" }).fill("6");
  await ref.getByRole("spinbutton", { name: "Base Invaders" }).fill("5");
  await ref.getByRole("button", { name: "Save the score" }).click();
  await expect(waiting(ref)).toContainText(
    "Saved on this phone, will send when you're back online.",
  );
  await expect(waiting(ref)).toContainText(
    "Final: Pitch Please 6, Base Invaders 5",
  );
  await expectNoAxeViolations(ref);

  await ref.context().setOffline(false);
  const sent = ref.getByRole("region", { name: "Sent" });
  await expect(sent).toContainText(
    "Saved: Pitch Please 6, Base Invaders 5. It goes final once it's confirmed.",
  );
  await expect(waiting(ref)).toHaveCount(0);
  // The screen refreshes to show the score as reported, once.
  const reported = ref.getByRole("region", { name: "Reported score" });
  await expect(reported).toContainText("Pitch Please 6, Base Invaders 5");
  await expect(reported).toContainText("Reported by Reese Ref");
  await expectNoAxeViolations(ref);

  // Opening the app again sends nothing twice.
  await ref.reload();
  await expect(reported).toBeVisible();
  await expect(ref.getByRole("heading", { name: "History" })).toHaveCount(0);
  await ref.getByRole("region", { name: "Sent" }).getByRole("button").click();
  await expect(ref.getByRole("region", { name: "Sent" })).toHaveCount(0);
  await ref.context().close();
});

test("innings scored with no signal reach the live score in order", async ({
  browser,
}) => {
  await unscoreGame("Grand Slammers", "Foul Play");
  const ref = await pageAs(browser, "Ref");
  await openScoreScreen(ref, "Grand Slammers vs Foul Play");
  await ref.getByRole("link", { name: "Score it inning by inning" }).click();
  await ref.getByRole("button", { name: "Grand Slammers" }).click();
  await expect(
    ref.getByRole("heading", { name: "Top of the 1st" }),
  ).toBeVisible();

  await ref.context().setOffline(true);
  await ref.getByRole("button", { name: "2", exact: true }).click();
  // The next half comes up at once, from what is saved on the phone.
  await expect(
    ref.getByRole("heading", { name: "Bottom of the 1st" }),
  ).toBeVisible();
  await ref.getByRole("button", { name: "3", exact: true }).click();
  await expect(
    ref.getByRole("heading", { name: "Top of the 2nd" }),
  ).toBeVisible();
  await expect(waiting(ref)).toContainText("Top of the 1st: 2 runs");
  await expect(waiting(ref)).toContainText("Bottom of the 1st: 3 runs");
  await expectNoAxeViolations(ref);

  await ref.context().setOffline(false);
  await expect(waiting(ref)).toHaveCount(0);
  await expect(ref.getByRole("region", { name: "Sent" })).toHaveCount(2);

  // Both halves are on the server, in order.
  const live = await ref.evaluate(
    async (path) => {
      const response = await fetch(path, { cache: "no-store" });
      return response.json();
    },
    ref.url().replace(/\/app\/games\/([^/]+)\/live.*$/, "/api/games/$1/live"),
  );
  expect(live).toMatchObject({
    halves: [
      { inning: 1, half: "top", runs: 2 },
      { inning: 1, half: "bottom", runs: 3 },
    ],
  });
  await ref.context().close();
});
