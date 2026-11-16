import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";

const MAKER = "Test Press & Ink";
const SITE = "https://test-press-ink.example.test/";
const DESIGN = "Lime green jersey with a black stripe";

/**
 * The shirt makers directory and a captain's own shirts: an admin lists a
 * maker (a plain http link is refused), a captain picks "our own shirts or
 * jerseys" and sees the list, describes the shirt for the league history,
 * and stops seeing a maker the admin removes. The history page shows the
 * description under its season. The captain switches back at the end so the
 * demo team is as other specs expect.
 */
test("a captain who opts out sees the shirt makers, and the history shows the team's shirt", async ({
  browser,
}) => {
  test.slow();
  const admin = await pageAs(browser, "Admin");
  const captain = await pageAs(browser, "Captain");

  await test.step("the admin lists a maker, and a plain http link is refused", async () => {
    await admin.goto("/app/admin/shirt-makers");
    await expect(
      admin.getByRole("heading", { level: 1, name: "Shirt makers" }),
    ).toBeVisible();
    await expect(admin.getByText("Corner Print Shop").first()).toBeVisible();
    await expectNoAxeViolations(admin);
    await admin.getByLabel("Name", { exact: true }).first().fill(MAKER);
    await admin
      .getByLabel("Website")
      .first()
      .fill("http://test-press-ink.example.test");
    await admin
      .getByLabel("What they make")
      .first()
      .fill("Custom jerseys, printed in a week.");
    await admin.getByRole("button", { name: "Add maker" }).click();
    await expect(
      admin.getByRole("alert").filter({ hasText: "plain http" }),
    ).toBeVisible();
    await admin.getByLabel("Name", { exact: true }).first().fill(MAKER);
    await admin.getByLabel("Website").first().fill(SITE);
    await admin
      .getByLabel("What they make")
      .first()
      .fill("Custom jerseys, printed in a week.");
    await admin
      .getByLabel("Minimum order (pieces, optional)")
      .first()
      .fill("10");
    await admin.getByRole("button", { name: "Add maker" }).click();
    await expect(admin.getByRole("status")).toContainText("Maker added");
  });

  await test.step("the captain opts out and sees the makers", async () => {
    await captain.goto("/app/seasons/fall-2026/team");
    const section = captain.getByRole("region", { name: "Team shirts" });
    await expect(section).toBeVisible();
    await section
      .getByRole("button", { name: "Our own shirts or jerseys" })
      .click();
    await expect(captain.getByRole("status").first()).toContainText(
      "the team wears its own shirts",
    );
    const makers = captain.getByRole("region", { name: "Team shirts" });
    const link = makers.getByRole("link", { name: new RegExp(MAKER) });
    await expect(link).toHaveAttribute("href", SITE);
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await expect(makers).toContainText("Minimum 10 pieces");
    await expect(
      captain.getByText("This team wears its own shirts or jerseys"),
    ).toBeVisible();
    await expectNoAxeViolations(captain);
    await makers.getByLabel("What the shirt looks like").fill(DESIGN);
    await makers.getByRole("button", { name: "Save description" }).click();
    await expect(captain.getByRole("status").first()).toHaveText(
      "Shirt description saved.",
    );
  });

  await test.step("the league history's shirt archive shows the description", async () => {
    const visitor = await (await browser.newContext()).newPage();
    await expect(async () => {
      await visitor.goto("/history");
      await expect(
        visitor.getByRole("heading", { name: "Shirt archive" }),
      ).toBeVisible();
      await expect(visitor.getByText(DESIGN)).toBeVisible();
    }).toPass({ timeout: 20_000 });
    await expectNoAxeViolations(visitor);
    await visitor.context().close();
  });

  await test.step("a removed maker is gone from the captain's list", async () => {
    await admin.goto("/app/admin/shirt-makers");
    const entry = admin.locator("details").filter({ hasText: MAKER });
    await entry.locator("summary").click();
    await entry
      .getByRole("button", { name: "Remove from the directory" })
      .click();
    await expect(
      admin.getByRole("alert").filter({ hasText: "Tick the box" }),
    ).toBeVisible();
    await admin
      .locator("details")
      .filter({ hasText: MAKER })
      .locator("summary")
      .click();
    await admin
      .locator("details")
      .filter({ hasText: MAKER })
      .getByLabel(`Yes, remove ${MAKER}`)
      .check();
    await admin
      .locator("details")
      .filter({ hasText: MAKER })
      .getByRole("button", { name: "Remove from the directory" })
      .click();
    await expect(admin.getByRole("status")).toContainText("Maker removed");
    await captain.goto("/app/seasons/fall-2026/team");
    await expect(captain.getByText(MAKER)).toHaveCount(0);
    await expect(captain.getByText("Corner Print Shop")).toBeVisible();
  });

  await test.step("the captain goes back to the league's shirts", async () => {
    await captain
      .getByRole("button", { name: "Use the league's shirts instead" })
      .click();
    await expect(captain.getByRole("status").first()).toContainText(
      "back on the league's shirt order",
    );
  });
});

/**
 * The late-joiner screen: an admin logs spare shirts and sees them in
 * stock, and the page is usable with nobody waiting.
 */
test("an admin logs spare shirts on the late-joiner screen", async ({
  browser,
}) => {
  const admin = await pageAs(browser, "Admin");
  await admin.goto("/app/admin/shirt-waiting");
  await expect(
    admin.getByRole("heading", { level: 1, name: "Late-joiner shirts" }),
  ).toBeVisible();
  await expectNoAxeViolations(admin);
  await admin.getByLabel("Size", { exact: true }).selectOption("XL");
  await admin.getByLabel("How many").fill("3");
  await admin.getByLabel("Note (optional)").fill("Left from last spring");
  await admin.getByRole("button", { name: "Log spares" }).click();
  await expect(admin.getByRole("status").first()).toHaveText("Spares logged.");
  await expect(admin.getByText(/In stock:.*3 XL/)).toBeVisible();
  await admin.getByLabel("How many").fill("0");
  await admin.getByRole("button", { name: "Log spares" }).click();
  await expect(
    admin.getByRole("alert").filter({ hasText: "Enter how many spares" }),
  ).toBeVisible();
});
