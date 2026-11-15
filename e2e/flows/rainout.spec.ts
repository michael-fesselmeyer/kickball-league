import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { type Member, memberPage } from "../support/people";
import { pageAs } from "../support/personas";

/**
 * Owner-confirmed rain-outs (ADR 0048), on a phone. Fall 2026 has a
 * published schedule; its last game day is the one rained out. Jules, an
 * admin, previews it with the decision card and sends it to the owners.
 * Rowan, an owner, sees who sent it, lets admins confirm too and takes
 * that back, then confirms: the day is cancelled, the makeups saved as a
 * draft and published, which emails the players. The weather is NWS
 * played back (WEATHER_FIXTURE), never the network. Both people are made
 * up for this flow; the operator gives them their roles and takes them
 * back.
 */
const owner: Member = {
  first: "Rowan",
  last: "Vale",
  email: "rowan.vale@example.test",
};
const admin: Member = {
  first: "Jules",
  last: "Park",
  email: "jules.park@example.test",
  gender: "Nonbinary",
};
const PHONE = { width: 390, height: 844 };
const PAGE = "/app/admin/seasons/fall-2026/rainout";

async function setRole(operator: Page, email: string, role: string) {
  await operator.goto("/operator");
  const form = operator.getByRole("group", { name: "Change a person's role" });
  await form.getByLabel("Their account email").fill(email);
  await form.getByLabel("Role").selectOption(role);
  await form.getByRole("button", { name: "Save role" }).click();
  await expect(operator.getByRole("status")).toHaveText("Role saved.");
}

/** Picks Fall 2026's last game day on the rain-out screen and previews it. */
async function previewLastDay(page: Page): Promise<string> {
  await page.goto(PAGE);
  await expect(
    page.getByRole("heading", { name: "Call a rain-out" }),
  ).toBeVisible();
  const date = page.getByLabel("Date");
  const lastDay = await date.locator("option").last().textContent();
  if (!lastDay) throw new Error("Fall 2026 has no game days");
  await date.selectOption({ label: lastDay });
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(
    page.getByRole("heading", { name: `If ${lastDay} is rained out` }),
  ).toBeVisible();
  return lastDay;
}

test("an admin sends a rain-out to the owners and an owner confirms it", async ({
  browser,
}) => {
  // Three people sign in.
  test.slow();
  const jules = await memberPage(browser, admin);
  const rowan = await memberPage(browser, owner);
  const operator = await pageAs(browser, "Admin");
  await setRole(operator, admin.email, "admin");
  await setRole(operator, owner.email, "owner");
  await jules.setViewportSize(PHONE);
  await rowan.setViewportSize(PHONE);

  let lastDay = "";
  await test.step("the admin reads the card and sends the day to the owners", async () => {
    lastDay = await previewLastDay(jules);
    const card = jules.getByRole("region", { name: "Rain-out call" });
    await expect(card).toBeVisible();
    await expect(card).toContainText("National Weather Service");
    await expect(card).toContainText(/Forecast fetched \d/);
    await expectNoAxeViolations(jules);

    // Admins can't cancel the day themselves.
    await expect(
      jules.getByRole("button", { name: /save these makeups as a draft$/ }),
    ).toHaveCount(0);
    await expect(
      jules.getByRole("checkbox", { name: /Let admins confirm/ }),
    ).toHaveCount(0);
    await jules
      .getByRole("button", { name: `Send ${lastDay} to the owners to confirm` })
      .click();
    await expect(
      jules.getByRole("status").filter({ hasText: "Sent to the owners." }),
    ).toBeVisible();
    await expect(
      jules
        .getByRole("status")
        .filter({ hasText: "Jules Park sent this rain-out to the owners" }),
    ).toContainText("Waiting for an owner to confirm.");
    await expectNoAxeViolations(jules);
  });

  await test.step("an owner lets admins confirm, then takes it back", async () => {
    await previewLastDay(rowan);
    const allow = rowan.getByRole("checkbox", { name: /Let admins confirm/ });
    await allow.check();
    await rowan.getByRole("button", { name: "Save who confirms" }).click();
    await expect(
      rowan
        .getByRole("status")
        .filter({ hasText: "Admins can now confirm rain-outs" }),
    ).toBeVisible();

    await previewLastDay(jules);
    await expect(
      jules.getByRole("button", {
        name: `Cancel ${lastDay} and save these makeups as a draft`,
      }),
    ).toBeVisible();

    await rowan.getByRole("checkbox", { name: /Let admins confirm/ }).uncheck();
    await rowan.getByRole("button", { name: "Save who confirms" }).click();
    await expect(
      rowan.getByRole("status").filter({ hasText: "Only owners confirm" }),
    ).toBeVisible();
  });

  await test.step("the owner confirms and publishes the makeups", async () => {
    await previewLastDay(rowan);
    await expect(
      rowan
        .getByRole("status")
        .filter({ hasText: "Jules Park sent this rain-out to the owners" }),
    ).toContainText("Confirm it below");
    await expectNoAxeViolations(rowan);
    await rowan
      .getByRole("button", {
        name: `Cancel ${lastDay} and save these makeups as a draft`,
      })
      .click();
    await expect(rowan).toHaveURL(/\/schedule\?rainout=/);
    // The schedule board has a status region of its own.
    await expect(
      rowan
        .getByRole("status")
        .filter({ hasText: "Rain-out saved as a draft" }),
    ).toBeVisible();
    await rowan.getByRole("button", { name: /^Publish version \d+$/ }).click();
    await expect(
      rowan
        .getByRole("status")
        .filter({ hasText: "Published." })
        .filter({ hasText: /rain-out emails? queued for players/ }),
    ).toBeVisible();
  });

  await test.step("the operator takes both roles back", async () => {
    await setRole(operator, owner.email, "player");
    await setRole(operator, admin.email, "player");
  });
  await jules.context().close();
  await rowan.context().close();
  await operator.context().close();
});
