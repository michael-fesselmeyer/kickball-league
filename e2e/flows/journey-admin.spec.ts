import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { expectNoAxeViolations } from "../support/axe";
import { unscoreGame } from "../support/games";
import { pageAs } from "../support/personas";
import { captainEmail, pageSignedInAs } from "../support/sign-in";

/**
 * An admin's week after a game day, across scores, the weekly recap,
 * announcements and events with an audience. The season's scores screen
 * lists Kickin' Chicken vs Grand Slammers as missing its score; the admin
 * sets it, which is final at once, and the screen drops it. The recap
 * for that game day is drafted from the result, and the admin sends it to
 * one team. Then the admin posts a bowling night for the Grand Slammers
 * only: their captain finds it in the app, another team's captain doesn't,
 * and the public events page never shows it.
 *
 * No other flow scores this game or posts this event; the game is reset
 * first, so a rerun starts from the seed's state.
 */
const SEASON = "fall-2026";
const GAME = "Kickin' Chicken vs Grand Slammers";
const EVENT = "Grand Slammers bowling night";

/** The game's day in the league's time zone, as YYYY-MM-DD. */
async function gameDay(): Promise<string> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const { rows } = await db.query<{ day: string }>(
      `select to_char(sl.starts_at at time zone l.timezone, 'YYYY-MM-DD') as day
         from game g
         join slot sl on sl.id = g.slot_id
         join season s on s.id = g.season_id
         join league l on l.id = s.league_id
         join team_season a on a.id = g.team_a_id join team ta on ta.id = a.team_id
         join team_season b on b.id = g.team_b_id join team tb on tb.id = b.team_id
        where ta.name = 'Kickin'' Chicken' and tb.name = 'Grand Slammers'
          and s.slug = $1`,
      [SEASON],
    );
    const [only] = rows;
    if (!only) throw new Error(`No slot for ${GAME}`);
    return only.day;
  } finally {
    await db.end();
  }
}

test("an admin settles a missing score, sends the recap and posts a team-only event", async ({
  browser,
}) => {
  // Three people sign in, and two public and private lists are compared.
  test.slow();
  await unscoreGame("Kickin' Chicken", "Grand Slammers", SEASON);
  const admin = await pageAs(browser, "Admin");

  await test.step("a missing score is set and leaves the scores list", async () => {
    await admin.goto(`/app/admin/seasons/${SEASON}`);
    await admin.getByRole("link", { name: "Scores", exact: true }).click();
    await expect(admin.getByRole("heading", { level: 1 })).toHaveText("Scores");
    const game = admin.getByRole("listitem").filter({ hasText: GAME });
    await expectNoAxeViolations(admin);
    await game.getByRole("link", { name: "Set score" }).click();
    await expect(admin.getByRole("heading", { level: 1 })).toHaveText(GAME);
    await admin.getByRole("spinbutton", { name: "Kickin' Chicken" }).fill("3");
    await admin.getByRole("spinbutton", { name: "Grand Slammers" }).fill("9");
    await admin.getByRole("button", { name: "Save the score" }).click();
    await expect(admin.getByRole("status")).toHaveText("Score saved.");
    // An admin's score needs nobody's confirmation.
    await expect(
      admin.getByRole("region", { name: "Final score" }),
    ).toContainText("Kickin' Chicken 3, Grand Slammers 9");

    await admin.goto(`/app/admin/seasons/${SEASON}/scores`);
    await expect(admin.getByRole("heading", { level: 1 })).toHaveText("Scores");
    await expect(
      admin.getByRole("listitem").filter({ hasText: GAME }),
    ).toHaveCount(0);
  });

  await test.step("the recap for that day is drafted from the result and sent", async () => {
    await admin.goto(
      `/app/admin/seasons/${SEASON}/recap?day=${await gameDay()}`,
    );
    const message = admin.getByLabel("Message");
    await expect(message).toHaveValue(/Grand Slammers/);
    await expect(message).toHaveValue(/9[–-]3|3[–-]9/);
    await expectNoAxeViolations(admin);
    await admin.getByLabel("Send to").selectOption({ label: "Grand Slammers" });
    await admin.getByRole("button", { name: "Send announcement" }).click();
    await expect(
      admin.getByRole("status").filter({ hasText: "Sent to" }),
    ).toHaveText(/^Sent to \d+ (person|people)\./);
  });

  await test.step("an event for one team reaches that team only", async () => {
    await admin.goto("/app/admin/events/new");
    await admin.getByLabel("Name").fill(EVENT);
    await admin.getByLabel("Place").fill("Lucky Strike Lanes (demo venue)");
    await admin.getByLabel("Date", { exact: true }).fill("2027-01-15");
    await admin.getByLabel("Starts at").fill("19:30");
    await admin.getByLabel("Ends at").fill("22:00");
    await admin
      .getByLabel("Description")
      .fill("Shoes are on the team. Bring socks.");
    await admin.getByRole("radio", { name: /^Chosen teams/ }).check();
    await admin.getByRole("checkbox", { name: "Grand Slammers" }).check();
    await admin.getByRole("button", { name: "Create event" }).click();
    // The group-chat copy has a status region of its own.
    await expect(
      admin.getByRole("status").filter({ hasText: "Event created." }),
    ).toBeVisible();
    await admin.context().close();

    const member = await pageSignedInAs(
      browser,
      await captainEmail("Grand Slammers", SEASON),
    );
    await member.goto("/app/events");
    await expect(
      member.getByRole("link", { name: new RegExp(EVENT) }),
    ).toBeVisible();
    await member.context().close();

    const other = await pageSignedInAs(
      browser,
      await captainEmail("Base Invaders", SEASON),
    );
    await other.goto("/app/events");
    await expect(other.getByRole("heading", { level: 1 })).toHaveText("Events");
    await expect(other.getByText(EVENT)).toHaveCount(0);
    await other.context().close();

    const visitor = await (await browser.newContext()).newPage();
    await visitor.goto("/events");
    await expect(visitor.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(visitor.getByText(EVENT)).toHaveCount(0);
    await visitor.context().close();
  });
});
