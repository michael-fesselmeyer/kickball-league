import { expect, type Page, test } from "@playwright/test";
import { Client } from "pg";
import { expectNoAxeViolations } from "../support/axe";
import { pageSignedInAs } from "../support/sign-in";

/** Players and captains mostly use the app on phones. */
const PHONE = { width: 390, height: 844 };

const TAG = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SEASON = `e2e-move-${TAG}`;
const OLD = `Old Owls ${TAG}`;
const NEW = `New Newts ${TAG}`;
const NOTE = "Tuesdays suit me better now.";
const PITCH = "Friendly Tuesday team, we always go out after.";

/** People only this flow uses, on the seed's own domain so a reseed removes them. */
const PEOPLE = {
  mover: { first: "Mo", last: `Mover${TAG}` },
  oldCaptain: { first: "Ola", last: `Owl${TAG}` },
  newCaptain: { first: "Nia", last: `Newt${TAG}` },
} as const;
type Who = keyof typeof PEOPLE;
const email = (who: Who) => `${who.toLowerCase()}.${TAG}@seed.example`;
const fullName = (who: Who) => `${PEOPLE[who].first} ${PEOPLE[who].last}`;

/**
 * Mo plays for Old Owls and quietly says they're open to a new team. Old
 * Owls' captain, recruiting for the same season, never counts or sees
 * them. New Newts' captain sees "1 player", invites without knowing who,
 * and learns Mo's name only after Mo says yes.
 *
 * The flow makes its own draft season (draft seasons recruit, and stay off
 * the public pages other flows read), its two teams and three people, and
 * removes the league data at the end. Each person's step is its own test
 * in a serial group.
 */
test.describe.serial("a player quietly looks for a new team", () => {
  test.beforeAll(async () => {
    await addSeason();
  });

  test.afterAll(async () => {
    await removeSeason();
  });

  test("Mo says they're open to a new team, with a note", async ({
    browser,
  }) => {
    const mo = await phone(browser, "mover");
    await mo.goto("/app/profile");
    await mo.getByRole("link", { name: "Looking for a change" }).click();
    await expect(
      mo.getByRole("heading", { level: 1, name: "Looking for a change?" }),
    ).toBeVisible();
    await mo.getByLabel("Both", { exact: true }).check();
    await mo.getByLabel(/^A short note/).fill(NOTE);
    await mo.getByRole("button", { name: "I'm open to a new team" }).click();
    await expect(mo.getByRole("status")).toHaveText(
      "Saved. Your current team won't see it.",
    );
    await expect(
      mo.getByText(/You're open to a new team, since/),
    ).toBeVisible();
    await expectNoAxeViolations(mo);
    await mo.context().close();
  });

  test("Mo's own captain sees nobody to invite", async ({ browser }) => {
    const captain = await phone(browser, "oldCaptain");
    await captain.goto(`/app/seasons/${SEASON}/team`);
    const recruiting = captain.getByRole("region", {
      name: "Players looking for a change",
    });
    await expect(recruiting).toContainText(
      `No one new to invite to ${OLD} right now.`,
    );
    await expect(
      recruiting.getByRole("button", { name: /^Invite/ }),
    ).toHaveCount(0);
    await nothingAboutMo(captain);
    await expectNoAxeViolations(captain);
    await captain.context().close();
  });

  test("New Newts' captain invites one player without knowing who", async ({
    browser,
  }) => {
    const captain = await phone(browser, "newCaptain");
    await captain.goto(`/app/seasons/${SEASON}/team`);
    const recruiting = captain.getByRole("region", {
      name: "Players looking for a change",
    });
    await expect(recruiting).toContainText(
      `1 player open to a new team hasn't had an invite from ${NEW} yet.`,
    );
    await nothingAboutMo(captain);
    await recruiting.getByLabel(/^A short pitch/).fill(PITCH);
    await recruiting.getByRole("button", { name: "Invite 1 player" }).click();
    await expect(recruiting.getByRole("status")).toHaveText(/^Invites sent\./);
    await expect(recruiting).toContainText(
      "You've invited 1 player; 0 said yes.",
    );
    await nothingAboutMo(captain);
    await expectNoAxeViolations(captain);
    await captain.context().close();
  });

  test("Mo reads the invite and says yes", async ({ browser }) => {
    const mo = await phone(browser, "mover");
    await mo.goto("/app/change-team");
    const invite = mo.getByRole("listitem").filter({ hasText: NEW });
    await expect(invite).toContainText(PITCH);
    await expectNoAxeViolations(mo);
    await invite
      .getByRole("button", { name: "Yes, share my name and email" })
      .click();
    await expect(mo.getByRole("status")).toHaveText(
      "You said yes. That team's captains can now see your name and email.",
    );
    await mo.context().close();
  });

  test("New Newts' captain now sees Mo; Old Owls' captain still doesn't", async ({
    browser,
  }) => {
    const newCaptain = await phone(browser, "newCaptain");
    await newCaptain.goto(`/app/seasons/${SEASON}/team`);
    const yes = newCaptain
      .getByRole("region", { name: "Players looking for a change" })
      .getByRole("listitem");
    await expect(yes).toContainText([fullName("mover")]);
    await expect(yes).toContainText([email("mover")]);
    await expect(yes).toContainText([NOTE]);
    await expectNoAxeViolations(newCaptain);
    await newCaptain.context().close();

    const oldCaptain = await phone(browser, "oldCaptain");
    await oldCaptain.goto(`/app/seasons/${SEASON}/team`);
    await nothingAboutMo(oldCaptain);
    await oldCaptain.context().close();
  });
});

async function phone(browser: Parameters<typeof pageSignedInAs>[0], who: Who) {
  const page = await pageSignedInAs(browser, email(who));
  await page.setViewportSize(PHONE);
  return page;
}

/**
 * Nothing on the team page points to Mo looking for a change: their note
 * appears nowhere, and the recruiting section never names them. (Old
 * Owls' roster lists Mo as a teammate, as it should.)
 */
async function nothingAboutMo(page: Page) {
  await expect(page.getByText(NOTE)).toHaveCount(0);
  const recruiting = page.getByRole("region", {
    name: "Players looking for a change",
  });
  await expect(recruiting).not.toContainText(fullName("mover"));
  await expect(recruiting).not.toContainText(email("mover"));
}

async function withDb<T>(run: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return await run(db);
  } finally {
    await db.end();
  }
}

