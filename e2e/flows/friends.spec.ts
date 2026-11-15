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

/**
 * A club one of our players runs: the seed features Sunday Sketch Club, so
 * it heads the directory under "Run by our players" and has a card on the
 * events page. Following its link pings the click counter (the link still
 * goes straight to the club's site), and the admin sees the count.
 */
test("a featured player-run club is promoted and its clicks are counted", async ({
  browser,
}) => {
  const CLUB = "Sunday Sketch Club";
  const CLUB_SITE = "https://sunday-sketch-club.example.test/";
  const visitor = await (await browser.newContext()).newPage();
  // The club's site is invented; answer for it so the visit can finish.
  await visitor.route(`${CLUB_SITE}**`, (route) =>
    route.fulfill({ contentType: "text/html", body: "<title>Club</title>" }),
  );

  await visitor.goto("/friends");
  const players = visitor.getByRole("region", { name: "Run by our players" });
  await expect(players).toContainText(CLUB);
  await expectNoAxeViolations(visitor);

  await visitor.goto("/events");
  const clubs = visitor.getByRole("region", { name: "Run by our players" });
  const link = clubs.getByRole("link", { name: /sunday-sketch-club/ });
  await expect(link).toHaveAttribute("href", CLUB_SITE);
  await expect(link).toHaveAttribute(
    "ping",
    /^\/api\/friends\/[0-9a-f-]{36}\/click$/,
  );
  await expectNoAxeViolations(visitor);
  const ping = visitor.waitForRequest(
    (r) => r.method() === "POST" && /\/api\/friends\/.+\/click$/.test(r.url()),
  );
  await link.click();
  await ping;
  await visitor.waitForURL(CLUB_SITE);
  await visitor.context().close();

  // The page has left by the time the ping answers, so the browser doesn't
  // report its response; the admin's count shows it arrived.
  const admin = await pageAs(browser, "Admin");
  const row = admin.getByRole("row").filter({ hasText: CLUB });
  await expect(async () => {
    await admin.goto("/app/admin/friends");
    await expect(row).toContainText(/[1-9]\d* in 30 days/, { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  await expect(row).toContainText("Run by our players");
  await expectNoAxeViolations(admin);
  await admin.context().close();
});
