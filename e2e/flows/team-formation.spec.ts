import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { completeProfile, pageAs } from "../support/personas";
import { openSeason } from "../support/season";

/**
 * Starting a new team in a season with open registration: two players ask
 * to start one, an admin approves one and declines the other with a reason.
 * The new captain tells the league about a date the team can't play and a
 * date it would rather not, and the admin sees both before making the
 * schedule.
 */
const SEASON = "Autumn 2027";
const SLUG = "autumn-2027";

async function askForTeam(page: Page, name: string) {
  await completeProfile(page);
  await page.goto(`/app/seasons/${SLUG}/new-team`);
  await expect(
    page.getByRole("heading", { name: "Start a new team", level: 1 }),
  ).toBeVisible();
  await page.getByLabel("Team name").fill(name);
  await page.getByLabel("Expected team size").fill("10");
  await expect(
    page.getByRole("radio", {
      name: "Split it: everyone pays a fixed $90 through their own link.",
    }),
  ).toBeChecked();
  await page
    .getByLabel("Note for the league (optional)")
    .fill("Most of us played together last fall.");
  await page.getByRole("button", { name: "Send the request" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Request sent. The league will email you its answer.",
  );
  await expect(
    page.getByRole("region", { name: "Waiting for the league" }),
  ).toContainText(`You asked to start ${name} for about 10 players`);
}

test("players ask to start teams, an admin answers, and the new captain sends scheduling requests", async ({
  browser,
}) => {
  const admin = await pageAs(browser, "Admin");
  await openSeason(admin, {
    name: SEASON,
    slug: SLUG,
    firstGameDay: "2027-09-07",
    lastGameDay: "2027-11-09",
    registrationCloses: "2027-08-20",
    teamFee: 900,
    freeAgentFee: 70,
    rosterMin: 8,
    rosterMax: 20,
  });

  const ref = await pageAs(browser, "Ref");
  await askForTeam(ref, "Bright Socks");
  await expectNoAxeViolations(ref);
  const player = await pageAs(browser, "Player");
  await askForTeam(player, "Dusk Patrol");

  await admin.goto(`/app/admin/seasons/${SLUG}/new-teams`);
  await expect(
    admin.getByRole("heading", { name: "New-team requests", level: 1 }),
  ).toBeVisible();
  const socks = admin.getByRole("listitem", { name: "Bright Socks" });
  await expect(socks).toContainText(
    "Not registered this season; approving registers them as captain.",
  );
  await expectNoAxeViolations(admin);
  await socks.getByRole("button", { name: "Approve Bright Socks" }).click();
  await expect(admin.getByRole("status")).toHaveText(
    "Approved. The team is forming and the captain has been emailed.",
  );
  const dusk = admin.getByRole("listitem", { name: "Dusk Patrol" });
  await dusk
    .getByLabel("Reason (optional, they see it)")
    .fill("Two teams already use that name in other leagues nearby.");
  await dusk.getByRole("button", { name: /^Decline/ }).click();
  await expect(admin.getByRole("status")).toHaveText(
    "Declined. The requester has been emailed.",
  );

  await player.goto(`/app/seasons/${SLUG}/new-team`);
  await expect(
    player.getByRole("region", { name: "The league declined Dusk Patrol" }),
  ).toContainText(
    "From the league: Two teams already use that name in other leagues nearby.",
  );
  await player.context().close();

  // The approved requester now captains the new team.
  await ref.goto(`/app/seasons/${SLUG}/new-team`);
  await expect(
    ref.getByRole("region", { name: "Bright Socks is approved" }),
  ).toBeVisible();
  await ref.getByRole("link", { name: "Invite your players" }).click();
  await expect(
    ref.getByRole("button", { name: "Make an invite link" }),
  ).toBeVisible();

  await ref.goto(`/app/seasons/${SLUG}/team/requests`);
  await expect(
    ref.getByRole("heading", { name: "Scheduling requests", level: 1 }),
  ).toBeVisible();
  await ref.getByRole("radio", { name: "We can't play (a conflict)" }).check();
  await ref.getByLabel("Date (needed for a conflict)").fill("2027-09-14");
  await ref
    .getByLabel("Note for the admins (optional)")
    .fill("Half the team is at a wedding");
  await ref.getByRole("button", { name: "Save request" }).click();
  await expect(ref.getByRole("status")).toHaveText("Request saved.");
  await ref.getByRole("radio", { name: "We'd rather not play" }).check();
  await ref.getByLabel("Date (needed for a conflict)").fill("2027-10-12");
  await ref.getByRole("button", { name: "Save request" }).click();
  await expect(ref.getByRole("status")).toHaveText("Request saved.");
  await expect(
    ref.getByRole("heading", { name: /^Your team's requests \(2 of \d+\)$/ }),
  ).toBeVisible();
  await expectNoAxeViolations(ref);
  await ref.context().close();

  await admin.goto(`/app/admin/seasons/${SLUG}/requests`);
  await expect(
    admin.getByText("2 requests from 1 team, including 1 conflict."),
  ).toBeVisible();
  await expect(
    admin.getByRole("region", { name: "Bright Socks" }).getByRole("listitem"),
  ).toHaveText([
    /^Can't play: Tue, Sep 14\s*Half the team is at a wedding$/,
    "Would rather not play: Tue, Oct 12",
  ]);
  await expectNoAxeViolations(admin);
  await admin.context().close();
});
