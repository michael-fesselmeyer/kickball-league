import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { type Member, memberPage } from "../support/people";
import { pageAs } from "../support/personas";
import { download } from "../support/seed-data";
import { pageSignedInAs } from "../support/sign-in";

/**
 * The platform operator's day, across roles, the site's status, feature
 * switches and the audit log, as each one lands on the people it affects.
 * The operator (the demo admin on the flows server) makes Rowan an owner
 * and Jesse an admin; both are made up for this flow.
 *
 * - Paused: a visitor sees the notice, but Rowan can still sign in and
 *   download the league's data.
 * - Read-only: Jesse's change is refused with the read-only notice, while
 *   the operator's own change goes through.
 * - A feature switched off (awards voting) leaves a player's home screen
 *   and its page, and comes back when switched on.
 * - Rowan, as an owner, reads every one of those switches in the audit log.
 *
 * Everything is put back at the end. This file runs with the other
 * site-wide switches, alone, after the rest of the suite.
 */
const owner: Member = {
  first: "Rowan",
  last: "Ellery",
  email: "rowan.ellery@example.test",
};
const admin: Member = {
  first: "Jesse",
  last: "Brook",
  email: "jesse.brook@example.test",
  gender: "Man",
};

async function setStatus(operator: Page, label: string) {
  await operator.goto("/operator");
  await operator
    .getByRole("radio", { name: new RegExp(`^${label}\\.`) })
    .check();
  await operator.getByRole("button", { name: "Save status" }).click();
  await expect(operator.getByRole("status")).toHaveText("Site status saved.");
}

async function setRole(operator: Page, email: string, role: string) {
  await operator.goto("/operator");
  const form = operator.getByRole("group", { name: "Change a person's role" });
  await form.getByLabel("Their account email").fill(email);
  await form.getByLabel("Role").selectOption(role);
  await form.getByRole("button", { name: "Save role" }).click();
  await expect(operator.getByRole("status")).toHaveText("Role saved.");
}

/** Reloads `path` until `check` passes, as a visitor would. */
async function eventually(
  page: Page,
  path: string,
  check: () => Promise<void>,
) {
  await expect(async () => {
    await page.goto(path);
    await check();
  }).toPass();
}

/** Fills the new-event form and sends it. */
async function postEvent(page: Page, name: string) {
  await page.goto("/app/admin/events/new");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Place").fill("Riverside Hall (demo venue)");
  await page.getByLabel("Date", { exact: true }).fill("2027-02-20");
  await page.getByLabel("Starts at").fill("18:00");
  await page.getByLabel("Ends at").fill("20:00");
  await page.getByLabel("Description").fill("A planning night for the spring.");
  await page.getByRole("button", { name: "Create event" }).click();
}

test("the operator's switches reach owners, admins, players and visitors", async ({
  browser,
}) => {
  // Five people, three site states and a feature switch.
  test.slow();
  const operator = await pageAs(browser, "Admin");
  // Accounts and sessions first: signing in is itself a change.
  const jesse = await memberPage(browser, admin);
  const rowanFirst = await memberPage(browser, owner);
  await rowanFirst.context().close();
  const player = await pageAs(browser, "Player");
  await setRole(operator, owner.email, "owner");
  await setRole(operator, admin.email, "admin");

  await test.step("paused: visitors see the notice, an owner still gets the data", async () => {
    await setStatus(operator, "Paused");
    const visitor = await (await browser.newContext()).newPage();
    await eventually(visitor, "/", async () => {
      await expect(visitor.getByRole("main")).toContainText(
        "site is paused for now",
      );
    });
    await visitor.context().close();

    const rowan = await pageSignedInAs(browser, owner.email);
    await rowan.goto("/app/admin");
    const exported = await download(
      rowan.getByRole("link", { name: "Download all league data" }),
    );
    expect(JSON.parse(exported.text)).toHaveProperty("seasons");
    await rowan.context().close();
  });

  await test.step("read-only: an admin's change is refused, the operator's is not", async () => {
    await setStatus(operator, "Read-only");
    await expect(async () => {
      await postEvent(jesse, "Spring planning night (refused)");
      await expect(jesse).toHaveURL(/\/paused$/);
    }).toPass();
    await expect(jesse.getByRole("main")).toContainText(
      "site is read-only for now",
    );
    await expectNoAxeViolations(jesse);

    await postEvent(operator, "Spring planning night");
    // The group-chat copy has a status region of its own.
    await expect(
      operator.getByRole("status").filter({ hasText: "Event created." }),
    ).toBeVisible();
    await setStatus(operator, "Active");
  });

  await test.step("a feature switched off leaves a player's screens until it's back", async () => {
    await operator.goto("/operator");
    const features = operator.getByRole("region", { name: "Features" });
    await features
      .getByRole("button", { name: /^Turn off awards voting/i })
      .click();
    await expect(features).toContainText("Awards voting: off");
    await eventually(player, "/app", async () => {
      await expect(player.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(
        player.getByRole("link", { name: /^Vote for awards/ }),
      ).toHaveCount(0);
    });
    await eventually(player, "/app/vote", async () => {
      await expect(
        player.getByRole("heading", { name: "This page could not be found." }),
      ).toBeVisible();
    });

    await features
      .getByRole("button", { name: /^Turn on awards voting/i })
      .click();
    await expect(features).toContainText("Awards voting: on");
    await eventually(player, "/app", async () => {
      await expect(
        player.getByRole("link", { name: /^Vote for awards/ }),
      ).toBeVisible();
    });
  });

  await test.step("an owner reads every switch in the audit log", async () => {
    const rowan = await pageSignedInAs(browser, owner.email);
    await rowan.goto("/app/admin/audit?only=operator");
    for (const line of [
      "Platform operator changed a person's role",
      "Platform operator changed the site status",
      "Platform operator switched a feature",
    ])
      await expect(rowan.getByText(line).first()).toBeVisible();
    await rowan.context().close();
  });

  await setRole(operator, owner.email, "player");
  await setRole(operator, admin.email, "player");
  await Promise.all(
    [operator, jesse, player].map((page) => page.context().close()),
  );
});
