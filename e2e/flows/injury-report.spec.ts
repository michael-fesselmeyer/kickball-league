import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";

/** The person and game the discipline seed adds (src/seed/discipline.ts). */
const PLAYER = "Dana Fairplay";
const GAME = "Grand Slammers vs Foul Play";

/**
 * Reese Ref reports an injury after a game Reese refs: who was hurt, where,
 * what care it needed and what happened. Addie Admin opens it, downloads
 * the insurance carrier's copy, and deletes the details; the ref can't open
 * the report afterwards or at any time. Each step is its own test in a
 * serial group, as in the discipline flow.
 */
test.describe
  .serial("a ref reports an injury, an admin reads, exports and deletes it", () => {
  let reportUrl = "";

  test("the ref reports the injury from the incident screen", async ({
    browser,
  }) => {
    const ref = await pageAs(browser, "Ref");
    await ref
      .getByRole("listitem")
      .filter({ hasText: GAME })
      .getByRole("link", { name: "Score", exact: true })
      .click();
    await ref.getByRole("link", { name: "Report an incident" }).click();
    await ref
      .getByRole("link", { name: "Someone was hurt? Report an injury" })
      .click();
    await expect(
      ref.getByRole("heading", { name: "Report an injury" }),
    ).toBeVisible();
    await expectNoAxeViolations(ref);
    await ref.getByLabel("Who was hurt").selectOption({ label: "Dana F." });
    await ref
      .getByLabel("Where they were hurt")
      .selectOption({ label: "Knee" });
    await ref
      .getByLabel("What care they needed")
      .selectOption({ label: "First aid at the field" });
    await ref
      .locator("#injury-details")
      .fill("Slid into second base and twisted the knee. Ice from the kit.");
    await ref.getByRole("button", { name: "Send the report" }).click();
    await expect(ref.getByRole("status")).toContainText("Report sent");
    await ref.context().close();
  });

  test("an admin reads it, downloads the carrier's copy and deletes the details", async ({
    browser,
  }) => {
    const admin = await pageAs(browser, "Admin");
    await admin.goto("/app/admin/incidents");
    await admin
      .getByRole("region", { name: /^To review/ })
      .getByRole("link", { name: `Injury: ${GAME}` })
      .first()
      .click();
    await expect(
      admin.getByRole("heading", { name: "Injury", exact: true }),
    ).toBeVisible();
    reportUrl = admin.url();
    const what = admin.getByRole("region", { name: "What happened" });
    await expect(what).toContainText(PLAYER);
    await expect(what).toContainText("Knee");
    await expect(what).toContainText("First aid at the field");
    await expect(what).toContainText("Slid into second base");
    // Not a conduct report: nobody to suspend.
    await expect(
      admin.getByRole("region", { name: "Suspensions" }),
    ).toHaveCount(0);
    await expectNoAxeViolations(admin);

    const carrierCopy = admin.getByRole("link", {
      name: "Download for the insurance carrier",
    });
    const response = await admin.request.get(
      (await carrierCopy.getAttribute("href")) ?? "",
    );
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/csv");
    const csv = await response.text();
    expect(csv).toContain("Body area,Knee");
    expect(csv).toContain("Care given,First aid at the field");
    expect(csv).toContain("Insurance");

    await admin
      .getByRole("button", { name: "Delete the injury details now" })
      .click();
    await expect(admin.getByRole("status")).toContainText(
      "The injury details were deleted.",
    );
    await expect(
      admin.getByText("The injury details were removed."),
    ).toBeVisible();
    await expect(admin.getByText("Slid into second base")).toHaveCount(0);
    await expectNoAxeViolations(admin);
    await admin.context().close();
  });

  test("the ref can't open the report or its download", async ({ browser }) => {
    expect(reportUrl).not.toBe("");
    const ref = await pageAs(browser, "Ref");
    // The page streams, so it is the 404 page's heading that shows.
    await ref.goto(reportUrl);
    await expect(
      ref.getByRole("heading", { name: "We can't find that page" }),
    ).toBeVisible();
    const download = await ref.request.get(`${reportUrl}/injury.csv`);
    expect(download.status()).toBe(404);
    await ref.context().close();
  });
});
