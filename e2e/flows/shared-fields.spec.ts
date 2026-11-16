import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { expectNoAxeViolations } from "../support/axe";
import { addGameKickedOffToday } from "../support/game-today";
import { pageAs } from "../support/personas";
import { leagueDate } from "../support/season";

/**
 * Other groups that share the league's fields (issue #408) at phone width.
 * An admin records a group on a field, with a contact only admins see; adds
 * a permit and records an overlap for a day ahead, which warns them on the
 * permits screen with the borough permit office's number; and the game-day
 * screen names a group with no usual hours on a game day. The game, the
 * groups and the permit are this flow's own, on one field it picks, and are
 * removed at the end. A captain never sees the contact.
 */
test.use({ viewport: { width: 390, height: 844 } });

async function withDb<T>(body: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return await body(db);
  } finally {
    await db.end();
  }
}

/** The field the game is on: the one this flow records everything against. */
async function fieldOf(gameId: string): Promise<string> {
  return withDb(async (db) => {
    const { rows } = await db.query<{ id: string }>(
      "select s.field_id as id from game g join slot s on s.id = g.slot_id where g.id = $1",
      [gameId],
    );
    if (!rows[0]) throw new Error("The game has no field");
    return rows[0].id;
  });
}

/** Takes back what the flow added to the field: groups (and their overlaps) and the permit. */
async function cleanUp(fieldId: string, on: string) {
  await withDb(async (db) => {
    await db.query(
      "delete from field_group where field_id = $1 and name = any($2)",
      [fieldId, NAMES],
    );
    await db.query(
      `delete from permit_window where field_id = $1
         and (starts_at at time zone 'America/New_York')::date = $2::date`,
      [fieldId, on],
    );
  });
}

const SEASON = "/app/admin/seasons/fall-2026/fields";
const TEAMS = ["Foul Play", "Pitch Please"] as const;
const NAMES = ["Night Soccer Club", "Pickup Frisbee", "Half a schedule"];
const CONTACT = "718-555-0142";

test("an admin records another group, gets an overlap warning and sees them on game day", async ({
  browser,
}) => {
  const game = await addGameKickedOffToday(...TEAMS);
  const fieldId = await fieldOf(game.gameId);
  const ahead = leagueDate(21);
  const admin = await pageAs(browser, "Admin");
  try {
    await admin.goto(SEASON);

    // Hours for a group that keeps a regular evening, on the game's field.
    const groups = admin.getByRole("region", {
      name: "Other groups on our fields",
    });
    const field = groups.getByLabel("Field", { exact: true }).last();
    await field.selectOption(fieldId);
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
    await field.selectOption(fieldId);
    await groups.getByLabel("Group name").last().fill("Pickup Frisbee");
    await groups.getByRole("button", { name: "Add group" }).click();
    await expect(groups.getByText("No usual hours on file")).toBeVisible();

    // Hours that run the wrong way are refused, with a reason.
    await groups.getByLabel("Group name").last().fill("Half a schedule");
    await groups.getByLabel("Usually from").last().fill("20:00");
    await groups.getByRole("button", { name: "Add group" }).click();
    await expect(
      admin.getByRole("alert").filter({ hasText: "Pick the days" }),
    ).toBeVisible();

    // The league holds the field that day, and so does the other group.
    const permits = admin.getByRole("region", { name: "Permit windows" });
    await permits.getByLabel("Field", { exact: true }).selectOption(fieldId);
    await permits.getByLabel("First date").fill(ahead);
    await permits.getByRole("button", { name: "Add permit hours" }).click();
    await expect(admin.getByRole("status")).toContainText(
      "permit window added",
    );

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
      warning.getByRole("link", {
        name: /\(\d{3}\) \d{3}-\d{4}|permit office/,
      }),
    ).toBeVisible();
    await expectNoAxeViolations(admin);

    // The game-day screen names the group that has no usual hours.
    await admin.goto(`/app/admin/today?date=${leagueDate(0)}`);
    const day = admin.getByRole("region", {
      name: "Other groups on the fields",
    });
    await expect(
      day.getByText(/Pickup Frisbee also uses this field/),
    ).toBeVisible();
    await expect(
      day.getByRole("link", { name: /Log an overlap or handover problem/ }),
    ).toHaveAttribute("href", /incident\?parkRule=shared_space$/);
    await expectNoAxeViolations(admin);
  } finally {
    await admin.context().close();
    await cleanUp(fieldId, ahead);
    await game.remove();
  }
});

test("only admins reach the groups and their contacts", async ({ browser }) => {
  const captain = await pageAs(browser, "Captain");
  await captain.goto(SEASON);
  await expect(captain.getByText(CONTACT)).toHaveCount(0);
  await expect(captain.getByText("Other groups on our fields")).toHaveCount(0);
  await captain.goto(`/app/admin/today?date=${leagueDate(0)}`);
  await expect(captain.getByText(CONTACT)).toHaveCount(0);
  await captain.context().close();
});
