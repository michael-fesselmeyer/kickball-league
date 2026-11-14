import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";
import { pageSignedInAs, seasonCardEmail } from "../support/sign-in";

/**
 * "Your season in kickball". The seed has Summer 2026 completed, with its
 * players' cards built and one of them public. An admin refreshes the
 * cards, which tells each player once; a player opens theirs from home,
 * makes its link public, a visitor opens it, and the player makes it
 * private again, after which the link no longer works.
 */
test("a player shares their season card and takes it back", async ({
  browser,
}) => {
  const admin = await pageAs(browser, "Admin");
  await admin.goto("/app/admin/seasons/summer-2026");
  await admin.getByRole("link", { name: "Season cards" }).click();
  await expect(
    admin.getByRole("heading", { name: "Season cards" }),
  ).toBeVisible();
  await expect(
    admin.getByText(/^\d+ cards, 1 shared by their players\.$/),
  ).toBeVisible();
  await admin.getByRole("button", { name: "Refresh the cards" }).click();
  // Every card is told once: the seed built them without messages.
  await expect(admin.getByRole("status")).toHaveText(
    /^(\d+) cards ready\. \1 players will get a message that theirs is ready\.$/,
  );
  await expectNoAxeViolations(admin);
  await admin.context().close();

  const player = await pageSignedInAs(
    browser,
    await seasonCardEmail("summer-2026"),
  );
  await player
    .getByRole("link", { name: "Your Summer 2026 season in kickball" })
    .click();
  const title = player.getByRole("heading", {
    level: 1,
    name: /'s season in kickball$/,
  });
  await expect(title).toBeVisible();
  await expect(player.getByText("Summer 2026 MVP")).toBeVisible();
  await expect(player.getByText("Only you can see this card.")).toBeVisible();
  await expect(
    player.getByRole("button", { name: /^Copy for WhatsApp/ }),
  ).toBeVisible();
  await expectNoAxeViolations(player);

  await player
    .getByRole("button", { name: "Make my card's link public" })
    .click();
  await expect(player.getByRole("status").first()).toContainText(
    "Your card's link is public.",
  );
  const link = player.getByRole("link", {
    name: /\/seasons\/summer-2026\/card\//,
  });
  const path = new URL((await link.getAttribute("href")) ?? "", player.url())
    .pathname;
  await expectNoAxeViolations(player);

  // A context of its own, signed out, as axe needs.
  const visitor = await (await browser.newContext()).newPage();
  const shown = await visitor.goto(path);
  expect(shown?.status()).toBe(200);
  await expect(
    visitor.getByRole("heading", { level: 1, name: await title.innerText() }),
  ).toBeVisible();
  await expect(
    visitor.getByRole("link", { name: /Share on WhatsApp/ }),
  ).toBeVisible();
  await expectNoAxeViolations(visitor);
  const image = await visitor.request.get(`${path}/share.png`);
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toBe("image/png");

  await player.getByRole("button", { name: "Make my card private" }).click();
  await expect(player.getByRole("status").first()).toContainText(
    "Your card is private again.",
  );
  await player.context().close();

  const gone = await visitor.goto(path);
  expect(gone?.status()).toBe(404);
  expect((await visitor.request.get(`${path}/share.png`)).status()).toBe(404);
  await visitor.context().close();
});
