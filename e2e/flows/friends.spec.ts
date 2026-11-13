import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";

const NAME = "Southside Sand Volleyball";
const SITE = "https://sand-volleyball.example.test/";

/**
 * An admin adds a league to the friends directory: a plain http link is
 * refused, then the https one is saved with a logo. A visitor who isn't
 * signed in finds it on the public page under its activity, with an
 * outbound link, its logo and the league's link-to-us snippet.
 */
test("an admin adds a friend league and a visitor sees it", async ({
  browser,
}) => {
  const admin = await pageAs(browser, "Admin");
  await admin.goto("/app/admin/friends");
  await expect(
    admin.getByRole("heading", { level: 1, name: "Friends of the league" }),
  ).toBeVisible();
  await expect(
    admin.getByRole("link", { name: "Greenpoint Slow-Pitch Social" }),
  ).toBeVisible();
  await expectNoAxeViolations(admin);

  await admin.getByRole("link", { name: "Add a league" }).click();
  await admin.getByLabel("League name").fill(NAME);
  await admin.getByLabel("Sport or activity").selectOption("Volleyball");
  await admin.getByLabel("Neighborhood or park").fill("Domino Park");
  await admin
    .getByLabel("Short description")
    .fill("Doubles on the sand, Thursday nights all summer.");
  await admin.getByLabel("Website").fill("http://sand-volleyball.example.test");
  await admin.getByLabel("They link back to us").check();
  await admin.getByRole("button", { name: "Add to the directory" }).click();
  await expect(
    admin.getByRole("alert").filter({ hasText: "plain http" }),
  ).toBeVisible();
  await expectNoAxeViolations(admin);

  const logo = await sharp({
    create: { width: 400, height: 200, channels: 3, background: "#e85d04" },
  })
    .png()
    .toBuffer();
  await admin.getByLabel("Website").fill(SITE);
  await admin
    .getByLabel("Logo")
    .setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: logo });
  await admin.getByRole("button", { name: "Add to the directory" }).click();
  await expect(admin.getByRole("status")).toHaveText(
    "League added. It's on the public page now.",
  );
  await expect(admin.getByRole("row").filter({ hasText: NAME })).toContainText(
    "Yes",
  );

  await admin.getByRole("link", { name: NAME }).click();
  await expect(admin.getByRole("heading", { level: 1 })).toHaveText(NAME);
  await expect(admin.getByRole("img", { name: `${NAME} logo` })).toBeVisible();
  await expectNoAxeViolations(admin);
  // getByRole skips the add form, which the router keeps hidden on the page.
  await admin
    .getByRole("textbox", { name: "Neighborhood or park" })
    .fill("Domino Park, Williamsburg");
  await admin.getByRole("button", { name: "Save changes" }).click();
  await expect(admin.getByRole("status")).toHaveText("Changes saved.");
  await admin.context().close();

  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto("/");
  await visitor
    .getByRole("contentinfo")
    .getByRole("link", { name: "Friends" })
    .click();
  await expect(visitor).toHaveURL(/\/friends$/);
  const group = visitor.getByRole("region", { name: "Volleyball" });
  const card = group.getByRole("listitem").filter({ hasText: NAME });
  await expect(card).toContainText("Domino Park, Williamsburg");
  await expect(card).toContainText("Links to us");
  const link = card.getByRole("link", {
    name: /sand-volleyball\.example\.test/,
  });
  await expect(link).toHaveAttribute("href", SITE);
  await expect(link).toHaveAttribute("rel", "noopener");
  await expect(link).toContainText("(another site)");
  // The logo loads lazily, once it scrolls into view.
  const img = card.locator("img");
  await img.scrollIntoViewIfNeeded();
  await expect
    .poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth))
    .toBe(192);
  // The seeded leagues are grouped under their own activities.
  await expect(visitor.getByRole("region", { name: "Softball" })).toContainText(
    "Greenpoint Slow-Pitch Social",
  );

  const snippet = visitor.getByLabel("Paste this into your site's HTML");
  await expect(snippet).toHaveValue(/^<a href="http[^"]+">[^<]+<\/a>$/);
  const structured = await visitor
    .locator('script[type="application/ld+json"]')
    .allTextContents();
  expect(structured.join("")).toContain(`"name":"${NAME}"`);
  await expectNoAxeViolations(visitor);
  await visitor.context().close();
});
