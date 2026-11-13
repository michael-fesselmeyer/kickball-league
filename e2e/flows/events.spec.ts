import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";

/**
 * An admin posts an event with one spot. The player takes it, the captain
 * joins the waitlist, and when the player drops out the captain moves up.
 */
test("players RSVP, a full event has a waitlist, and a dropped spot moves the line up", async ({
  browser,
}) => {
  const admin = await pageAs(browser, "Admin");
  await admin.goto("/app/admin/events/new");
  await admin.getByLabel("Kind").selectOption({ label: "Bar night" });
  await admin.getByLabel("Name").fill("Trivia night");
  await admin.getByLabel("Place").fill("Quiz Hall (demo venue), 1 Example St");
  await admin.getByLabel("Date", { exact: true }).fill("2027-03-05");
  await admin.getByLabel("Starts at").fill("19:00");
  await admin.getByLabel("Ends at").fill("21:30");
  await admin.getByLabel("Capacity (optional)").fill("1");
  await admin
    .getByLabel("Description")
    .fill("Teams of four, no phones. Prizes for first and last.");
  await expectNoAxeViolations(admin);
  await admin.getByRole("button", { name: "Create event" }).click();
  await expect(admin.getByRole("status")).toHaveText(
    "Event created. It's on the events page now.",
  );
  const rsvpPage = "/app/events/trivia-night-2027-03-05";

  // The public page shows it at once.
  await admin.goto("/events/trivia-night-2027-03-05");
  await expect(admin.getByText("1 of 1 spots left.")).toBeVisible();

  const player = await pageAs(browser, "Player");
  await player.goto(rsvpPage);
  await player.getByRole("button", { name: "I'm going" }).click();
  await expect(player.getByRole("status")).toHaveText(
    "You're going. See you there!",
  );
  await expectNoAxeViolations(player);

  const captain = await pageAs(browser, "Captain");
  await captain.goto(rsvpPage);
  await captain.getByRole("button", { name: "Join the waitlist" }).click();
  await expect(
    captain.getByText("You're number 1 on the waitlist."),
  ).toBeVisible();

  await player.getByRole("button", { name: "I can't make it" }).click();
  await expect(player.getByRole("status")).toHaveText(
    "Done. Your RSVP is cleared.",
  );

  await captain.reload();
  await expect(captain.getByText("You're going.")).toBeVisible();

  await admin.goto("/app/admin/events/trivia-night-2027-03-05");
  await expect(
    admin.getByRole("heading", { name: "Who's coming (1 of 1)" }),
  ).toBeVisible();
  await expectNoAxeViolations(admin);
});

test("an admin's theme week shows on the schedule", async ({ browser }) => {
  const admin = await pageAs(browser, "Admin");
  await admin.goto("/app/admin/events/new");
  await admin.getByLabel("Kind").selectOption({ label: "Theme week" });
  await expect(admin.getByLabel("Starts at")).toBeHidden();
  await admin.getByLabel("Name").fill("Pajama week");
  await admin.getByLabel("First day").fill("2026-10-12");
  await admin.getByLabel("Last day").fill("2026-10-18");
  await admin.getByRole("button", { name: "Create event" }).click();
  await expect(admin.getByRole("status")).toContainText("Event created.");

  // A team's view: the smoke tests open the full schedule on another server
  // that shares this build's page cache, and could write back an older copy.
  await admin.goto("/seasons/fall-2026/schedule?team=sun-kickers");
  await expect(
    admin.getByRole("link", { name: "Theme week: Pajama week" }),
  ).toHaveAttribute("href", "/events/pajama-week-2026-10-12");
});
