import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";
import { leagueDate } from "../support/season";

/**
 * Other groups that share the league's fields (issue #408) at phone width.
 * An admin records a group on a field, with a contact only admins see; adds
 * a permit and records an overlap for a day ahead, which warns them on the
 * permits screen with the borough permit office's number; and the game-day
 * screen names the group on a seeded game day (October 13, 2026,
 * src/seed/demo-personas.ts). A captain never sees the contact.
 */
test.use({ viewport: { width: 390, height: 844 } });

const SEASON = "/app/admin/seasons/fall-2026/fields";
const DAY = "2026-10-13";
const CONTACT = "718-555-0142";

test("an admin records another group, gets an overlap warning and sees them on game day", async ({
  browser,
}) => {
  const admin = await pageAs(browser, "Admin");
  const ahead = leagueDate(21);
  await admin.goto(SEASON);

  // Hours for a group that keeps a regular evening.
  const groups = admin.getByRole("region", {
    name: "Other groups on our fields",
  });
  await groups.getByLabel("Group name").last().fill("Night Soccer Club");
  await groups.getByLabel("Tuesday").last().check();
  await groups.getByLabel("Usually from").last().fill("22:00");
  await groups
    .getByLabel(/^Until/)
    .last()
    .fill("23:30");
  await groups
    .getByLabel(/^Contact/)
    .last()
    .fill(CONTACT);
  await groups.getByRole("button", { name: "Add group" }).click();
  await expect(admin.getByRole("status")).toHaveText("Group added.");
  await expect(
    groups.getByText("Tuesdays, 10:00 pm to 11:30 pm"),
  ).toBeVisible();
  await expect(
    groups.getByText(`Contact (admins only): ${CONTACT}`),
  ).toBeVisible();

  // A group with no usual hours is fine too.
  // Added to every field, so whichever fields host the game day names it.
  const fieldIds = await groups
    .getByLabel("Field")
    .last()
    .locator("option")
    .evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value));
  for (const id of fieldIds) {
    await groups.getByLabel("Field").last().selectOption(id);
    await groups.getByLabel("Group name").last().fill("Pickup Frisbee");
    await groups.getByRole("button", { name: "Add group" }).click();
    await expect(admin.getByRole("status")).toHaveText("Group added.");
  }
  await expect(
    groups.getByText("No usual hours on file").first(),
  ).toBeVisible();

  // Hours that run the wrong way are refused, with a reason.
  await groups.getByLabel("Group name").last().fill("Half a schedule");
  await groups.getByLabel("Usually from").last().fill("20:00");
  await groups.getByRole("button", { name: "Add group" }).click();
  await expect(
    admin.getByRole("alert").filter({ hasText: "Pick the days" }),
  ).toBeVisible();

  // The league holds the field that day, and so does the other group.
  const permits = admin.getByRole("region", { name: "Permit windows" });
  await permits.getByLabel("First date").fill(ahead);
  await permits.getByRole("button", { name: "Add permit hours" }).click();
  await expect(admin.getByRole("status")).toContainText("permit window added");

  const overlaps = admin.getByRole("region", {
    name: "Overlaps with other groups",
  });
  const night = await overlaps
    .locator("option", { hasText: "Night Soccer Club" })
    .getAttribute("value");
  await overlaps.getByLabel("Group").selectOption(night ?? "");
  await overlaps.getByLabel("Date").fill(ahead);
  await overlaps.getByLabel("Note").fill("Both permits say 9 pm");
  await overlaps.getByRole("button", { name: "Record overlap" }).click();
  await expect(admin.getByRole("status")).toHaveText("Overlap recorded.");

  const warning = admin.getByRole("region", {
    name: /another group holds our time$/,
  });
  await expect(warning).toContainText("Night Soccer Club and the league");
  await expect(warning).toContainText("Both permits say 9 pm");
  // The seeded venue is in a borough Parks lists: a number, or the list.
  await expect(
    warning.getByRole("link", { name: /\(\d{3}\) \d{3}-\d{4}|permit office/ }),
  ).toBeVisible();
  await expectNoAxeViolations(admin);

  // The game-day screen names a group that has no usual hours.
  await admin.goto(`/app/admin/today?date=${DAY}`);
  const day = admin.getByRole("region", { name: "Other groups on the fields" });
  await expect(
    day.getByText(/Pickup Frisbee also uses this field/).first(),
  ).toBeVisible();
  await expect(
    day
      .getByRole("link", { name: /Log an overlap or handover problem/ })
      .first(),
  ).toHaveAttribute("href", /incident\?parkRule=shared_space$/);
  await expectNoAxeViolations(admin);
  await admin.context().close();
});

test("only admins reach the groups and their contacts", async ({ browser }) => {
  const captain = await pageAs(browser, "Captain");
  await captain.goto(SEASON);
  await expect(captain.getByText(CONTACT)).toHaveCount(0);
  await expect(captain.getByText("Other groups on our fields")).toHaveCount(0);
  await captain.goto(`/app/admin/today?date=${DAY}`);
  await expect(captain.getByText(CONTACT)).toHaveCount(0);
  await captain.context().close();
});
