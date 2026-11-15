import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { completeProfile, pageAs } from "../support/personas";
import { confirmAge, openSeason } from "../support/season";

// Players mostly sign up on phones.
test.use({ viewport: { width: 390, height: 844 } });

const SEASON = "Conduct Cup 2027";
const SLUG = "conduct-cup-2027";

function leagueDate(days: number): string {
  const at = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(at);
}

/**
 * An admin publishes the league's code of conduct from the default
 * sections. A player joining as a free agent then has to tick it with the
 * waiver, and it is on the public rules page. Later specs sign waivers
 * through acceptConductIfAsked, since a published code stays.
 */
test("a published code of conduct is read on the rules page and accepted with the waiver", async ({
  browser,
  page: visitor,
}) => {
  test.setTimeout(120_000);
  const admin = await pageAs(browser, "Admin");
  await openSeason(admin, {
    name: SEASON,
    slug: SLUG,
    firstGameDay: leagueDate(40),
    lastGameDay: leagueDate(70),
    registrationCloses: leagueDate(30),
    teamFee: 200,
    freeAgentFee: 60,
    rosterMin: 2,
    rosterMax: 12,
  });

  await test.step("the admin publishes the default sections", async () => {
    await admin.goto("/app/admin/conduct");
    await expect(admin.getByLabel("Title")).toHaveValue("Code of conduct");
    await expect(admin.getByLabel("Full text")).toContainText(
      "Alcohol, glass and sound",
    );
    await expectNoAxeViolations(admin);
    await admin
      .getByRole("button", { name: "Publish as a new version" })
      .click();
    await expect(admin.getByRole("status")).toContainText("published");
  });

  await test.step("anyone can read it on the public rules page", async () => {
    await visitor.goto("/rules");
    await expect(
      visitor.getByRole("heading", { name: "Code of conduct" }),
    ).toBeVisible();
    await expect(visitor.getByText("Leave no trace")).toBeVisible();
    await expectNoAxeViolations(visitor);
  });

  const player = await pageAs(browser, "Ref");
  await completeProfile(player);

  await test.step("a player joining as a free agent sees it with the waiver and must tick it", async () => {
    await player.goto(`/app/seasons/${SLUG}/register`);
    const pool = player.getByRole("region", { name: "Or join on your own" });
    await confirmAge(pool);
    await pool.getByRole("button", { name: "Join as a free agent" }).click();
    await player.goto(`/app/seasons/${SLUG}/waiver`);
    await expect(
      player.getByRole("heading", { name: /Code of conduct/ }),
    ).toBeVisible();
    await player
      .getByLabel("I have read the whole waiver and I agree to it.")
      .check();
    await player.getByLabel("Type your full name to sign").fill("Reese Ref");
    await confirmAge(player);
    await expectNoAxeViolations(player);
    await player.getByRole("button", { name: "Sign the waiver" }).click();
    await expect(player.getByRole("alert")).toContainText(
      "Tick the box to agree to the code of conduct.",
    );
    await player.getByLabel(/I have read the code of conduct/).check();
    await player.getByRole("button", { name: "Sign the waiver" }).click();
    await expect(player.getByRole("status")).toContainText("Signed.");
  });

  await test.step("the admin sees the player accepted", async () => {
    await admin.goto(`/app/admin/conduct?season=${SLUG}`);
    await expect(admin.getByText("1 accepted").first()).toBeVisible();
    await expectNoAxeViolations(admin);
  });

  await player.context().close();
  await admin.context().close();
});
