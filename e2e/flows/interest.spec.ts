import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";

// Players mostly use the app on phones.
test.use({ viewport: { width: 390, height: 844 } });

/**
 * Anyone answers the league's interest form without an account. An admin
 * adds an option of their own, sees the answer counted with its friends,
 * and sends a go-ahead; the form no longer offers that option.
 */
test("a visitor answers the interest form and an admin sends the go-ahead", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  // A park of its own, so a retry finds its own option and address.
  const tag = randomBytes(3).toString("hex");
  const park = `Test Park ${tag}`;
  const email = `interest-${tag}@example.test`;
  const admin = await pageAs(browser, "Admin");

  await test.step("the admin adds an option to the open form", async () => {
    await admin.goto("/app/admin/interest");
    await expect(admin.getByRole("heading", { level: 1 })).toHaveText(
      "Interest sign-ups",
    );
    // The demo data opens a form; a database without it gets one here.
    const open = admin.getByRole("button", { name: "Open the form" });
    if (await open.isVisible()) {
      await admin
        .getByLabel("Park", { exact: true })
        .first()
        .fill("Sample Park");
      await open.click();
      await expect(admin.getByRole("status")).toContainText("The form is open");
    }
    await admin.getByLabel("Park", { exact: true }).last().fill(park);
    await admin.getByRole("button", { name: "Add", exact: true }).click();
    await expect(admin.getByRole("status")).toHaveText("Option added.");
    await expect(admin.getByText(park, { exact: true })).toBeVisible();
    await expectNoAxeViolations(admin);
  });

  await test.step("a visitor answers it, with friends and an address", async () => {
    await page.goto("/interest");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.getByLabel(park).selectOption("yes");
    await page.getByLabel("How many friends might join you?").selectOption("2");
    await page.getByLabel(/^Your email/).fill(email);
    await expectNoAxeViolations(page);
    await page.getByRole("button", { name: "Send my answer" }).click();
    await expect(page.getByRole("status")).toContainText("Got it!");
  });

  await test.step("a second answer from the same address replaces the first", async () => {
    await page.goto("/interest");
    await page.getByLabel(park).selectOption("unsure");
    await page.getByLabel("How many friends might join you?").selectOption("0");
    await page.getByLabel(/^Your email/).fill(email.toUpperCase());
    await page.getByRole("button", { name: "Send my answer" }).click();
    await expect(page.getByRole("status")).toContainText("Got it!");
  });

  await test.step("the admin sees one not-sure answer for the option", async () => {
    await admin.goto("/app/admin/interest");
    const option = admin.getByRole("listitem").filter({ hasText: park });
    await expect(option).toContainText("0 yes");
    await expect(option).toContainText("1 not sure (1 players)");
  });

  await test.step("the visitor changes their mind to yes", async () => {
    await page.goto("/interest");
    await page.getByLabel(park).selectOption("yes");
    await page.getByLabel("How many friends might join you?").selectOption("2");
    await page.getByLabel(/^Your email/).fill(email);
    await page.getByRole("button", { name: "Send my answer" }).click();
    await expect(page.getByRole("status")).toContainText("Got it!");
    await admin.goto("/app/admin/interest");
    await expect(
      admin.getByRole("listitem").filter({ hasText: park }),
    ).toContainText("1 yes (3 players with friends)");
  });

  await test.step("the admin sends the go-ahead and it leaves the form", async () => {
    const option = admin.getByRole("listitem").filter({ hasText: park });
    await option.getByText(`Going ahead with ${park}`).click();
    await option.getByLabel("Yes, send it").check();
    await option
      .getByRole("button", { name: "Go ahead and tell them" })
      .click();
    await expect(admin.getByRole("status")).toHaveText(
      "Going ahead. 1 person is being emailed.",
    );
    await expect(
      admin.getByRole("listitem").filter({ hasText: park }),
    ).toContainText("Going ahead");
    await page.goto("/interest");
    await expect(page.getByLabel(park)).toHaveCount(0);
  });
});

test("the form refuses an answer with no email address", async ({ page }) => {
  await page.goto("/interest");
  await page.getByRole("button", { name: "Send my answer" }).click();
  await expect(page.getByRole("alert")).toContainText("email address");
});
