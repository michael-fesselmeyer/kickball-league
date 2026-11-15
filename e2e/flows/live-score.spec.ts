import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";

/** Counts a half's runs one tap at a time, then ends it. */
async function scoreHalf(ref: Page, runs: number) {
  for (let i = 0; i < runs; i++)
    await ref.getByRole("button", { name: /^\+1 run/ }).click();
  await ref
    .getByRole("button", {
      name: runs === 0 ? "End half, no runs" : /^End half, \d+ runs?$/,
    })
    .click();
}

/**
 * Reese Ref keeps score live from their phone: "+1 run" for each run and
 * "End half" after each half, with undo for a slip. A spectator on the
 * public game page sees each half arrive without reloading, marked
 * unofficial. Rain stops the game in the 5th, so the ref calls it and the
 * score reverts to the end of the 4th, waiting for a captain to confirm.
 */
test("a ref scores inning by inning and calls the game", async ({
  browser,
}) => {
  const ref = await pageAs(browser, "Ref");
  // The optional nudge on the ref's home screen, once the slot has started.
  await ref
    .getByRole("listitem")
    .filter({ hasText: "Red Rubber Ballers vs Sun Kickers" })
    .getByRole("link", { name: /^Keep score live/ })
    .click();
  await expect(
    ref.getByRole("heading", { name: "Who kicks first?" }),
  ).toBeVisible();
  await ref.getByRole("button", { name: "Sun Kickers" }).click();
  await expect(
    ref.getByRole("heading", { name: "Top of the 1st" }),
  ).toBeVisible();
  await expectNoAxeViolations(ref);

  // A slip: two taps for one run. Undo takes back the last tap.
  const counter = ref.getByRole("button", { name: /^\+1 run/ });
  await counter.click();
  await counter.click();
  await expect(
    ref.getByRole("button", { name: "End half, 2 runs" }),
  ).toBeVisible();
  await ref.getByRole("button", { name: "Undo the last run" }).click();
  await expect(
    ref.getByRole("button", { name: "End half, 1 run" }),
  ).toBeVisible();
  // The count survives a reload on the ref's phone.
  await ref.reload();
  await ref.getByRole("button", { name: "End half, 1 run" }).click();
  await expect(
    ref.getByRole("heading", { name: "Bottom of the 1st" }),
  ).toBeVisible();
  // Ended too soon: undo reopens the half with its run still counted.
  await ref
    .getByRole("button", { name: "Undo: reopen the top of the 1st" })
    .click();
  await expect(
    ref.getByRole("heading", { name: "Top of the 1st" }),
  ).toBeVisible();
  await expect(
    ref.getByRole("button", { name: "End half, 1 run" }),
  ).toBeVisible();

  // Four complete innings, then 3 runs in the top of the 5th.
  const runs = [1, 0, 2, 2, 0, 1, 3, 0, 3];
  const ordinals = ["1st", "2nd", "3rd", "4th", "5th"];
  let spectator: Page | undefined;
  for (const [i, r] of runs.entries()) {
    const half = `${i % 2 === 0 ? "Top" : "Bottom"} of the ${ordinals[Math.floor(i / 2)]}`;
    await expect(ref.getByRole("heading", { name: half })).toBeVisible();
    // The top of the 1st already has its run counted.
    if (i === 0)
      await ref.getByRole("button", { name: "End half, 1 run" }).click();
    else await scoreHalf(ref, r);
    // A spectator opens the game page once play is under way. This old
    // seeded game is outside its time slot, so the page polls only because
    // a half has been entered; the ref's screen moves on before the half
    // reaches the server, so wait until the live score the page reads has it.
    if (i === 0) {
      const path =
        (await ref
          .getByRole("link", { name: "public game page" })
          .getAttribute("href")) ?? "";
      const page = await (await browser.newContext()).newPage();
      await expect
        .poll(async () => {
          const response = await page.request.get(
            `/api/games/${path.split("/").at(-1)}/live`,
          );
          const body: unknown = response.ok() ? await response.json() : null;
          return typeof body === "object" &&
            body !== null &&
            "halves" in body &&
            Array.isArray(body.halves)
            ? body.halves.length
            : 0;
        })
        .toBeGreaterThan(0);
      await page.goto(path);
      spectator = page;
    }
  }
  if (!spectator) throw new Error("The spectator never opened the game.");
  await expect(
    ref.getByRole("heading", { name: "Bottom of the 5th" }),
  ).toBeVisible();

  // The spectator's page catches up on its own within 15 seconds.
  const live = spectator.getByRole("region", { name: "Inning by inning" });
  await expect(live.getByRole("status")).toContainText(
    "Live: Bottom of the 5th",
    { timeout: 15_000 },
  );
  await expect(live).toContainText("Unofficial until final");
  // Sun Kickers kick first: 1 + 2 + 0 + 3 + 3 = 9; Red Rubber Ballers 3.
  await expect(live.getByRole("row", { name: /Sun Kickers/ })).toContainText(
    "9",
  );
  await expectNoAxeViolations(spectator);

  await ref
    .getByRole("button", {
      name: "Called after the 4th: Red Rubber Ballers 3, Sun Kickers 6",
    })
    .click();
  await expect(ref.getByRole("status")).toHaveText("Score saved.");
  await expect(
    ref.getByRole("region", { name: "Reported score" }),
  ).toContainText(
    "Red Rubber Ballers 3, Sun Kickers 6 (called after 4 innings)",
  );

  await expect(live.getByRole("status")).toContainText(
    "called after the 4th: waiting for confirmation",
    { timeout: 15_000 },
  );
  await expect(live.getByRole("row", { name: /Sun Kickers/ })).toContainText(
    "6",
  );
  await ref.context().close();
  await spectator.context().close();
});
