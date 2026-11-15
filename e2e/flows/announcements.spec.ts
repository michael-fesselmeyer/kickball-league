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
  // Scheduled announcements have edit forms of their own further down.
  const write = admin.getByRole("region", { name: "Write an announcement" });
  await write.getByLabel("Send to").selectOption({ label: "Sun Kickers" });
  await write.getByLabel("Subject").fill("Field 2 is closed this week");
  await write
    .getByLabel("Message")
    .fill("Your game moves to Field 3, same time.");
  await write.getByRole("button", { name: "Send announcement" }).click();
  await expect(
    admin.getByRole("status").filter({ hasText: "Sent to" }),
  ).toHaveText(/^Sent to \d+ people\./);
  await expect(
    admin.getByText("Field 2 is closed this week", { exact: true }),
  ).toBeVisible();
  await expectNoAxeViolations(admin);
  await admin.context().close();
});

/**
 * An admin schedules an announcement for the next morning send, sees it
 * waiting with its send time, edits it, and cancels it before it goes.
 */
test("an admin schedules an announcement, edits it and cancels it", async ({
  browser,
}) => {
  const admin = await pageAs(browser, "Admin");
  await admin.goto("/app/admin/seasons/fall-2026/announcements");
  const write = admin.getByRole("region", { name: "Write an announcement" });
  await expect(
    write.getByText("Scheduled messages go out once a day", { exact: false }),
  ).toBeVisible();
  await write.getByLabel("Subject").fill("Team photos next week");
  await write.getByLabel("Message").fill("Wear your shirts.");
  await write
    .getByRole("radio", { name: /^At the next morning send \(/ })
    .check();
  await write.getByRole("button", { name: "Send announcement" }).click();
  await expect(admin.getByRole("status").first()).toContainText("Scheduled.");

  const scheduled = admin.getByRole("region", { name: "Scheduled" });
  const item = scheduled
    .getByRole("listitem")
    .filter({ hasText: "Team photos next week" });
  await expect(item).toContainText(/sends \w{3}, \w{3} \d+, \d+:\d{2} [AP]M/);
  await expect(
    item.getByRole("button", {
      name: /^Copy for WhatsApp\W+Team photos next week$/,
    }),
  ).toBeVisible();
  await expectNoAxeViolations(admin);

  await item.locator("summary").click();
  await item.getByLabel("Subject").fill("Team photos on Thursday");
  await item.getByRole("button", { name: "Save changes" }).click();
  await expect(admin.getByRole("status").first()).toHaveText(
    "Saved the changes to the scheduled announcement.",
  );
  const edited = scheduled
    .getByRole("listitem")
    .filter({ hasText: "Team photos on Thursday" });
  await edited
    .getByRole("button", { name: /^Cancel it\W+Team photos on Thursday$/ })
    .click();
  await expect(admin.getByRole("status").first()).toHaveText(
    "Cancelled. It won't be sent.",
  );
  await expect(edited).toHaveCount(0);

  await expect(
    admin.getByRole("region", { name: "Game days for the group chat" }),
  ).toBeVisible();
  await admin.context().close();
});
