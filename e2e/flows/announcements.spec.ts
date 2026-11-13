import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";

/**
 * Casey Captain emails The Big Kicks from the team page, and an admin emails
 * one team from the season's admin hub. Each lands in its sent list.
 */
test("a captain messages the team and an admin messages a team", async ({
  browser,
}) => {
  const captain = await pageAs(browser, "Captain");
  await captain.goto("/app/seasons/fall-2026/team");
  await captain.getByRole("link", { name: "Message your team" }).click();
  await expect(captain.getByRole("heading", { level: 1 })).toHaveText(
    "Message your team",
  );
  await captain.getByLabel("Subject").fill("Bring the orange jerseys");
  await captain
    .getByLabel("Message")
    .fill("We're the home team on Thursday, so orange it is.");
  await captain.getByRole("button", { name: "Send announcement" }).click();
  // The sent list has a status region of its own.
  await expect(
    captain.getByRole("status").filter({ hasText: "Sent to" }),
  ).toHaveText(
    /^Sent to \d+ people\. Anyone who turned announcements off is skipped\.$/,
  );
  await expect(
    captain.getByRole("region", { name: "Sent to the team" }),
  ).toContainText("Bring the orange jerseys");
  await expectNoAxeViolations(captain);
  await captain.context().close();

  const admin = await pageAs(browser, "Admin");
  await admin.goto("/app/admin/seasons/fall-2026");
  await admin.getByRole("link", { name: "Announcements" }).click();
  await expect(admin.getByRole("heading", { level: 1 })).toHaveText(
    "Announcements",
  );
  await admin.getByLabel("Send to").selectOption({ label: "Sun Kickers" });
  await admin.getByLabel("Subject").fill("Field 2 is closed this week");
  await admin
    .getByLabel("Message")
    .fill("Your game moves to Field 3, same time.");
  await admin.getByRole("button", { name: "Send announcement" }).click();
  await expect(
    admin.getByRole("status").filter({ hasText: "Sent to" }),
  ).toHaveText(/^Sent to \d+ people\./);
  await expect(admin.getByText("Field 2 is closed this week")).toBeVisible();
  await expectNoAxeViolations(admin);
  await admin.context().close();
});
