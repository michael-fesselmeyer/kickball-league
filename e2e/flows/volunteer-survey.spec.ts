import { randomBytes } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { Client } from "pg";
import { expectNoAxeViolations } from "../support/axe";
import { memberPage, type Member } from "../support/people";
import { pageAs } from "../support/personas";

// Players mostly use the app on phones.
test.use({ viewport: { width: 390, height: 844 } });

const ZONE = "America/New_York";

/** The league's local date `days` from today. */
function leagueDate(days: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONE }).format(
    new Date(Date.now() + days * 24 * 60 * 60 * 1000),
  );
}

/** The shift card on the members' page whose place is `place`. */
const shiftCard = (page: Page, place: string) =>
  page
    .getByRole("listitem")
    .filter({ hasText: place })
    .filter({
      has: page.getByRole("heading", { level: 3 }),
    });

/**
 * An admin posts a one-spot setup shift for a Fall 2026 game day. Pat
 * Player takes it; the Captain finds it full; Pat drops it and the Captain
 * takes it. The admin sees who is on it.
 */
test("members claim and drop a volunteer shift, never past its spots", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  // A place of its own, so a retry finds its own shift.
  const place = `Field ${randomBytes(3).toString("hex")}`;
  const admin = await pageAs(browser, "Admin");

  await test.step("the admin posts a shift with one spot", async () => {
    await admin.goto("/app/admin/volunteer");
    await admin.getByRole("link", { name: "Post a shift" }).click();
    await expect(admin.getByRole("heading", { level: 1 })).toHaveText(
      "Post a shift",
    );
    await admin.getByLabel("Job").selectOption({ label: "Setup" });
    await admin
      .getByLabel("For", { exact: true })
      .selectOption({ label: "Fall 2026 game day" });
    await admin.getByLabel("Date").fill(leagueDate(3));
    await admin.getByLabel("Starts").fill("18:00");
    await admin.getByLabel("Ends").fill("18:45");
    await admin.getByLabel("Spots").fill("1");
    await admin.getByLabel("Where (optional)").fill(place);
    await expectNoAxeViolations(admin);
    await admin.getByRole("button", { name: "Post the shift" }).click();
    await expect(admin.getByRole("status")).toHaveText(
      "Shift posted. Members can sign up now.",
    );
  });

  const player = await pageAs(browser, "Player");
  await test.step("Pat signs up from the app", async () => {
    await player.getByRole("link", { name: "Volunteer" }).click();
    await expect(player.getByRole("heading", { level: 1 })).toHaveText(
      "Volunteer",
    );
    const card = shiftCard(player, place);
    await expect(card).toContainText("1 of 1 spot left");
    await card.getByRole("button", { name: /^Sign up/ }).click();
    await expect(player.getByRole("status")).toHaveText(
      "You're on the shift. Thanks for helping out!",
    );
    await expect(shiftCard(player, place)).toContainText(
      "You're on this shift. Full",
    );
    await expect(
      player.getByRole("region", { name: "Your shifts" }),
    ).toContainText("Setup, Fall 2026 game day");
    await expectNoAxeViolations(player);
  });

  const captain = await pageAs(browser, "Captain");
  await test.step("the Captain finds it full", async () => {
    await captain.goto("/app/volunteer");
    const card = shiftCard(captain, place);
    await expect(card).toContainText("Full");
    await expect(card.getByRole("button")).toHaveCount(0);
  });

  await test.step("the admin sees who is on it", async () => {
    await admin.goto("/app/admin/volunteer");
    const card = admin
      .getByRole("listitem")
      .filter({ hasText: place })
      .filter({ has: admin.getByRole("heading", { level: 2 }) });
    await expect(card).toContainText("1 of 1 signed up");
    await expect(
      card.getByRole("list", { name: /^Signed up for Setup/ }),
    ).toContainText("Pat");
  });

  await test.step("Pat drops it and the Captain takes it", async () => {
    await shiftCard(player, place)
      .getByRole("button", { name: /^Drop this shift/ })
      .click();
    await expect(player.getByRole("status")).toHaveText(
      "You've dropped the shift.",
    );
    await captain.reload();
    await shiftCard(captain, place)
      .getByRole("button", { name: /^Sign up/ })
      .click();
    await expect(captain.getByRole("status")).toHaveText(
      "You're on the shift. Thanks for helping out!",
    );
  });

  await test.step("the admin adds a spot", async () => {
    await admin.goto("/app/admin/volunteer");
    await admin
      .getByRole("listitem")
      .filter({ hasText: place })
      .filter({ has: admin.getByRole("heading", { level: 2 }) })
      .getByRole("link", { name: /^Edit Setup/ })
      .click();
    await expect(admin.getByText("1 of 1 signed up.")).toBeVisible();
    await expectNoAxeViolations(admin);
    await admin.getByLabel("Spots").fill("2");
    await admin.getByRole("button", { name: "Save the shift" }).click();
    await expect(admin.getByRole("status")).toHaveText("Shift saved.");
    await player.reload();
    await expect(shiftCard(player, place)).toContainText("1 of 2 spots left");
  });

  for (const page of [admin, player, captain]) await page.context().close();
});

