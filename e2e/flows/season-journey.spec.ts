import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { completeProfile, pageAs } from "../support/personas";
import {
  confirmAge,
  joinAsFreeAgent,
  openSeason,
  signWaiver,
} from "../support/season";
import {
  openCheckoutSession,
  sendCheckoutCompleted,
} from "../support/stripe-webhook";

/**
 * One season from start to finish, across every feature it touches, so a
 * change that breaks the hand-off between two screens shows up here even
 * when each screen's own flow still passes.
 *
 * An admin sets up a season with one game day behind it and two ahead. A
 * captain registers a team with split pay and pays through Stripe's signed
 * webhook; a teammate joins by the captain's invite link and pays their
 * share; a free agent registers and the admin builds a second team around
 * them. The admin publishes the schedule and the public schedule shows it.
 * A player left in the pool picks up a sub spot for next week's game and
 * the captain approves. The game already played gets a score that the
 * other captain confirms, the public standings count it, and the admin
 * rains out the last game day, which queues the notice to the players.
 *
 * Every wait is on something a person would see; there are no sleeps.
 */
const SEASON = "Winter 2026";
const SLUG = "winter-2026";
const HOME = "Night Owls";
const AWAY = "Porch Lights";

/** A date `days` from today in the league's time zone, as YYYY-MM-DD. */
function leagueDate(days: number): string {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(new Date());
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Pays from the season page: Stripe's hosted page is stubbed at its
 * address, and Stripe's webhook is sent signed, as Stripe would once the
 * card is charged.
 */
async function payShare(page: Page, amount: string, email: string) {
  await page.goto(`/app/seasons/${SLUG}`);
  await page.route("https://checkout.stripe.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Stripe Checkout</title><h1>Checkout</h1>",
    }),
  );
  await page
    .getByRole("button", { name: `Pay ${amount} securely with Stripe` })
    .click();
  await expect(page).toHaveURL(/^https:\/\/checkout\.stripe\.com\//);
  const session = await openCheckoutSession(email, SLUG);
  expect(await sendCheckoutCompleted(page.request, session)).toEqual({
    status: 200,
    outcome: "processed",
  });
  await page.goto(`/app/seasons/${SLUG}`);
  await expect(page.getByText(`You're all set for ${SEASON}.`)).toBeVisible();
}

