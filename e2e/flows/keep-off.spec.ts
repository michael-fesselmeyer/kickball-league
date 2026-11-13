import { expect, type Page, test } from "@playwright/test";
import { Client } from "pg";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";
import { captainEmail, pageSignedInAs } from "../support/sign-in";

/** Captains and players mostly use the app on phones. */
const PHONE = { width: 390, height: 844 };

/** The person the seed adds for this flow (src/seed/keep-off.ts). */
const PERSON = {
  name: "Jules Wanderer",
  email: "jules.wanderer@example.test",
};
const SEASON = "fall-2026";
const TEAM = "Red Rubber Ballers";
const OTHER = "Kickin' Chicken";
const REASON = "Keeps arguing every call with the ref.";

/**
 * Red Rubber Ballers' captain puts Jules Wanderer on the team's private
 * "not on my team" list, makes an invite link and asks for subs. Jules
 * opens the link and sees exactly what an expired link shows, and on the
 * sub page sees the other team's request in the same game, never this
 * team's. An admin sees the entry and its reason, and takes it off.
 *
 * Every seeded fall game is already behind us, so the flow adds one game a
 * few days ahead between two teams no other flow signs in for, with a sub
 * request from Kickin' Chicken, and removes them at the end. Each person's
 * step is its own test in a serial group.
 */
