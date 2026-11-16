import { expect, type Page, test } from "@playwright/test";
import { Client } from "pg";
import { expectNoAxeViolations } from "../support/axe";
import { addGameInDays } from "../support/game-today";
import { pageAs } from "../support/personas";
import { captainEmail, pageSignedInAs } from "../support/sign-in";

/**
 * League gear (issue #286), at phone width. An admin adds a kit and assigns
 * it to two games added for this flow alone: Kickin' Chicken's captain
 * brings it in two days, Pitch Please's captain the day after. The first
 * captain picks it up from home and hands it on in one tap; the second
 * confirms and reports a missing pump; the admin sees where it is, the
 * report and the history. The games and the kit are removed at the end.
 */
const PHONE = { width: 390, height: 844 };
const HOME_TEAM = "Kickin' Chicken";
const AWAY_TEAM = "Pitch Please";
const KIT = `Kit ${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

let first: Awaited<ReturnType<typeof addGameInDays>>;
let second: Awaited<ReturnType<typeof addGameInDays>>;
let kitPath = "";
const people = { jo: { email: "", name: "" }, sam: { email: "", name: "" } };

/** "Jo S.", as the app names people. */
async function shortName(email: string): Promise<string> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const { rows } = await db.query<{ name: string }>(
      `select coalesce(p.first_name || coalesce(' ' || left(p.last_name, 1) || '.', ''),
                       nullif(u.name, ''), 'A player') as name
         from "user" u left join profile p on p.user_id = u.id
        where u.email = $1`,
      [email],
    );
    const [row] = rows;
    if (!row) throw new Error(`No account for ${email}`);
    return row.name;
  } finally {
    await db.end();
  }
}

async function removeKit() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query("delete from equipment_kit where name = $1", [KIT]);
  } finally {
    await db.end();
  }
}

const gear = (page: Page) => page.getByRole("region", { name: "League gear" });

test.describe.serial("league gear", () => {
  test.beforeAll(async () => {
    first = await addGameInDays(HOME_TEAM, AWAY_TEAM, 2, 11);
    second = await addGameInDays(HOME_TEAM, AWAY_TEAM, 3, 11);
    people.jo.email = await captainEmail(HOME_TEAM, "fall-2026");
    people.sam.email = await captainEmail(AWAY_TEAM, "fall-2026");
    people.jo.name = await shortName(people.jo.email);
    people.sam.name = await shortName(people.sam.email);
  });
  test.afterAll(async () => {
    await removeKit();
    await first?.remove();
    await second?.remove();
  });

  test("an admin adds a kit and assigns it to two games", async ({
    browser,
  }) => {
    const admin = await pageAs(browser, "Admin");
    await admin.setViewportSize(PHONE);
    await admin.goto("/app/admin/equipment");
    await admin.getByRole("textbox", { name: "Name" }).fill(KIT);
    await admin
      .getByRole("textbox", { name: /^What's in it/ })
      .fill("Ball bag (4 balls)\nBases (4)\nPump\nCones (8)\nFirst-aid kit");
    await admin
      .getByRole("textbox", { name: "Home between game days" })
      .fill("Storage locker by the park house");
    await expectNoAxeViolations(admin);
    await admin.getByRole("button", { name: "Add kit" }).click();
    await expect(admin.getByRole("heading", { name: KIT })).toBeVisible();
    await expect(admin.getByRole("status")).toContainText("Kit added");
    kitPath = new URL(admin.url()).pathname;

    for (const [game, person] of [
      [first, people.jo],
      [second, people.sam],
    ] as const) {
      await admin
        .getByRole("combobox", { name: "Game" })
        .selectOption(game.gameId);
      await admin.getByRole("button", { name: "Choose who brings it" }).click();
      await admin
        .getByRole("radio", { name: new RegExp(`^${escape(person.name)}`) })
        .first()
        .check();
      await admin.getByRole("button", { name: `Assign ${KIT}` }).click();
      await expect(admin.getByRole("status")).toContainText("Assigned");
    }
    const games = admin.getByRole("region", { name: "Games it goes to" });
    await expect(games.getByRole("listitem")).toHaveCount(2);
    await expect(games).toContainText(`${people.jo.name} brings it to`);
    await expectNoAxeViolations(admin);
    await admin.context().close();
  });

  test("the first captain picks it up and hands it on in one tap", async ({
    browser,
  }) => {
    const jo = await pageSignedInAs(browser, people.jo.email);
    await jo.setViewportSize(PHONE);
    await jo.goto("/app");
    await expect(gear(jo)).toContainText(`${KIT} is yours on`);
    await expect(gear(jo)).toContainText(
      "pick it up from Storage locker by the park house",
    );
    await gear(jo)
      .getByRole("button", { name: `I picked up ${KIT}` })
      .click();
    await expect(gear(jo).getByRole("status")).toContainText("Picked up");
    await expect(gear(jo)).toContainText(`You have ${KIT}: bring it to`);
    await expectNoAxeViolations(jo);
    await gear(jo)
      .getByRole("button", { name: `I handed ${KIT} to ${people.sam.name}` })
      .click();
    await expect(gear(jo).getByRole("status")).toContainText("Handed on");
    await expect(gear(jo)).toContainText(
      `Waiting for ${people.sam.name} to confirm`,
    );
    await jo.context().close();
  });

  test("the second captain confirms and reports a missing pump", async ({
    browser,
  }) => {
    const sam = await pageSignedInAs(browser, people.sam.email);
    await sam.setViewportSize(PHONE);
    await sam.goto("/app");
    await expect(gear(sam)).toContainText(
      `${people.jo.name} says they handed it to you`,
    );
    await expectNoAxeViolations(sam);
    await gear(sam)
      .getByRole("button", { name: /^Got it/ })
      .click();
    await expect(gear(sam).getByRole("status")).toContainText("Got it");
    await expect(gear(sam)).toContainText(`You have ${KIT}: bring it to`);

    await gear(sam)
      .getByRole("link", { name: `Something missing from ${KIT}?` })
      .click();
    await expect(
      sam.getByRole("heading", { name: `Missing from ${KIT}` }),
    ).toBeVisible();
    await sam.getByRole("checkbox", { name: "Pump" }).check();
    await sam
      .getByRole("textbox", { name: "Note (optional)" })
      .fill("Pump needle snapped at the last game.");
    await expectNoAxeViolations(sam);
    await sam.getByRole("button", { name: "Report it" }).click();
    await expect(gear(sam).getByRole("status")).toContainText("Reported");
    await sam.context().close();
  });

  test("the admin sees where it is, the report and the history", async ({
    browser,
  }) => {
    const admin = await pageAs(browser, "Admin");
    await admin.setViewportSize(PHONE);
    await admin.goto("/app/admin/equipment");
    const row = admin.getByRole("listitem").filter({ hasText: KIT });
    await expect(row).toContainText(`With ${people.sam.name}`);
    await expect(row).toContainText("1 missing-items report");
    await admin.goto(kitPath);
    await expect(
      admin.getByRole("region", { name: "Missing items" }),
    ).toContainText("Pump. Note: Pump needle snapped at the last game.");
    const history = admin.getByRole("region", { name: "History" });
    await expect(history).toContainText(
      `${people.jo.name} handed it to ${people.sam.name}, who confirmed`,
    );
    await expect(history).toContainText(
      `${people.jo.name} picked it up from its home`,
    );
    await expectNoAxeViolations(admin);
    await admin
      .getByRole("region", { name: "Missing items" })
      .getByRole("button", { name: "Mark sorted" })
      .click();
    await expect(admin.getByRole("status")).toContainText("sorted");
    await admin.context().close();
  });
});

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
