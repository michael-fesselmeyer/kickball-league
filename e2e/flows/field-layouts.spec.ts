import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";

/**
 * Field layouts (#403), at phone width: an admin gives every field a layout
 * and note, and the ref finds it on the game's permit page and the admin on
 * the command center.
 */
test.use({ viewport: { width: 390, height: 844 } });

test("an admin adds a layout, and the ref sees it with the permit", async ({
  browser,
}) => {
  // One upload per seeded field.
  test.slow();
  const admin = await pageAs(browser, "Admin");
  await admin.goto("/app/admin/seasons/fall-2026/fields");
  const layouts = admin.getByRole("region", { name: "Field layouts" });
  await expect(layouts).toBeVisible();
  const picture = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: "#9ad17a" },
  })
    .png()
    .toBuffer();
  // The seed's fields; each gets the same layout.
  const count = await layouts.getByRole("listitem").count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const item = layouts.getByRole("listitem").nth(i);
    await item
      .getByLabel(/Layout \(photo or PDF\)|Replace the layout/)
      .setInputFiles({
        name: "layout.png",
        mimeType: "image/png",
        buffer: picture,
      });
    await item.getByLabel("Note").fill("Cones at the four corners");
    await item.getByLabel("This field needs no layout").uncheck();
    await item.getByRole("button", { name: /Save layout/ }).click();
    await expect(admin.getByRole("status")).toHaveText("Layout saved.");
    // The notice can still be the last save's while the page reloads: wait for
    // this field's own row to show the layout before the next one.
    await expect(item.getByText("A layout is on file.")).toBeVisible();
  }
  await expect(
    admin
      .getByRole("region", { name: "Field layouts" })
      .getByText("A layout is on file.")
      .first(),
  ).toBeVisible();
  await expectNoAxeViolations(admin);
  await admin.context().close();

  const ref = await pageAs(browser, "Ref");
  await ref
    .getByRole("region", { name: "Games you're refereeing" })
    .getByRole("link", { name: "Score", exact: true })
    .first()
    .click();
  await ref.getByRole("link", { name: "Park permit for this game" }).click();
  const section = ref.getByRole("region", { name: "Field layout" });
  await expect(section).toContainText("Cones at the four corners");
  const image = section.getByRole("img", { name: /Layout of/ });
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await expectNoAxeViolations(ref);
  await ref.context().close();
});

test("a player can't open a field's layout page", async ({ browser }) => {
  const page = await pageAs(browser, "Player");
  // The lookup runs inside a Suspense boundary, so the status is already
  // sent: check the page instead.
  await page.goto("/app/fields/00000000-0000-4000-8000-000000000000/layout");
  await expect(
    page.getByRole("heading", { name: "We can't find that page" }),
  ).toBeVisible();
  await page.context().close();
});
