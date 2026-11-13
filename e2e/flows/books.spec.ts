import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";
import { download } from "../support/seed-data";

/**
 * The owners' books and the permit at the field (ADR 0034), at phone
 * width. On the flows server the demo admin is the platform operator
 * (playwright.config.ts), who sees what the owners see. The seed puts the
 * current season's games on a sample permit with a document
 * (src/seed/books.ts).
 */
test.use({ viewport: { width: 390, height: 844 } });

test("an owner adds an expense with a receipt photo, reads the ledger and downloads it", async ({
  browser,
}) => {
  const page = await pageAs(browser, "Admin");
  await page.goto("/app/admin");
  await page.getByRole("link", { name: "Books", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Books:");
  // The demo's games and its sample permit are in the fall season.
  await page.getByText("Other seasons", { exact: true }).click();
  await page.getByRole("link", { name: "Fall 2026" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Books: Fall 2026",
  );
  await expectNoAxeViolations(page);
  // The page navigated from stays mounted, hidden; work in the shown one.
  const main = page.getByRole("main");

  // A camera-sized photo; the page shrinks it before it is sent.
  const photo = await sharp({
    create: { width: 3024, height: 4032, channels: 3, background: "#e8d9b0" },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
  await main.getByLabel("Amount in dollars").fill("45.50");
  await main.getByLabel("Category").selectOption({ label: "Equipment" });
  await main.getByLabel("Note").fill("Cones and a measuring wheel");
  await main.getByLabel("Receipt photo (optional)").setInputFiles({
    name: "receipt.jpg",
    mimeType: "image/jpeg",
    buffer: photo,
  });
  await expect(main.getByText("Photo ready.")).toBeVisible();
  await main.getByRole("button", { name: "Add expense" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Expense added." }),
  ).toBeVisible();

  const row = page
    .getByRole("listitem")
    .filter({ hasText: "Cones and a measuring wheel" });
  await expect(row).toContainText("Equipment · $45.50");
  const receipt = row.getByRole("link", { name: /^Receipt/ });
  const file = await page.request.get(
    (await receipt.getAttribute("href")) ?? "",
  );
  expect(file.headers()["content-type"]).toBe("image/webp");
  expect(file.headers()["cache-control"]).toBe("private, no-store");
  const stored = await sharp(await file.body()).metadata();
  expect(Math.max(stored.width ?? 0, stored.height ?? 0)).toBeLessThanOrEqual(
    1600,
  );

  const ledger = page.getByRole("table", { name: /Money in, money out/ });
  await expect(
    ledger.getByRole("row", { name: /^Fields and permits/ }),
  ).toContainText("Includes $1,800.00 of permit costs");
  await expectNoAxeViolations(page);

  const csv = await download(page.getByRole("link", { name: "Download CSV" }));
  expect(csv.name).toMatch(/-books\.csv$/);
  expect(csv.text).toContain(
    "Expense,Equipment,Cones and a measuring wheel,-45.5,yes",
  );
  expect(csv.text).toContain("Permit SAMPLE-0042");

  await page.getByRole("link", { name: "Permits and insurance" }).click();
  await expect(
    page.getByRole("article", { name: "Permit SAMPLE-0042" }),
  ).toContainText("$1,800.00");
  await expect(
    page.getByRole("heading", { name: "What to request" }),
  ).toBeVisible();
  await expect(
    page.getByRole("table", { name: /Field bookings to request/ }),
  ).toBeVisible();
  await expectNoAxeViolations(page);
  await page.context().close();
});

test("someone without the books right finds nothing there", async ({
  browser,
}) => {
  // Admins are kept out the same way (src/db/queries/books.db.test.ts); on
  // this server the demo admin is the operator, so a captain stands in.
  const page = await pageAs(browser, "Captain");
  await page.goto("/app/books");
  await expect(
    page.getByRole("heading", { name: "This page could not be found." }),
  ).toBeVisible();
  const file = await page.request.get(
    "/app/books/files/00000000-0000-4000-8000-000000000000",
  );
  expect(file.status()).toBe(404);
  await page.context().close();
});

test("a ref sees the park permit on the game's page", async ({ browser }) => {
  const page = await pageAs(browser, "Ref");
  await page
    .getByRole("region", { name: "Games you're refereeing" })
    .getByRole("link", { name: "Score" })
    .first()
    .click();
  await page.getByRole("link", { name: "Park permit for this game" }).click();
  await expect(
    page.getByRole("heading", { name: "Park permit" }),
  ).toBeVisible();
  await expect(page.getByText("SAMPLE-0042")).toBeVisible();
  const image = page.getByRole("img", { name: /park permit SAMPLE-0042/ });
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await expectNoAxeViolations(page);
  await page.context().close();
});
