import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";

/**
 * The seeded rulebook is an invented sample, public in the demo. The page
 * is static; searching asks the server's full-text search, and a result
 * moves to the rule and highlights the words (ADR 0066). Runs at phone
 * width like every flow.
 */
// The visibility test below flips a league-wide switch, so this file's tests
// run one after another in one worker.
test.describe.configure({ mode: "serial" });

test("the public rules page has a contents list, rule anchors and no axe violations", async ({
  page,
}) => {
  await page.goto("/rules");
  const contents = page.getByRole("navigation", { name: "Contents" });
  await expect(contents.getByRole("link", { name: "Pitching" })).toBeVisible();
  await expect(page.locator("#rule-pitching--2-1")).toContainText("jog");
  await expectNoAxeViolations(page);
});

test("searching finds the rule, jumps to it and highlights the words", async ({
  page,
}) => {
  await page.goto("/rules");
  await page
    .getByRole("searchbox", { name: "Search the rules" })
    .fill("bunting");
  const hit = page
    .getByRole("search")
    .getByRole("link", { name: /Bunting is allowed/ });
  await expect(hit).toBeVisible();
  await hit.click();
  await expect(page).toHaveURL(/\?h=bunting#/);
  await expect(page.locator("section#kicking-and-running")).toBeInViewport();
  await expectNoAxeViolations(page);
});

test("a search with no match says so", async ({ page }) => {
  await page.goto("/rules");
  await page
    .getByRole("searchbox", { name: "Search the rules" })
    .fill("zeppelin");
  await expect(
    page.getByRole("status").filter({ hasText: "No rule has all of" }),
  ).toBeVisible();
});

test("an owner can switch the rulebook to owners only, and the public page hides it", async ({
  browser,
  page,
}) => {
  const owner = await pageAs(browser, "Admin");
  await owner.goto("/app/admin/rules/rulebook");
  await expectNoAxeViolations(owner);
  await owner.getByLabel("Owners only").check();
  await owner.getByRole("button", { name: "Save who can read it" }).click();
  await expect(
    owner.getByRole("status").filter({ hasText: "Saved." }),
  ).toBeVisible();

  await page.goto("/rules");
  await expect(
    page.getByText("hasn't posted its rules here yet"),
  ).toBeVisible();
  await expect(page.getByRole("searchbox")).toHaveCount(0);

  // Back to public so the other specs see the sample rulebook.
  await owner.getByLabel("Public", { exact: true }).check();
  await owner.getByRole("button", { name: "Save who can read it" }).click();
  await expect(
    owner.getByRole("status").filter({ hasText: "Saved." }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole("searchbox")).toBeVisible();
});

test("an owner reviews a pasted rulebook split into sections before saving", async ({
  browser,
}) => {
  const owner = await pageAs(browser, "Admin");
  await owner.goto("/app/admin/rules/rulebook");
  await owner
    .getByLabel("Rulebook text")
    .fill(
      "1. Sample warmups\n1.1 Teams warm up for five minutes.\n2. Sample cheers\n2.1 Cheering is encouraged.",
    );
  await owner.getByRole("button", { name: "Split into sections" }).click();
  await expect(owner.getByText("Found 2 sections")).toBeVisible();
  await expect(owner.getByLabel("Title").first()).toHaveValue("Sample warmups");
  await expectNoAxeViolations(owner);
});
