import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { completeProfile, pageAs } from "../support/personas";
import { openSeason, signWaiver } from "../support/season";

// Players mostly use the app on phones.
test.use({ viewport: { width: 390, height: 844 } });

const ZONE = "America/New_York";

/** The league's local date and time, `minutes` from now. */
function leagueClock(minutes: number): { date: string; time: string } {
  const at = new Date(Date.now() + minutes * 60_000);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE }).format(at);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
  return { date, time };
}

function leagueDate(days: number): string {
  return leagueClock(days * 24 * 60).date;
}

async function fillWhen(page: Page, group: string, minutes: number) {
  const when = leagueClock(minutes);
  const fields = page.getByRole("group", { name: group });
  await fields.getByLabel("Date").fill(when.date);
  await fields.getByLabel("Time").fill(when.time);
}

/**
 * An admin puts a free giveaway on tonight's bar night and shows its code.
 * Pat Player scans it and enters, once. Entry closes, the admin draws, and
 * Pat sees the win on the app's home screen.
 */
test("a player checks in at an event, is entered, and wins the draw", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const start = leagueClock(-60);
  const title = "Giveaway bar night";
  const slug = `giveaway-bar-night-${start.date}`;
  const admin = await pageAs(browser, "Admin");

  await test.step("the admin adds an event happening now", async () => {
    await admin.goto("/app/admin/events/new");
    await admin.getByLabel("Kind").selectOption({ label: "Bar night" });
    await admin.getByLabel("Name").fill(title);
    await admin.getByLabel("Place").fill("The Example Taproom, 2 Example Ave");
    await admin.getByLabel("Date", { exact: true }).fill(start.date);
    await admin.getByLabel("Starts at").fill(start.time);
    await admin.getByLabel("Ends at").fill(leagueClock(120).time);
    await admin.getByRole("button", { name: "Create event" }).click();
    await expect(admin.getByRole("status").first()).toContainText(
      "Event created.",
    );
  });

  const code =
    await test.step("the admin adds a giveaway and shows its code", async () => {
      await admin.getByRole("link", { name: "Giveaway", exact: true }).click();
      await expect(admin.getByRole("heading", { level: 1 })).toHaveText(
        "Giveaway",
      );
      await admin.getByLabel("Prize").fill("A pitcher of lemonade");
      await admin
        .getByLabel("Donated by (optional)")
        .fill("The Example Taproom");
      await expect(admin.getByLabel("Official rules")).toHaveValue(
        /^No purchase necessary\./,
      );
      await expectNoAxeViolations(admin);
      await admin.getByRole("button", { name: "Add the giveaway" }).click();
      await expect(admin.getByRole("status")).toHaveText(
        "Giveaway added. Show its code at the event so players can enter.",
      );
      await admin.getByRole("link", { name: "Show the entry code" }).click();
      await expect(
        admin.getByRole("img", { name: `Giveaway entry code for ${title}` }),
      ).toBeVisible();
      await expectNoAxeViolations(admin);
      const shown =
        (await admin.locator(".font-mono").first().textContent()) ?? "";
      expect(shown).toMatch(/^[a-z2-9]{10}$/);
      return shown;
    });

  const player = await pageAs(browser, "Player");
  await test.step("a player scans the code and is entered once", async () => {
    // A made-up code enters no one.
    await player.goto(`/app/events/${slug}/giveaway/enter/aaaaaaaaaa`);
    await expect(player.getByRole("heading", { level: 1 })).toHaveText(
      "That code has moved on",
    );
    await player.goto(`/app/events/${slug}/giveaway/enter/${code}`);
    await expect(player.getByRole("heading", { level: 1 })).toHaveText(
      "Win A pitcher of lemonade",
    );
    await expect(player.getByText(/^No purchase necessary\./)).toBeVisible();
    await expectNoAxeViolations(player);
    await player.getByRole("button", { name: "Enter the giveaway" }).click();
    await expect(player.getByRole("status")).toHaveText(
      "You're in! Good luck. Winners are drawn after entry closes.",
    );
    await expect(
      player.getByRole("heading", { name: "Official rules" }),
    ).toBeVisible();
    await expect(player.getByText("1 person has entered.")).toBeVisible();
    await expectNoAxeViolations(player);

    // Scanning again changes nothing.
    await player.goto(`/app/events/${slug}/giveaway/enter/${code}`);
    await expect(player.getByRole("status")).toHaveText(
      "You're already entered. One entry per person.",
    );
  });

  await test.step("entry closes and the admin draws the winner", async () => {
    await admin.goto(`/app/admin/events/${slug}/giveaway`);
    await fillWhen(admin, "Entry closes", -1);
    await admin.getByRole("button", { name: "Save the giveaway" }).click();
    await expect(admin.getByRole("status")).toHaveText("Giveaway saved.");
    await expect(admin.getByText("1 entry · 1 winner")).toBeVisible();
    await admin.getByLabel("Entry is closed and I'm ready to draw").check();
    await admin.getByRole("button", { name: "Draw the winners" }).click();
    await expect(admin.getByRole("status")).toHaveText(
      "Winners drawn. They'll see it in the app and get one message.",
    );
    const winners = admin.getByRole("region", { name: "Winners" });
    await expect(winners.getByRole("listitem")).toHaveCount(1);
    await expect(winners).toContainText("Pat Player");
    await expectNoAxeViolations(admin);
  });

  await test.step("the winner sees it on their account", async () => {
    await player.goto("/app");
    const won = player.getByRole("region", { name: "You won" });
    await expect(won).toContainText(`A pitcher of lemonade, at ${title}`);
    await expectNoAxeViolations(player);
    await won.getByRole("link").click();
    await expect(player.getByText(/You won!/)).toBeVisible();
  });

  await player.context().close();
  await admin.context().close();
});

