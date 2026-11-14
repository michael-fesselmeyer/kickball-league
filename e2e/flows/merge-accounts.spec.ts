import { expect, test } from "@playwright/test";
import { duplicateAccounts } from "../support/accounts";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";

/**
 * A player signed up twice. An admin previews merging the extra account
 * into the one they use, sees what moves and how the clash is settled, and
 * merges; the old address is then another name for the kept account.
 */
test("an admin previews and merges a duplicate account", async ({
  browser,
}) => {
  const { keep, merge } = await duplicateAccounts();
  const page = await pageAs(browser, "Admin");
  await page.goto("/app/admin/accounts");
  await expectNoAxeViolations(page);

  await page.getByLabel("Email of the account to keep").fill(keep);
  await page.getByLabel("Email of the account to merge away").fill(merge);
  await page.getByRole("button", { name: "Preview the merge" }).click();
  await expect(page).toHaveURL(/keep=[0-9a-f-]{36}&merge=[0-9a-f-]{36}/);
  // No address in the URL.
  expect(page.url()).not.toContain("seed.example");

  const preview = page.getByRole("region", { name: "Preview" });
  await expect(preview).toContainText(keep);
  await expect(preview).toContainText(merge);
  await expect(preview).toContainText("league credit");
  await expect(preview).toContainText(
    "Both chose a setting for the same notice; the kept account's stays",
  );
  await expectNoAxeViolations(page);

  // Without the tick, nothing happens.
  const confirm = preview.getByRole("button", { name: /^Merge into / });
  await confirm.click();
  await expect(page.getByRole("alert")).toContainText(
    "Tick the box to say both accounts are the same person.",
  );

  await preview
    .getByRole("checkbox", { name: /both accounts belong to the same person/ })
    .check();
  await preview.getByRole("button", { name: /^Merge into / }).click();
  await expect(page.getByRole("status")).toContainText(
    `Everything now belongs to Robin Example (${keep}).`,
  );
  await expect(
    page.getByRole("region", { name: "Recent merges" }),
  ).toContainText(`${merge} → ${keep}`);
  await expectNoAxeViolations(page);

  // The old address now finds the kept account, so it can't be merged again.
  await page.getByLabel("Email of the account to keep").fill(keep);
  await page.getByLabel("Email of the account to merge away").fill(merge);
  await page.getByRole("button", { name: "Preview the merge" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "No account has the address to merge away, or it was already merged.",
  );
  await page.context().close();
});