const JULES: Member = {
  first: "Jules",
  last: "Ashby",
  email: "survey-jules@example.test",
};

/**
 * Puts the member on Kick Starters' roster in Spring 2026, a completed
 * season the seed's people never played in, and clears any survey a
 * previous run opened there, so the flow starts fresh.
 */
async function rosterInSpring2026(email: string): Promise<void> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query("begin");
    const { rows } = await db.query<{
      season_id: string;
      team_season_id: string;
      user_id: string;
    }>(
      `select s.id as season_id, ts.id as team_season_id, u.id as user_id
         from season s
         join team_season ts on ts.season_id = s.id
         join team t on t.id = ts.team_id
         join "user" u on u.email = $1
        where s.slug = 'spring-2026' and t.slug = 'kick-starters'`,
      [email],
    );
    const [found] = rows;
    if (!found) throw new Error("No Kick Starters in Spring 2026");
    await db.query(`delete from season_survey where season_id = $1`, [
      found.season_id,
    ]);
    const reg = await db.query<{ id: string }>(
      `insert into registration (season_id, user_id, kind, status)
       values ($1, $2, 'team_member', 'active')
       on conflict (season_id, user_id) do update set status = 'active'
       returning id`,
      [found.season_id, found.user_id],
    );
    const registrationId = reg.rows[0]?.id;
    await db.query(
      `insert into roster_membership
         (team_season_id, registration_id, role, status, started_at)
       select $1, $2, 'player', 'active', now()
        where not exists (select 1 from roster_membership
                           where registration_id = $2 and status = 'active')`,
      [found.team_season_id, registrationId],
    );
    await db.query("commit");
  } catch (error) {
    await db.query("rollback");
    throw error;
  } finally {
    await db.end();
  }
}

/**
 * An admin opens the survey for a completed season. A player who was on a
 * roster sees it on the home screen, answers once, and can't answer again.
 * The admin sees the totals and the comment, with no name next to it.
 */
test("a player answers the season survey once and the admin sees anonymous results", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const jules = await memberPage(browser, JULES);
  await rosterInSpring2026(JULES.email);
  const comment = `Loved the after-parties ${randomBytes(2).toString("hex")}`;
  const admin = await pageAs(browser, "Admin");
  const page = "/app/admin/seasons/spring-2026/survey";

  await test.step("the admin opens the survey", async () => {
    await admin.goto(page);
    await expect(admin.getByRole("heading", { level: 1 })).toHaveText(
      "Season survey",
    );
    await expectNoAxeViolations(admin);
    await admin
      .getByRole("button", { name: "Open the survey and invite players" })
      .click();
    await expect(admin.getByRole("status")).toContainText("Survey opened.");
    await expect(admin.getByText("0 of 1 player answered (0%)")).toBeVisible();
  });

  await test.step("the player answers from the home screen", async () => {
    await jules.goto("/app");
    await jules
      .getByRole("link", { name: "How was Spring 2026? Take the survey" })
      .click();
    await expect(jules.getByRole("heading", { level: 1 })).toHaveText(
      "How was Spring 2026?",
    );
    await expectNoAxeViolations(jules);
    await jules
      .getByRole("group", { name: "Overall, how was the season?" })
      .getByLabel("5, loved it")
      .check();
    await jules
      .getByRole("group", { name: "Would you play again next season?" })
      .getByLabel("Yes")
      .check();
    await jules
      .getByLabel("What was the best part? (optional)")
      .fill("Meeting people");
    await jules.getByLabel("Anything else? (optional)").fill(comment);
    await jules.getByRole("button", { name: "Send my answers" }).click();
    await expect(jules.getByRole("status")).toHaveText(
      "Thanks! Your answers are in.",
    );
    await expect(
      jules.getByRole("button", { name: "Send my answers" }),
    ).toHaveCount(0);
    await jules.goto("/app");
    await expect(
      jules.getByRole("link", { name: /Take the survey/ }),
    ).toHaveCount(0);
  });

  await test.step("the admin sees totals and the comment, not who wrote it", async () => {
    await admin.goto(page);
    await expect(
      admin.getByText("1 of 1 player answered (100%)"),
    ).toBeVisible();
    await expect(admin.getByText("5.0 out of 5")).toBeVisible();
    await expect(
      admin.getByRole("region", { name: "Anything else?" }),
    ).toContainText(comment);
    await expect(admin.getByRole("main")).not.toContainText("Jules");
    await expect(admin.getByRole("main")).not.toContainText("Ashby");
    await expectNoAxeViolations(admin);
  });

  for (const p of [admin, jules]) await p.context().close();
});