const SEASON = "Drive Cup 2027";
const SEASON_SLUG = "drive-cup-2027";
const TEAM = "Sign-Up Sprinters";

/**
 * An admin starts a sign-up challenge in a season of their own. A captain
 * registers a team of two and signs; the team is halfway. A teammate joins
 * by the invite and signs, the team reaches 100% and leads the board, and
 * the admin confirms it as the winner.
 */
test("a team reaches 100% and leads the sign-up challenge", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const admin = await pageAs(browser, "Admin");
  await openSeason(admin, {
    name: SEASON,
    slug: SEASON_SLUG,
    firstGameDay: leagueDate(40),
    lastGameDay: leagueDate(70),
    registrationCloses: leagueDate(30),
    teamFee: 200,
    freeAgentFee: 60,
    rosterMin: 2,
    rosterMax: 12,
  });

  await test.step("the admin starts the challenge", async () => {
    await admin.goto(`/app/admin/seasons/${SEASON_SLUG}`);
    await admin.getByRole("link", { name: "Sign-up challenge" }).click();
    await expect(admin.getByRole("heading", { level: 1 })).toHaveText(
      "Sign-up challenge",
    );
    const start = admin.getByRole("region", { name: "Start a challenge" });
    await start.getByLabel("Prize").fill("A round of lemonade for the team");
    await start.getByLabel("Date").fill(leagueDate(30));
    await start.getByLabel("Time").fill("23:59");
    await start.getByRole("button", { name: "Start the challenge" }).click();
    await expect(admin.getByRole("status")).toHaveText(
      "Challenge started. Players see it on their team page.",
    );
    await expectNoAxeViolations(admin);
  });

  const captain = await pageAs(browser, "Captain");
  let invite = "";
  await test.step("a captain registers and the team is halfway", async () => {
    await completeProfile(captain);
    await captain.goto(`/app/seasons/${SEASON_SLUG}/register`);
    const register = captain.getByRole("region", { name: "Register a team" });
    await register.getByLabel("Team name").fill(TEAM);
    await register.getByLabel("Expected roster size").fill("2");
    await register.getByRole("button", { name: "Register the team" }).click();
    await expect(captain.getByRole("status")).toContainText(
      "Your team is registered",
    );
    await signWaiver(captain, SEASON_SLUG, "Casey Captain");
    await captain.goto(`/app/seasons/${SEASON_SLUG}/team`);
    await expect(
      captain.getByRole("heading", {
        name: "Sign-up challenge: 1 of 2 signed up",
      }),
    ).toBeVisible();
    await captain.getByRole("button", { name: "Make an invite link" }).click();
    const link = captain.getByLabel("Your team's link");
    await expect(link).toHaveValue(/\/app\/join\//);
    invite = await link.inputValue();
  });

  await test.step("a teammate joins and signs, and the team reaches 100%", async () => {
    const player = await pageAs(browser, "Player");
    await completeProfile(player);
    await player.goto(new URL(invite).pathname);
    await player.getByRole("button", { name: `Join ${TEAM}` }).click();
    await expect(player.getByRole("status")).toHaveText(
      `You're on ${TEAM}. Next, sign the waiver.`,
    );
    await signWaiver(player, SEASON_SLUG, "Pat Player");
    await player.goto(`/app/seasons/${SEASON_SLUG}/team`);
    await expect(
      player.getByRole("heading", {
        name: "Sign-up challenge: 2 of 2 signed up",
      }),
    ).toBeVisible();
    await expectNoAxeViolations(player);
    await player.getByRole("link", { name: "See the leaderboard" }).click();
    const board = player.getByRole("list", {
      name: `Leaderboard, ${SEASON}`,
    });
    await expect(board.getByRole("listitem").first()).toContainText(TEAM);
    await expect(board.getByRole("listitem").first()).toContainText(
      "2 of 2 signed up · 100%",
    );
    await expectNoAxeViolations(player);
    await player.context().close();
  });

  await test.step("the admin sees the rate and confirms the winner", async () => {
    await admin.goto(`/app/admin?season=${SEASON_SLUG}`);
    await expect(
      admin
        .getByRole("list", { name: "Sign-up rate by team, lowest first" })
        .getByRole("listitem")
        .filter({ hasText: TEAM }),
    ).toContainText("100%");
    await admin.goto(`/app/admin/seasons/${SEASON_SLUG}/challenge`);
    await admin
      .getByRole("button", { name: `Confirm ${TEAM} as the winner` })
      .click();
    await expect(admin.getByRole("status")).toHaveText(
      "Winner confirmed. It's in the audit log.",
    );
    await expect(admin.getByText(`Winner: ${TEAM}`)).toBeVisible();
    await expectNoAxeViolations(admin);

    await captain.goto(`/app/seasons/${SEASON_SLUG}/challenge`);
    await expect(captain.getByRole("status")).toContainText(
      `${TEAM} won the challenge!`,
    );
  });

  await captain.context().close();
  await admin.context().close();
});
