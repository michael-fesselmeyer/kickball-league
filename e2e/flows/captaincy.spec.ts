import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";
import { captainEmail, pageSignedInAs } from "../support/sign-in";

/** Captains and players mostly use the app on phones. */
const PHONE = { width: 390, height: 844 };
const SEASON = "fall-2026";
const TEAM = "Grand Slammers";

type Person = { email: string; name: string };

/**
 * Grand Slammers' captain makes one teammate a co-captain and offers the
 * captaincy to another. Nothing changes until that teammate accepts on
 * their team page; then they lead the team and the old captain stays on as
 * a co-captain. An admin sees the new roles on the registrations screen
 * and the changes in the audit log. Other flows only meet Grand Slammers as
 * an opponent and never sign in as its people. Each person's step is its
 * own test in a serial group.
 */
test.describe
  .serial("a captain hands the team over and adds a co-captain", () => {
  let captain: Person = { email: "", name: "" };
  let coCaptain: Person = { email: "", name: "" };
  let next: Person = { email: "", name: "" };

  test.beforeAll(async () => {
    const email = await captainEmail(TEAM, SEASON);
    const [lead] = await people("captain");
    const [first, second] = await people("player");
    if (!lead || !first || !second)
      throw new Error(`${TEAM} needs a captain and two players`);
    captain = { email, name: lead.name };
    coCaptain = first;
    next = second;
  });

  test("the captain adds a co-captain and offers the captaincy", async ({
    browser,
  }) => {
    test.slow();
    const page = await pageSignedInAs(browser, captain.email);
    await page.setViewportSize(PHONE);
    await page.goto(`/app/seasons/${SEASON}/team`);
    const panel = page.getByRole("region", { name: "Captain and co-captains" });
    await expect(panel).toBeVisible();

    await panel
      .getByRole("button", { name: `Make co-captain for ${coCaptain.name}` })
      .click();
    await expect(page.getByRole("status")).toHaveText(
      "They're a co-captain now.",
    );
    await expect(
      panel.getByRole("listitem").filter({ hasText: coCaptain.name }),
    ).toContainText("Co-captain");

    await panel
      .getByLabel("Hand the team to")
      .selectOption({ label: next.name });
    await panel.getByRole("button", { name: "Offer the captaincy" }).click();
    await expect(page.getByRole("status")).toHaveText(
      "Offer sent. You stay captain until they accept.",
    );
    await expect(panel).toContainText(
      `Waiting for ${next.name} to accept the captaincy.`,
    );
    await expectNoAxeViolations(page);
    await page.context().close();
  });

  test("the teammate accepts and leads the team", async ({ browser }) => {
    const page = await pageSignedInAs(browser, next.email);
    await page.setViewportSize(PHONE);
    await page.goto(`/app/seasons/${SEASON}/team`);
    const offer = page.getByRole("region", {
      name: new RegExp(`asked you to captain ${TEAM}$`),
    });
    await expect(offer).toContainText("Nothing changes until you say yes.");
    await expectNoAxeViolations(page);
    await offer.getByRole("button", { name: "Become captain" }).click();
    await expect(page.getByRole("status")).toHaveText(
      "You're the captain now.",
    );

    const panel = page.getByRole("region", { name: "Captain and co-captains" });
    await expect(
      panel.getByRole("listitem").filter({ hasText: `${next.name} (you)` }),
    ).toContainText("Captain");
    // The old captain stayed on as a co-captain, and so did the one added.
    for (const who of [captain.name, coCaptain.name])
      await expect(
        panel.getByRole("listitem").filter({ hasText: who }),
      ).toContainText("Co-captain");
    await expect(
      panel.getByRole("button", { name: "Offer the captaincy" }),
    ).toBeVisible();
    await page.context().close();
  });

  test("an admin sees the new roles and the audit log", async ({ browser }) => {
    const admin = await pageAs(browser, "Admin");
    await admin.setViewportSize(PHONE);
    await admin.goto(`/app/admin/seasons/${SEASON}/registrations`);
    await admin
      .getByText(`Captain and co-captains of ${TEAM}`, { exact: false })
      .click();
    const panel = admin.getByRole("region", {
      name: "Captain and co-captains",
      exact: true,
    });
    await expect(
      panel.getByRole("listitem").filter({ hasText: next.name }),
    ).toContainText("Captain");
    await expectNoAxeViolations(admin);

    await admin.goto("/app/admin/audit");
    await expect(
      admin.getByText("Accepted the captaincy of a team").first(),
    ).toBeVisible();
    await expect(
      admin.getByText("Made a teammate a co-captain").first(),
    ).toBeVisible();
    await admin.context().close();
  });
});

/**
 * The team's people in one role, with their emails and the names the team
 * page shows ("Jo S."). The seed gives Grand Slammers co-captains already,
 * so the flow picks plain players to change.
 */
async function people(role: "captain" | "player"): Promise<Person[]> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const { rows } = await db.query<Person>(
      `select u.email,
              coalesce(p.first_name || coalesce(' ' || left(p.last_name, 1) || '.', ''), u.name) as name
         from roster_membership m
         join registration r on r.id = m.registration_id
         join "user" u on u.id = r.user_id
         left join profile p on p.user_id = u.id
         join team_season ts on ts.id = m.team_season_id
         join team t on t.id = ts.team_id
         join season s on s.id = ts.season_id
        where t.name = $1 and s.slug = $2
          and m.role = $3 and m.status = 'active'
        order by u.email
        limit 2`,
      [TEAM, SEASON, role],
    );
    return rows;
  } finally {
    await db.end();
  }
}
