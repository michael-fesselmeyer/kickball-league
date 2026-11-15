import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { type Member, memberPage } from "../support/people";
import { pageAs } from "../support/personas";

/**
 * Acting admin (issue #468), on a phone. The platform operator (the demo
 * admin on the flows server) makes Sage an owner; Rowan is a player. Sage
 * hands Rowan the Game day power for a few days. Rowan can then open the
 * game-day status screen but still not the scores screen or the acting
 * admin page. Sage ends the handover early and Rowan loses the screen at
 * once. The audit log shows both changes. Both people are made up for this
 * flow.
 */
const PHONE = { width: 390, height: 844 };
const STATUS = "/app/admin/seasons/summer-2026/status";
const SCORES = "/app/admin/seasons/summer-2026/scores";

const owner: Member = {
  first: "Sage",
  last: "Holloway",
  email: "sage.holloway@example.test",
};
const acting: Member = {
  first: "Rowan",
  last: "Pike",
  email: "rowan.pike@example.test",
};

/** A date in the league's time zone, `days` from today, as YYYY-MM-DD. */
function dayFromToday(days: number): string {
  const at = new Date(Date.now() + days * 864e5);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(at);
}

async function expectNotFound(page: Page, path: string) {
  await page.goto(path);
  await expect(
    page.getByRole("heading", { name: "We can't find that page" }),
  ).toBeVisible();
}

test("an owner hands game-day powers to a player for set dates and ends them early", async ({
  browser,
}) => {
  test.slow();
  const sage = await memberPage(browser, owner);
  const rowan = await memberPage(browser, acting);
  const operator = await pageAs(browser, "Admin");
  await sage.setViewportSize(PHONE);
  await rowan.setViewportSize(PHONE);

  try {
    await operator.goto("/operator");
    const form = operator.getByRole("group", {
      name: "Change a person's role",
    });
    await form.getByLabel("Their account email").fill(owner.email);
    await form.getByLabel("Role").selectOption("owner");
    await form.getByRole("button", { name: "Save role" }).click();
    await expect(operator.getByRole("status")).toHaveText("Role saved.");

    await test.step("a player has no admin screens before the handover", async () => {
      await expectNotFound(rowan, STATUS);
      await expectNotFound(rowan, "/app/admin/acting-admins");
    });

    await test.step("the owner hands over the game day power", async () => {
      await sage.goto("/app/admin/acting-admins");
      await expect(
        sage.getByRole("heading", { level: 1, name: "Acting admins" }),
      ).toBeVisible();
      await sage.getByLabel("Player").selectOption({ label: "Rowan P." });
      await sage.getByLabel("First day").fill(dayFromToday(-1));
      await sage.getByLabel("Last day").fill(dayFromToday(3));
      await sage.getByRole("checkbox", { name: "Game day" }).check();
      await expectNoAxeViolations(sage);
      await sage.getByRole("button", { name: "Hand over" }).click();
      await expect(
        sage.getByRole("status").filter({ hasText: "Handover saved." }),
      ).toBeVisible();
      await expect(
        sage.getByRole("listitem").filter({ hasText: "Rowan P." }),
      ).toContainText("acting now");
    });

    await test.step("the acting admin uses the power, and only that power", async () => {
      await rowan.goto(STATUS);
      await expect(
        rowan.getByRole("heading", { name: "Game-day status" }),
      ).toBeVisible();
      await expectNoAxeViolations(rowan);
      await expectNotFound(rowan, SCORES);
      await expectNotFound(rowan, "/app/admin/acting-admins");
      await expectNotFound(rowan, "/app/admin/audit");
    });

    await test.step("the owner ends it and the access goes at once", async () => {
      await sage.goto("/app/admin/acting-admins");
      await sage
        .getByRole("listitem")
        .filter({ hasText: "Rowan P." })
        .getByRole("button", { name: "End now" })
        .click();
      await expect(
        sage.getByRole("status").filter({ hasText: "Handover ended." }),
      ).toBeVisible();
      await expect(
        sage.getByRole("listitem").filter({ hasText: "Rowan P." }),
      ).toContainText("ended early");
      await expectNotFound(rowan, STATUS);
    });

    await test.step("the audit log records both changes", async () => {
      await sage.goto("/app/admin/audit");
      await expect(
        sage.getByText("Named a player acting admin for set dates").first(),
      ).toBeVisible();
      await expect(
        sage.getByText("Ended an acting admin's access").first(),
      ).toBeVisible();
    });
  } finally {
    // Take the owner role back so other flows see the seed as it was.
    await operator.goto("/operator");
    const form = operator.getByRole("group", {
      name: "Change a person's role",
    });
    await form.getByLabel("Their account email").fill(owner.email);
    await form.getByLabel("Role").selectOption("player");
    await form.getByRole("button", { name: "Save role" }).click();
    await operator.context().close();
  }
});
