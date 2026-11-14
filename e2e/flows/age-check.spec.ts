import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { completeProfile, pageAs } from "../support/personas";
import { confirmAge, openSeason, signWaiver } from "../support/season";

// Players mostly sign up on phones.
test.use({ viewport: { width: 390, height: 844 } });

const SEASON = "Age Check Cup 2027";
const SLUG = "age-check-cup-2027";

function leagueDate(days: number): string {
  const at = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(at);
}

/**
 * A season sets its minimum age above Reese Ref's (born 1994, from the
 * profile helper): Reese sees why they can't register. The admin lowers
 * it; Reese confirms their age, joins as a free agent and signs the waiver
 * with the same confirmation.
 */
test("a player under the season's minimum age can't register, and one of age confirms and signs", async ({
  browser,
}) => {
  test.setTimeout(90_000);
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
  const setMinimumAge = async (age: string) => {
    await admin.goto(`/app/admin/seasons/${SLUG}`);
    await admin.getByRole("textbox", { name: "Minimum age" }).fill(age);
    await admin.getByRole("button", { name: "Save changes" }).click();
    await expect(admin).toHaveURL(/\?saved=1/);
  };
  await setMinimumAge("40");

  const player = await pageAs(browser, "Ref");
  await completeProfile(player);

  await test.step("a player under the minimum sees why and gets no form", async () => {
    await player.goto(`/app/seasons/${SLUG}/register`);
    await expect(
      player.getByText(
        "Players in this league must be 40 or older, so you can't register this season.",
        { exact: false },
      ),
    ).toBeVisible();
    await expect(
      player.getByRole("button", { name: "Join as a free agent" }),
    ).toHaveCount(0);
    await expectNoAxeViolations(player);
  });

  await test.step("of age, the player confirms and joins as a free agent", async () => {
    await setMinimumAge("25");
    await player.goto(`/app/seasons/${SLUG}/register`);
    const pool = player.getByRole("region", { name: "Or join on your own" });
    await expect(
      pool.getByRole("checkbox", { name: "I'm 25 or older" }),
    ).toBeVisible();
    await expectNoAxeViolations(player);
    await confirmAge(pool);
    await pool.getByRole("button", { name: "Join as a free agent" }).click();
    await expect(player.getByRole("status")).toContainText(
      "You're in the free-agent pool",
    );
  });

  await test.step("the waiver asks for the same confirmation", async () => {
    await player.goto(`/app/seasons/${SLUG}/waiver`);
    await expect(
      player.getByRole("checkbox", { name: "I'm 25 or older" }),
    ).toBeVisible();
    await expectNoAxeViolations(player);
    await signWaiver(player, SLUG, "Reese Ref");
  });

  await player.context().close();
  await admin.context().close();
});
