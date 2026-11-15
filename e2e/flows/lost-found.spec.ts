import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";

/** Players mostly use the board from their phones. */
const PHONE = { width: 390, height: 844 };

/**
 * Pat Player posts a found item, Cass Captain says it's hers and they talk
 * in the app, Pat hands it over, and the post closes (issue #385).
 */
test("a player posts a found item, the owner answers, and it is handed over", async ({
  browser,
}) => {
  // Two people sign in and several screens are scanned.
  test.slow();
  const item = `Blue water bottle ${Date.now().toString(36)}`;

  const finder = await pageAs(browser, "Player");
  await finder.setViewportSize(PHONE);
  await finder.getByRole("link", { name: "Lost and found" }).click();
  await expect(
    finder.getByRole("heading", { name: "Lost and found", level: 1 }),
  ).toBeVisible();
  await expectNoAxeViolations(finder);

  await finder.getByRole("link", { name: "I found something" }).click();
  await finder.getByLabel("What is it?").fill(item);
  await finder.getByLabel("Where is it now?").fill("In my gear bag");
  await expectNoAxeViolations(finder);
  await finder.getByRole("button", { name: "Post it" }).click();
  await expect(finder.getByRole("heading", { name: item })).toBeVisible();
  await expect(finder.getByText("Posted.")).toBeVisible();

  const owner = await pageAs(browser, "Captain");
  await owner.setViewportSize(PHONE);
  await owner.goto("/app/lost-and-found");
  const listed = owner.getByRole("listitem").filter({ hasText: item });
  await expect(listed).toContainText("days left");
  await listed.getByRole("link", { name: item }).click();
  await owner.getByLabel(/Say why it's yours/).fill("Mine, it has a dent");
  await expectNoAxeViolations(owner);
  await owner.getByRole("button", { name: "That's mine" }).click();
  await expect(owner.getByRole("status").first()).toContainText(
    "Nobody's contact details",
  );
  // No address or phone number anywhere on the screen.
  await expect(owner.locator("main")).not.toContainText(/@|\d{3}-\d{4}/);

  // The finder sees the answer and replies.
  await finder.reload();
  const conversation = finder.getByRole("article");
  await expect(conversation).toContainText("Mine, it has a dent");
  await conversation
    .getByLabel("Write back")
    .fill("Great, at the bar Thursday?");
  await conversation.getByRole("button", { name: "Send" }).click();
  await expect(finder.getByText("Message sent.")).toBeVisible();
  await expectNoAxeViolations(finder);

  await owner.reload();
  await expect(owner.getByRole("article")).toContainText(
    "Great, at the bar Thursday?",
  );

  await finder.getByRole("button", { name: /Mark as handed over to/ }).click();
  await expect(finder.getByText(/Marked as handed over/)).toBeVisible();
  await finder.goto("/app/lost-and-found");
  await expect(finder.getByText(item)).toHaveCount(0);
});

test("a finder can't answer their own post, and an admin can take a post down", async ({
  browser,
}) => {
  const lost = `Grey hoodie ${Date.now().toString(36)}`;
  const member = await pageAs(browser, "Player");
  await member.setViewportSize(PHONE);
  await member.goto("/app/lost-and-found/new?kind=lost");
  await member.getByLabel("What is it?").fill(lost);
  await member.getByRole("button", { name: "Post it" }).click();
  await expect(member.getByRole("heading", { name: lost })).toBeVisible();
  // Their own post offers no "I found it", only closing it.
  await expect(member.getByRole("button", { name: "I found it" })).toHaveCount(
    0,
  );
  await expect(
    member.getByRole("button", { name: "Close this post" }),
  ).toBeVisible();

  const admin = await pageAs(browser, "Admin");
  await admin.setViewportSize(PHONE);
  await admin.goto("/app/lost-and-found");
  await admin.getByRole("link", { name: lost }).click();
  await admin.getByRole("button", { name: /Take this post down/ }).click();
  await expect(admin.getByText("Post taken down.")).toBeVisible();
  await expect(admin.getByText(lost)).toHaveCount(0);
});
