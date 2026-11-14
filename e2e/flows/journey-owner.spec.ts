import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { type Member, memberPage } from "../support/people";
import { pageAs } from "../support/personas";
import { download } from "../support/seed-data";

/**
 * Who sees the league's money, across the operator console, roles, the
 * books, the owner dashboard, the audit log and the league export. The
 * platform operator (the demo admin on the flows server) makes Avery an
 * owner and Kit an admin; both are made up for this flow. Avery adds an
 * expense to the books, reads the owner dashboard and the audit log with
 * the books rows in it, and downloads the league's data. Kit, an admin but
 * not an owner, gets no books link, a not-found page at the books' address
 * and an audit log without the books rows. The operator then takes both
 * roles back, and the books are closed to Avery again.
 *
 * The expense goes to Spring 2027, whose books no other flow reads.
 */
const BOOKS_SEASON = "spring-2027";
const owner: Member = {
  first: "Avery",
  last: "Stone",
  email: "avery.stone@example.test",
};
const admin: Member = {
  first: "Kit",
  last: "Marlow",
  email: "kit.marlow@example.test",
  gender: "Man",
};

/**
 * Opens `path` and checks it is the not-found page. The permission check
 * runs inside a Suspense boundary after the page started streaming, so the
 * status is already sent: check the page instead.
 */
async function expectNotFound(page: Page, path: string) {
  await page.goto(path);
  await expect(
    page.getByRole("heading", { name: "This page could not be found." }),
  ).toBeVisible();
}

async function setRole(operator: Page, email: string, role: string) {
  await operator.goto("/operator");
  const form = operator.getByRole("group", { name: "Change a person's role" });
  await form.getByLabel("Their account email").fill(email);
  await form.getByLabel("Role").selectOption(role);
  await form.getByRole("button", { name: "Save role" }).click();
  await expect(operator.getByRole("status")).toHaveText("Role saved.");
}

test("the operator makes an owner and an admin, and only the owner sees the money", async ({
  browser,
}) => {
  // Three people sign in, two of them twice.
  test.slow();
  // Accounts first: a role goes to an existing account.
  const avery = await memberPage(browser, owner);
  const kit = await memberPage(browser, admin);
  const operator = await pageAs(browser, "Admin");
  await setRole(operator, owner.email, "owner");
  await setRole(operator, admin.email, "admin");
  await expect(
    operator.getByRole("region", { name: "Owners and admins" }),
  ).toContainText(`(${owner.email}, owner)`);

  const note = `Line paint for ${BOOKS_SEASON}`;
  await test.step("the owner adds an expense and reads the numbers", async () => {
    await avery.goto("/app/admin");
    await expect(
      avery.getByRole("link", { name: "Books", exact: true }),
    ).toBeVisible();
    await avery.goto(`/app/books/${BOOKS_SEASON}`);
    await expect(avery.getByRole("heading", { level: 1 })).toHaveText(
      "Books: Spring 2027",
    );
    const main = avery.getByRole("main");
    await main.getByLabel("Amount in dollars").fill("32.75");
    await main.getByLabel("Category").selectOption({ label: "Equipment" });
    await main.getByLabel("Note").fill(note);
    await main.getByRole("button", { name: "Add expense" }).click();
    await expect(
      avery.getByRole("status").filter({ hasText: "Expense added." }),
    ).toBeVisible();
    await expect(
      avery.getByRole("listitem").filter({ hasText: note }),
    ).toContainText("Equipment · $32.75");

    // The dashboard's numbers may be a few minutes old; refresh them.
    await avery.goto(`/app/owner/${BOOKS_SEASON}`);
    await expect(avery.getByRole("heading", { level: 1 })).toHaveText(
      "Owner dashboard",
    );
    await avery.getByRole("button", { name: "Refresh now" }).click();
    await expect(
      avery.getByRole("region", { name: "Money in and out" }),
    ).toContainText("$32.75");
    await expectNoAxeViolations(avery);

    await avery.goto("/app/admin/audit");
    await expect(
      avery.getByText("Added an expense to the books").first(),
    ).toBeVisible();
    await expect(
      avery.getByText("Platform operator changed a person's role").first(),
    ).toBeVisible();

    await avery.goto("/app/admin");
    const exported = await download(
      avery.getByRole("link", { name: "Download all league data" }),
    );
    const data = JSON.parse(exported.text) as { seasons: { slug: string }[] };
    expect(data.seasons.map((s) => s.slug)).toContain(BOOKS_SEASON);
  });

  await test.step("an admin who isn't an owner can't see the books", async () => {
    await kit.goto("/app/admin");
    await expect(kit.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      kit.getByRole("link", { name: "Books", exact: true }),
    ).toHaveCount(0);
    await expect(
      kit.getByRole("link", { name: "Download all league data" }),
    ).toHaveCount(0);
    await expectNotFound(kit, `/app/books/${BOOKS_SEASON}`);
    await expectNotFound(kit, `/app/owner/${BOOKS_SEASON}`);

    await kit.goto("/app/admin/audit");
    await expect(
      kit.getByText("Platform operator changed a person's role").first(),
    ).toBeVisible();
    await expect(kit.getByText("Added an expense to the books")).toHaveCount(0);
    await expect(kit.getByText(note)).toHaveCount(0);
  });

  await test.step("the operator takes both roles back", async () => {
    await setRole(operator, owner.email, "player");
    await setRole(operator, admin.email, "player");
    await expect(
      operator.getByRole("region", { name: "Owners and admins" }),
    ).not.toContainText(owner.email);
    await expectNotFound(avery, `/app/books/${BOOKS_SEASON}`);
    await expectNotFound(kit, "/app/admin");
  });
  await Promise.all(
    [avery, kit, operator].map((page) => page.context().close()),
  );
});
