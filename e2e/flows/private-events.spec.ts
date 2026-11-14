import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";
import { pageSignedInAs } from "../support/sign-in";

/**
 * A private tournament (ADR 0049), at phone width: a player asks for one
 * from the public booking page, an admin sets it up as a private season,
 * the organizer finds the invite link, and a captain who follows it lands
 * on the private season's registration. The season stays off public pages.
 * The organizer and the captain are made up for this flow and sign in by
 * email, so flows switching the shared demo personas can't swap them.
 */
test.use({ viewport: { width: 390, height: 844 } });

test("an organizer books a private tournament and invites a team", async ({
  browser,
}) => {
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const organization = `Example Widgets ${tag}`;

  // The organizer asks, from the public page.
  const organizer = await pageSignedInAs(
    browser,
    `organizer.${tag}@example.test`,
  );
  await organizer.goto("/private-events");
  await expect(organizer.getByRole("heading", { level: 1 })).toHaveText(
    "Book a private league or tournament",
  );
  await expectNoAxeViolations(organizer);
  await organizer
    .getByRole("link", { name: "Request a booking" })
    .first()
    .click();
  await expect(organizer.getByRole("heading", { level: 1 })).toHaveText(
    "Request a booking",
  );
  await organizer.getByLabel("A one-day tournament").check();
  await organizer.getByLabel(/Who it's for/).fill(organization);
  await organizer.getByLabel("How many teams").fill("4");
  await organizer.getByLabel(/^When/).fill("A Saturday in May");
  await expectNoAxeViolations(organizer);
  await organizer.getByRole("button", { name: "Send the request" }).click();
  await expect(
    organizer.getByRole("status").filter({ hasText: "Request sent." }),
  ).toBeVisible();
  await expect(
    organizer.getByRole("listitem").filter({ hasText: organization }),
  ).toContainText("Waiting for the league");
  await expectNoAxeViolations(organizer);

  // An admin accepts it as a private season the organization pays for.
  const admin = await pageAs(browser, "Admin");
  await admin.goto("/app/admin/private-events");
  const request = admin.getByRole("article", { name: organization });
  await expect(request).toContainText("Tournament, 4 teams");
  await expectNoAxeViolations(admin);
  await request.locator("summary").filter({ hasText: "Accept" }).click();
  await request.getByLabel("First day").fill("2027-05-08");
  await request.getByLabel(/^Amount in dollars/).fill("0");
  await request
    .getByRole("button", { name: "Set up the private season" })
    .click();
  await expect(admin.getByRole("heading", { level: 1 })).toHaveText(
    `${organization} Tournament`,
  );
  await admin.context().close();

  // The organizer's page has the invite link; nothing to pay.
  await organizer.goto("/app/private-events");
  await organizer
    .getByRole("listitem")
    .filter({ hasText: organization })
    .getByRole("link", { name: /^Open the organizer page/ })
    .click();
  await expect(organizer.getByText("Nothing to pay")).toBeVisible();
  const invite = await organizer.getByLabel("Invite link").inputValue();
  expect(invite).toMatch(/\/app\/private-events\/join\/[A-Za-z0-9_-]{24}$/);
  await expectNoAxeViolations(organizer);
  const slug = /\/app\/private-events\/([^/?#]+)/.exec(organizer.url())?.[1];
  expect(slug).toMatch(/^private-/);

  // Nobody else can open the organizer page, and the season is not public.
  const captain = await pageSignedInAs(browser, `captain.${tag}@example.test`);
  await captain.goto(`/app/private-events/${slug}`);
  await expect(
    captain.getByRole("heading", { name: "This page could not be found." }),
  ).toBeVisible();
  const standings = await captain.request.get(`/seasons/${slug}/standings`);
  expect(standings.status()).toBe(404);
  const sitemap = await (await captain.request.get("/sitemap.xml")).text();
  expect(sitemap).not.toContain(slug);

  // Without the invite the registration is hidden; the link opens it.
  await captain.goto(`/app/seasons/${slug}/register`);
  await expect(
    captain.getByRole("heading", { name: "This page could not be found." }),
  ).toBeVisible();
  await captain.goto(new URL(invite).pathname);
  await expect(captain).toHaveURL(new RegExp(`/app/seasons/${slug}/register`));
  await expect(captain.getByRole("heading", { level: 1 })).toHaveText(
    "Register",
  );
  await expect(captain.getByText("Or join on your own")).toHaveCount(0);
  await expectNoAxeViolations(captain);

  await captain.context().close();
  await organizer.context().close();
});