test("a whole season, from setting it up to a rain-out", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const played = leagueDate(-7);
  const next = leagueDate(7);

  const admin = await pageAs(browser, "Admin");

  await test.step("the admin creates the season and opens registration", async () => {
    await openSeason(admin, {
      name: SEASON,
      slug: SLUG,
      firstGameDay: played,
      lastGameDay: leagueDate(14),
      registrationCloses: leagueDate(30),
      teamFee: 1000,
      freeAgentFee: 60,
      rosterMin: 8,
      rosterMax: 20,
    });
  });

  await test.step("the admin adds a field, permits and game slots", async () => {
    await admin.goto(`/app/admin/seasons/${SLUG}/fields`);
    await expect(
      admin.getByRole("heading", { name: "Fields and permits" }),
    ).toBeVisible();
    const venues = admin.getByRole("region", { name: "Venues and fields" });
    await venues.getByLabel("Venue name").fill("Hollow Oak Green");
    await venues.getByRole("button", { name: "Add venue" }).click();
    await expect(admin.getByRole("status")).toHaveText("Venue added.");
    await venues
      .getByRole("combobox", { name: "Venue" })
      .selectOption({ label: "Hollow Oak Green" });
    await venues.getByLabel("Field name").fill("Diamond 1");
    await venues.getByRole("button", { name: "Add field" }).click();
    await expect(
      venues.getByRole("listitem").filter({ hasText: "Hollow Oak Green" }),
    ).toContainText("Diamond 1");

    // One evening a week ago, and the next two weeks: two hour-long slots
    // each, one for the game and one held back for makeups.
    const permits = admin.getByRole("region", { name: "Permit windows" });
    for (const [first, weeks] of [
      [played, "1"],
      [next, "2"],
    ] as const) {
      await permits
        .getByRole("combobox", { name: "Field", exact: true })
        .selectOption({ label: "Diamond 1, Hollow Oak Green" });
      await permits.getByLabel("First date").fill(first);
      await permits.getByLabel("Weeks").fill(weeks);
      await permits.getByLabel("From").fill("19:00");
      await permits.getByLabel("To").fill("21:00");
      await permits
        .getByRole("combobox", { name: "Status", exact: true })
        .selectOption({ label: "Confirmed" });
      await permits.getByRole("button", { name: "Add permit hours" }).click();
      await expect(admin.getByRole("status")).toHaveText(
        `${weeks === "1" ? "1 permit window" : `${weeks} permit windows`} added. Cut slots to use them.`,
      );
    }
    await admin.getByLabel("Minutes per slot").fill("60");
    await admin.getByRole("button", { name: "Cut slots from permits" }).click();
    await expect(admin.getByRole("status")).toContainText(
      "6 slots added, 0 kept and 0 removed.",
    );
    await expectNoAxeViolations(admin);
  });

  const captain = await pageAs(browser, "Captain");
  let inviteLink = "";

  await test.step("a captain registers a team with split pay and pays", async () => {
    await completeProfile(captain);
    await captain.goto(`/app/seasons/${SLUG}/register`);
    const team = captain.getByRole("region", { name: "Register a team" });
    await team.getByLabel("Team name").fill(HOME);
    await team.getByLabel("Expected roster size").fill("10");
    await expect(
      team.getByRole("radio", {
        name: /^Split it: everyone pays a fixed \$100 /,
      }),
    ).toBeChecked();
    await confirmAge(team);
    await team.getByRole("button", { name: "Register the team" }).click();
    await expect(captain.getByRole("status")).toContainText(
      "Your team is registered",
    );

    await signWaiver(captain, SLUG, "Casey Captain");
    await payShare(captain, "$100", "casey.captain@example.test");

    await captain.goto(`/app/seasons/${SLUG}/team`);
    await captain.getByRole("button", { name: "Make an invite link" }).click();
    const link = captain.getByLabel("Your team's link");
    await expect(link).toHaveValue(/\/app\/join\//);
    inviteLink = await link.inputValue();
  });

  await test.step("a teammate joins by the invite link and pays their share", async () => {
    // The admin who runs the league plays on this team. (Pat Player is
    // left for the sub finder: another flow gives Pat league credit, which
    // would change what Pat pays here.)
    const player = admin;
    await completeProfile(player);
    await player.goto(new URL(inviteLink).pathname);
    await expect(player.getByText("Your share is $100.")).toBeVisible();
    await expectNoAxeViolations(player);
    await confirmAge(player);
    await player.getByRole("button", { name: `Join ${HOME}` }).click();
    await expect(player.getByRole("status")).toHaveText(
      `You're on ${HOME}. Next, sign the waiver.`,
    );

    await signWaiver(player, SLUG, "Addie Admin");
    await payShare(player, "$100", "addie.admin@example.test");

    await captain.goto(`/app/seasons/${SLUG}/team`);
    await expect(
      captain.getByText(/2 signed the waiver, 2 paid\./),
    ).toBeVisible();
  });

  await test.step("a free agent registers and the admin builds a team around them", async () => {
    const freeAgent = await pageAs(browser, "Ref");
    await completeProfile(freeAgent);
    await joinAsFreeAgent(freeAgent, SLUG);
    await signWaiver(freeAgent, SLUG, "Reese Ref");
    await freeAgent.context().close();

    await admin.goto(`/app/admin/seasons/${SLUG}/free-agents`);
    const build = admin.getByRole("region", {
      name: "Build a new team from the pool",
    });
    await build.getByLabel("Team name").fill(AWAY);
    await build
      .getByRole("combobox", { name: "Captain" })
      .selectOption({ label: "Reese Ref" });
    await build.getByRole("checkbox", { name: /^Reese Ref/ }).check();
    await expectNoAxeViolations(admin);
    await build.getByRole("button", { name: "Create the team" }).click();
    await expect(admin.getByRole("status")).toHaveText(
      "New team created in forming status, with its captain and players.",
    );
  });

  await test.step("the admin publishes the schedule and the public sees it", async () => {
    await admin.goto(`/app/admin/seasons/${SLUG}/schedule`);
    // One game on each of the three evenings.
    await admin.getByLabel("Rounds").fill("3");
    await admin.getByLabel("Makeup slots kept free each day").fill("1");
    await admin.getByRole("button", { name: "Generate" }).click();
    await expect(
      admin.getByRole("heading", { name: "Version 1 (draft)" }),
    ).toBeVisible();
    await admin.getByRole("button", { name: "Publish version 1" }).click();
    await expect(
      admin.getByRole("status").filter({ hasText: "Published." }),
    ).toBeVisible();

    const visitor = await (await browser.newContext()).newPage();
    await visitor.goto(`/seasons/${SLUG}/schedule`);
    await expect(visitor.getByText(SEASON, { exact: true })).toBeVisible();
    await expect(visitor.getByRole("status")).toHaveText(
      "Showing all 3 games.",
    );
    await expect(
      visitor.getByRole("link", { name: new RegExp(HOME) }).first(),
    ).toBeVisible();
    await visitor.context().close();
  });

  await test.step("a player in the pool picks up a sub spot for next week", async () => {
    const sub = await pageAs(browser, "Player");
    await completeProfile(sub);
    await joinAsFreeAgent(sub, SLUG);
    await signWaiver(sub, SLUG, "Pat Player");

    await captain.goto(`/app/seasons/${SLUG}/team`);
    await captain
      .getByRole("link", { name: "Short? Find subs" })
      .first()
      .click();
    await captain.getByLabel("How many subs").fill("1");
    await captain.getByLabel("At least this many women").fill("0");
    await captain.getByLabel("At least this many men").fill("0");
    await captain
      .getByRole("button", { name: "Post and email players" })
      .click();
    await expect(captain.getByRole("status")).toContainText("Request posted.");

    await sub.goto("/app/subs");
    const request = sub
      .getByRole("listitem")
      .filter({ hasText: `${HOME} needs` });
    await expectNoAxeViolations(sub);
    await request.getByRole("button", { name: /^I'm in/ }).click();
    await expect(sub.getByRole("status")).toHaveText(
      "You're holding a spot. The captain confirms, and you'll get an email.",
    );

    await captain.goto(`/app/seasons/${SLUG}/team/subs`);
    await captain.getByRole("button", { name: /^Approve Pat/ }).click();
    await expect(captain.getByRole("status")).toHaveText(
      "Approved. They'll get an email saying they're playing.",
    );
    await expectNoAxeViolations(captain);

    await sub.goto("/app/subs");
    await expect(
      sub
        .getByRole("listitem")
        .filter({ hasText: `${HOME} needs` })
        .getByText("You're playing! See you at the field."),
    ).toBeVisible();
    await sub.context().close();
  });

  await test.step("a captain enters last week's score and the other confirms", async () => {
    await captain.goto(`/app/seasons/${SLUG}/team`);
    await captain.getByRole("link", { name: "Enter score" }).click();
    await captain.getByRole("spinbutton", { name: HOME }).fill("6");
    await captain.getByRole("spinbutton", { name: AWAY }).fill("3");
    await captain.getByRole("button", { name: "Save the score" }).click();
    await expect(captain.getByRole("status")).toHaveText("Score saved.");
    const scorePage = captain.url().replace(/\?.*$/, "");

    const other = await pageAs(browser, "Ref");
    await other.goto(scorePage);
    await expect(
      other.getByRole("region", { name: "Reported score" }),
    ).toContainText("Reported by Casey Captain");
    await other.getByRole("button", { name: "Confirm" }).click();
    await expect(other.getByRole("status")).toHaveText(
      "Confirmed. The score is final.",
    );
    await other.context().close();

    const visitor = await (await browser.newContext()).newPage();
    await visitor.goto(`/seasons/${SLUG}/standings`);
    // Cells after the team name: rank, then wins, losses and ties.
    const record = (team: string) =>
      visitor.getByRole("row", { name: new RegExp(team) }).getByRole("cell");
    await expect(record(HOME).nth(0)).toHaveText("1");
    await expect(record(HOME).nth(1)).toHaveText("1");
    await expect(record(HOME).nth(2)).toHaveText("0");
    await expect(record(AWAY).nth(1)).toHaveText("0");
    await expect(record(AWAY).nth(2)).toHaveText("1");
    await expectNoAxeViolations(visitor);
    await visitor.context().close();
  });

  await test.step("the admin rains out the last game day and the notice goes out", async () => {
    await admin.goto(`/app/admin/seasons/${SLUG}/rainout`);
    const date = admin.getByLabel("Date");
    const lastDay = await date.locator("option").last().textContent();
    if (!lastDay) throw new Error(`${SEASON} has no game days`);
    await date.selectOption({ label: lastDay });
    await admin.getByRole("button", { name: "Preview" }).click();
    await admin
      .getByRole("button", {
        name: `Cancel ${lastDay} and save these makeups as a draft`,
      })
      .click();
    await expect(
      admin
        .getByRole("status")
        .filter({ hasText: "Rain-out saved as a draft" }),
    ).toBeVisible();
    await admin.getByRole("button", { name: /^Publish version \d+$/ }).click();
    await expect(
      admin
        .getByRole("status")
        .filter({ hasText: "Published." })
        .filter({ hasText: /rain-out emails? queued for players/ }),
    ).toBeVisible();
  });

  await captain.context().close();
  await admin.context().close();
});