test.describe.serial("a captain keeps someone off the team, quietly", () => {
  let inviteLink = "";
  let added: Awaited<ReturnType<typeof addFutureGame>> | null = null;

  test.beforeAll(async () => {
    added = await addFutureGame();
  });

  test.afterAll(async () => {
    if (added) await removeFutureGame(added);
  });

  test("the captain lists Jules, makes a link and asks for subs", async ({
    browser,
  }) => {
    test.slow();
    const captain = await pageSignedInAs(
      browser,
      await captainEmail(TEAM, SEASON),
    );
    await captain.setViewportSize(PHONE);
    await captain.goto(`/app/seasons/${SEASON}/team`);

    const list = captain.getByRole("region", { name: /^Not on my team/ });
    await list.getByText("Not on my team").click();
    await list.getByLabel("Their email address").fill(PERSON.email);
    await list.getByLabel(/^Reason/).fill(REASON);
    await list.getByRole("button", { name: "Add to the list" }).click();
    await expect(captain.getByRole("status")).toHaveText(
      "Added. Nobody tells them.",
    );
    await expect(list.getByRole("listitem")).toContainText([PERSON.name]);
    await expectNoAxeViolations(captain);

    await captain
      .getByRole("button", { name: /^Make (an invite link|a new link)/ })
      .click();
    inviteLink = await captain.getByLabel("Your team's link").inputValue();
    expect(inviteLink).toMatch(/\/app\/join\//);

    await captain
      .getByRole("listitem")
      .filter({ hasText: `vs ${OTHER}` })
      .getByRole("link", { name: "Short? Find subs" })
      .click();
    await captain.getByLabel("How many subs").fill("2");
    await captain.getByLabel("At least this many women").fill("0");
    await captain.getByLabel("At least this many men").fill("0");
    await captain
      .getByRole("button", { name: "Post and email players" })
      .click();
    await expect(captain.getByRole("status")).toContainText("Request posted.");
    await captain.context().close();
  });

  test("Jules sees an expired link and only the other team's request", async ({
    browser,
  }) => {
    const jules = await pageSignedInAs(browser, PERSON.email);
    await jules.setViewportSize(PHONE);
    await jules.goto(new URL(inviteLink).pathname);
    await expect(jules.getByRole("main").getByRole("alert")).toHaveText(
      "This link has expired. Ask your captain for a new one.",
    );
    await expect(jules.getByRole("button", { name: /^Join/ })).toHaveCount(0);
    await expectNoAxeViolations(jules);

    await jules.goto("/app/subs");
    const open = jules.getByRole("region", { name: "Teams looking for subs" });
    await expect(
      open.getByRole("listitem").filter({ hasText: `${OTHER} needs` }),
    ).toBeVisible();
    await expect(
      open.getByRole("listitem").filter({ hasText: `${TEAM} needs` }),
    ).toHaveCount(0);
    await expectNoAxeViolations(jules);
    await noListAnywhere(jules);
    await jules.context().close();
  });

  test("an admin sees the entry and its reason, and takes it off", async ({
    browser,
  }) => {
    const admin = await pageAs(browser, "Admin");
    await admin.setViewportSize(PHONE);
    await admin.goto("/app/admin");
    await admin.getByRole("link", { name: "Not-on-my-team lists" }).click();
    const team = admin.getByRole("region", { name: `${TEAM} (1)` });
    await expect(team).toContainText(PERSON.name);
    await expect(team).toContainText(REASON);
    await expectNoAxeViolations(admin);
    await team
      .getByRole("button", {
        name: `Remove ${PERSON.name} from ${TEAM}'s list`,
      })
      .click();
    await expect(admin.getByRole("status")).toHaveText("Taken off the list.");
    await admin.context().close();
  });
});

/** Jules's own screens never mention a list. */
async function noListAnywhere(page: Page) {
  for (const path of ["/app", "/app/profile"]) {
    await page.goto(path);
    await expect(page.getByText(/not on my team/i)).toHaveCount(0);
  }
}

/**
 * A game a few days ahead between the two teams, on a seeded fall field,
 * and Kickin' Chicken's sub request for it, written straight to the test
 * database the way the schedule and the sub finder would.
 */
async function addFutureGame() {
  return withDb(async (db) => {
    const start = new Date(Date.now() + 4 * 86_400_000);
    start.setUTCHours(23, 0, 0, 0);
    const end = new Date(start.getTime() + 3_600_000);
    const { rows: teams } = await db.query<{ id: string; name: string }>(
      `select ts.id, t.name from team_season ts
         join team t on t.id = ts.team_id
         join season s on s.id = ts.season_id
        where s.slug = $1 and t.name = any($2)`,
      [SEASON, [TEAM, OTHER]],
    );
    const ours = teams.find((t) => t.name === TEAM)?.id;
    const theirs = teams.find((t) => t.name === OTHER)?.id;
    if (!ours || !theirs) throw new Error("The seed has no such teams");
    const { rows: slots } = await db.query<{ id: string; seasonId: string }>(
      `insert into slot (season_id, field_id, starts_at, ends_at, time_index)
       select s.id, f.id, $2, $3, 0
         from season s
         join venue v on v.league_id = s.league_id
         join field f on f.venue_id = v.id
        where s.slug = $1
        order by f.name limit 1
       returning id, season_id as "seasonId"`,
      [SEASON, start, end],
    );
    const slot = slots[0];
    if (!slot) throw new Error("The seed has no field");
    const { rows: games } = await db.query<{ id: string }>(
      `insert into game (season_id, team_a_id, team_b_id, slot_id)
       values ($1, $2, $3, $4) returning id`,
      [slot.seasonId, ours, theirs, slot.id],
    );
    const gameId = games[0]?.id;
    if (!gameId) throw new Error("No game");
    await db.query(
      `insert into sub_request
         (game_id, team_season_id, requested_by, needed, women_needed,
          men_needed, closes_at)
       select $1, $2, r.user_id, 1, 0, 0, $3
         from roster_membership m
         join registration r on r.id = m.registration_id
        where m.team_season_id = $2 and m.role = 'captain'
        limit 1`,
      [gameId, theirs, start],
    );
    return { gameId, slotId: slot.id };
  });
}

async function removeFutureGame(added: { gameId: string; slotId: string }) {
  await withDb(async (db) => {
    // The notices the captain's request queued, so nobody else's inbox keeps them.
    await db.query(
      `delete from message where dedupe_key like any (
         select 'sub_request/' || id || '/%' from sub_request where game_id = $1)`,
      [added.gameId],
    );
    await db.query(
      `delete from sub_claim where sub_request_id in
         (select id from sub_request where game_id = $1)`,
      [added.gameId],
    );
    await db.query(`delete from sub_request where game_id = $1`, [
      added.gameId,
    ]);
    await db.query(`delete from game where id = $1`, [added.gameId]);
    await db.query(`delete from slot where id = $1`, [added.slotId]);
    await db.query(
      `delete from team_keep_off where user_id =
         (select id from "user" where email = $1)`,
      [PERSON.email],
    );
  });
}

async function withDb<T>(body: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return await body(db);
  } finally {
    await db.end();
  }
}
