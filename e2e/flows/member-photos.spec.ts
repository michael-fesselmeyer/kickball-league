import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";

/** Players mostly share photos from their phones. */
const PHONE = { width: 390, height: 844 };

/** A generated test image, with a made-up camera tag that must not survive. */
async function testPhoto() {
  return sharp({
    create: {
      width: 1600,
      height: 1200,
      channels: 3,
      background: "#2f6f3e",
      noise: { type: "gaussian", mean: 120, sigma: 25 },
    },
  })
    .jpeg({ quality: 90 })
    .withExif({ IFD0: { Make: "ExamplePhone" } })
    .toBuffer();
}

/**
 * Pat Player shares a photo of The Big Kicks with the league's OK to repost
 * it, Addie Admin approves it from the review queue, and a visitor sees it
 * on the team page (ADR 0035).
 */
test("a player shares a photo, an admin approves it, and it shows on the team page", async ({
  browser,
}) => {
  // Two people sign in and four screens are scanned.
  test.slow();
  const caption = `Sliding into first ${Date.now().toString(36)}`;

  const player = await pageAs(browser, "Player");
  await player.setViewportSize(PHONE);
  await player.getByRole("link", { name: "Share a photo" }).click();
  await expect(
    player.getByRole("heading", { name: "Share a photo" }),
  ).toBeVisible();
  await expectNoAxeViolations(player);

  await player.getByLabel("Photo", { exact: true }).setInputFiles({
    name: "IMG_0042.jpg",
    mimeType: "image/jpeg",
    buffer: await testPhoto(),
  });
  await expect(player.getByAltText("What you chose to upload")).toBeVisible();
  await player.getByLabel("Team").selectOption({ label: "The Big Kicks" });
  await player.getByLabel("Caption (optional)", { exact: true }).fill(caption);

  // The repost OK is required.
  await player.getByRole("button", { name: "Send to the league" }).click();
  await expect(player.getByText(/^Thanks!/)).toHaveCount(0);
  await player.getByLabel(/The league may repost this on its socials/).check();
  await player.getByRole("button", { name: "Send to the league" }).click();
  await expect(
    player.getByRole("status").filter({ hasText: "Thanks!" }),
  ).toBeVisible();
  const mine = player
    .getByRole("region", { name: "Your photos" })
    .getByRole("listitem")
    .filter({ has: player.getByAltText(caption) });
  await expect(mine).toContainText("Waiting for review");
  await expectNoAxeViolations(player);

  const admin = await pageAs(browser, "Admin");
  await admin.setViewportSize(PHONE);
  await admin.goto("/app/admin/photos");
  const queued = admin
    .getByRole("region", { name: /Waiting for review/ })
    .getByRole("listitem")
    .filter({ hasText: caption });
  await expect(queued).toContainText("The Big Kicks");
  await expectNoAxeViolations(admin);

  // The stored copy is the shrunk JPEG, without the camera's tags.
  const download = admin.waitForEvent("download");
  await queued.getByRole("link", { name: "Download this photo" }).click();
  const saved = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of saved) chunks.push(Buffer.from(chunk));
  const meta = await sharp(Buffer.concat(chunks)).metadata();
  expect([meta.format, meta.width, meta.height, meta.exif]).toEqual([
    "jpeg",
    1440,
    1080,
    undefined,
  ]);

  await queued.getByRole("button", { name: "Approve" }).click();
  await expect(
    admin.getByRole("status").filter({ hasText: "Approved." }),
  ).toBeVisible();

  await player.reload();
  await expect(mine).toContainText("Up on the site");

  // A visitor, signed out, on the static team page. The visit right after a
  // change may still get the cached page while the fresh one renders
  // (docs/architecture.md, section 17).
  const visitor = await (await browser.newContext()).newPage();
  await visitor.setViewportSize(PHONE);
  const photos = visitor.getByRole("region", { name: "Photos from players" });
  await expect
    .poll(async () => {
      await visitor.goto("/teams/the-big-kicks");
      return photos.getByText(caption).count();
    })
    .toBe(1);
  const image = photos
    .getByRole("listitem")
    .filter({ hasText: caption })
    .locator("img");
  await expect(image).toHaveAttribute(
    "src",
    /^\/_next\/image\?url=%2Fmedia%2Fphotos%2F/,
  );
  await expectNoAxeViolations(visitor);

  for (const page of [player, admin, visitor]) await page.context().close();
});
