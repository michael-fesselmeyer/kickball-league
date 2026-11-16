import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";

/**
 * Quick polls for captains, at phone width: an admin asks a question, the
 * demo captain votes for their team and changes the vote, sees the totals
 * once they have voted, and the admin sees them live and closes the poll.
 */
test.use({ viewport: { width: 390, height: 844 } });

test("an admin asks the captains a question and a captain answers for their team", async ({
  browser,
}) => {
  const admin = await pageAs(browser, "Admin");
  await admin.goto("/app/admin/seasons/fall-2026/captain-polls");
  await expect(admin.getByRole("heading", { level: 1 })).toHaveText(
    "Captains' polls",
  );
  await admin.getByLabel("Question", { exact: true }).fill("Playoff innings?");
  await admin.getByLabel("Option 1").fill("Five");
  await admin.getByLabel("Option 2").fill("Seven");
  await admin.getByRole("button", { name: "Open the poll" }).click();
  await expect(admin.getByRole("status")).toContainText("Poll opened");
  await expectNoAxeViolations(admin);

  const captain = await pageAs(browser, "Captain");
  await captain.goto("/app");
  await captain
    .getByRole("link", { name: /^Captains' poll waiting for your vote/ })
    .click();
  await expect(captain).toHaveURL(/\/app\/polls$/);
  const card = captain.getByRole("listitem").filter({
    has: captain.getByRole("heading", { name: "Playoff innings?" }),
  });
  await expect(card).toContainText("Results show once your team has voted.");
  await expectNoAxeViolations(captain);

  await card.getByLabel("Five").check();
  await card.getByRole("button", { name: "Cast vote" }).click();
  await expect(captain).toHaveURL(/\/app\/polls\?voted=/);
  await expect(card.getByRole("status")).toContainText("voted: Five");
  await expect(
    card.getByRole("list", { name: "Results so far" }),
  ).toContainText("Five1 vote");

  // Changing the vote replaces it.
  await card.getByLabel("Seven").check();
  await card.getByRole("button", { name: "Change vote" }).click();
  await expect(card.getByRole("status")).toContainText("voted: Seven");
  await expectNoAxeViolations(captain);
  await captain.context().close();

  await admin.reload();
  const row = admin
    .getByRole("listitem")
    .filter({ hasText: "Playoff innings?" });
  await expect(row).toContainText("1 of");
  await row.getByRole("button", { name: "Close voting now" }).click();
  await expect(admin.getByRole("status")).toContainText("Voting closed");
  await expectNoAxeViolations(admin);
});
