import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";
import { download, seededPlayerEmail } from "../support/seed-data";

/**
 * The flows server treats the demo admin as the platform operator
 * (playwright.config.ts). The operator downloads the league's data and
 * makes a player an admin and back; the audit log shows each of them. The
 * site-wide switches (read-only, paused, features) are in
 * e2e/site-wide/operator.spec.ts, which runs on its own.
 */
test("the operator exports the league and changes a role, and the audit log records both", async ({
  browser,
}) => {
  const operator = await pageAs(browser, "Admin");
  await operator.goto("/operator");
  await expect(operator.getByRole("heading", { level: 1 })).toHaveText(
    "Operator",
  );

  const exported = await download(
    operator.getByRole("link", { name: "Download the league export" }),
  );
  expect(exported.name).toMatch(/^league-export-\d{4}-\d{2}-\d{2}\.json$/);
  const data = JSON.parse(exported.text) as {
    seasons: { name: string }[];
    teams: unknown[];
    games: unknown[];
  };
  expect(data.seasons.map((s) => s.name)).toContain("Fall 2026");
  expect(data.teams.length).toBeGreaterThan(0);
  expect(data.games.length).toBeGreaterThan(0);

  const email = await seededPlayerEmail();
  const staff = operator.getByRole("region", { name: "Owners and admins" });
  const roleForm = operator.getByRole("group", {
    name: "Change a person's role",
  });
  await roleForm.getByLabel("Their account email").fill(email);
  await roleForm.getByLabel("Role").selectOption("admin");
  await roleForm.getByRole("button", { name: "Save role" }).click();
  await expect(operator.getByRole("status")).toHaveText("Role saved.");
  await expect(staff).toContainText(`(${email}, admin)`);

  await roleForm.getByLabel("Their account email").fill(email);
  await roleForm.getByLabel("Role").selectOption("player");
  await roleForm.getByRole("button", { name: "Save role" }).click();
  await expect(operator.getByRole("status")).toHaveText("Role saved.");
  await expect(staff).not.toContainText(email);

  await operator.goto("/app/admin/audit");
  await expect(
    operator.getByText("Downloaded the league's data").first(),
  ).toBeVisible();
  await operator.getByRole("link", { name: "Platform operator only" }).click();
  await expect(operator).toHaveURL(/\?only=operator$/);
  await expect(
    operator.getByText("Platform operator changed a person's role").first(),
  ).toBeVisible();
  await expect(operator.getByText("Downloaded the league's data")).toHaveCount(
    0,
  );
  await expectNoAxeViolations(operator);
  await operator.context().close();
});

/** A CSV file's lines; it opens with a byte-order mark so Excel reads UTF-8. */
function csvLines(text: string): string[] {
  expect(text.startsWith("\uFEFF")).toBe(true);
  return text.slice(1).trimEnd().split("\r\n");
}

test("a captain and an admin download rosters and payments as CSV", async ({
  browser,
}) => {
  const captain = await pageAs(browser, "Captain");
  await captain.goto("/app/seasons/fall-2026/team");
  const roster = await download(
    captain.getByRole("link", { name: "Download the roster (CSV)" }),
  );
  const [header, ...rows] = csvLines(roster.text);
  expect(header).toBe(
    "Team,Name,Email,Phone,Role,Registration status,Waiver signed,Paid,Shirt size,Shirt status",
  );
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((row) => row.startsWith("The Big Kicks,"))).toBe(true);
  expect(roster.text).toContain("casey.captain@example.test");

  const payments = await download(
    captain.getByRole("link", { name: "Download payments (CSV)" }),
  );
  expect(csvLines(payments.text)[0]).toMatch(/^Paid at,Payer,/);
  await captain.context().close();

  const admin = await pageAs(browser, "Admin");
  await admin.goto("/app/admin/seasons/fall-2026/registrations");
  const everyone = await download(
    admin.getByRole("link", { name: "Download rosters (CSV)" }),
  );
  expect(everyone.text).toContain("The Big Kicks,");
  expect(everyone.text).toContain("Sun Kickers,");

  await admin.goto("/app/admin/audit");
  await expect(admin.getByText("Downloaded a roster").first()).toBeVisible();
  await admin.context().close();
});