/**
 * A draft season in the default league, its two teams, a captain for each,
 * and Mo on Old Owls' roster, written straight to the test database.
 */
async function addSeason() {
  await withDb(async (db) => {
    const ids = {} as Record<Who, string>;
    for (const who of Object.keys(PEOPLE) as Who[]) {
      const { rows } = await db.query<{ id: string }>(
        `insert into "user" (name, email, email_verified)
         values ($1, $2, true) returning id`,
        [fullName(who), email(who)],
      );
      const id = rows[0]?.id;
      if (!id) throw new Error("Could not make a person");
      ids[who] = id;
      await db.query(
        `insert into profile (user_id, first_name, last_name)
         values ($1, $2, $3)`,
        [id, PEOPLE[who].first, PEOPLE[who].last],
      );
    }
    const { rows: seasons } = await db.query<{ id: string; league: string }>(
      `insert into season (league_id, name, slug, starts_on, ends_on,
                           fee_model, player_fee_cents, roster_min, roster_max)
       select s.league_id, $1, $2, current_date + 60, current_date + 120,
              s.fee_model, s.player_fee_cents, s.roster_min, s.roster_max
         from season s where s.slug = 'fall-2026'
          and s.league_id = (select id from league where is_default)
       returning id, league_id as league`,
      [`Move ${TAG}`, SEASON],
    );
    const season = seasons[0];
    if (!season) throw new Error("Could not add the season");
    const roster: [string, Who, "captain" | "player"][] = [
      [OLD, "oldCaptain", "captain"],
      [OLD, "mover", "player"],
      [NEW, "newCaptain", "captain"],
    ];
    const entries = new Map<string, string>();
    for (const name of [OLD, NEW]) {
      const { rows } = await db.query<{ id: string }>(
        `with t as (
           insert into team (league_id, name, slug) values ($1, $2, $3)
           returning id
         )
         insert into team_season (team_id, season_id)
         select id, $4 from t returning id`,
        [
          season.league,
          name,
          name.toLowerCase().replaceAll(" ", "-"),
          season.id,
        ],
      );
      const id = rows[0]?.id;
      if (!id) throw new Error("Could not add a team");
      entries.set(name, id);
    }
    for (const [team, who, role] of roster)
      await db.query(
        `with r as (
           insert into registration (season_id, user_id, kind, status)
           values ($1, $2, 'team_member', 'active') returning id
         )
         insert into roster_membership
           (team_season_id, registration_id, role, status)
         select $3, id, $4, 'active' from r`,
        [season.id, ids[who], entries.get(team), role],
      );
  });
}

/** Everything the flow added to the league; the people go with the next reseed. */
async function removeSeason() {
  await withDb(async (db) => {
    await db.query(
      `delete from move_interest where user_id in
         (select id from "user" where email like $1)`,
      [`%.${TAG}@seed.example`],
    );
    await db.query(
      `delete from roster_membership where team_season_id in
         (select ts.id from team_season ts join season s on s.id = ts.season_id
           where s.slug = $1)`,
      [SEASON],
    );
    await db.query(
      `delete from registration where season_id =
         (select id from season where slug = $1)`,
      [SEASON],
    );
    await db.query(
      `delete from team_season where season_id =
         (select id from season where slug = $1)`,
      [SEASON],
    );
    await db.query(`delete from team where name = any($1)`, [[OLD, NEW]]);
    await db.query(`delete from season where slug = $1`, [SEASON]);
  });
}
