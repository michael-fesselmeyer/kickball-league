import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";
import { download } from "../support/seed-data";
import {
  openMerchCheckout,
  sendCheckoutCompleted,
} from "../support/stripe-webhook";

/** A CSV file's lines; it opens with a byte-order mark so Excel reads UTF-8. */
function csvLines(text: string): string[] {
  expect(text.startsWith("﻿")).toBe(true);
  return text.slice(1).trimEnd().split("\r\n");
}

/**
 * Merch and replacement jerseys (ADR 0035). An admin adds a replacement
 * jersey made to order and gives Casey Captain some league credit. Casey
 * orders one in their team's color, in the size on their profile, with the
 * credit applied, and pays the rest through Stripe (stripe-mock, with the
 * webhook signed here; a replay changes nothing). The admin sees the order,
 * downloads the printer's CSV and marks it fulfilled, and Casey sees it's
 * ready.
 */
test("a player orders a replacement jersey with credit, and an admin exports and fulfills it", async ({
  browser,
}) => {
  // Two people sign in and several screens get an axe scan.
  test.slow();
  const name = `Replacement jersey ${Date.now().toString(36)}`;
  const captainEmail = "casey.captain@example.test";

  const admin = await pageAs(browser, "Admin");
  await admin.goto("/app/admin");
  await admin.getByRole("link", { name: "Merch", exact: true }).click();
  await expect(admin.getByRole("heading", { name: "Merch" })).toBeVisible();
  await admin.getByRole("link", { name: "New item" }).click();
  await admin.getByLabel("Kind").selectOption({
    label: "Replacement team jersey (in the buyer's team color)",
  });
  await admin.getByLabel("Name").fill(name);
  await admin.getByLabel("Price in dollars").fill("18");
  await admin.getByLabel("Made to order").check();
  await admin.getByRole("checkbox", { name: "M", exact: true }).check();
  await admin.getByRole("checkbox", { name: "L", exact: true }).check();
  await expectNoAxeViolations(admin);
  await admin.getByRole("button", { name: "Add item" }).click();
  await expect(admin.getByRole("status").first()).toHaveText(
    "Item added. It's in the shop now.",
  );
  await expect(admin.getByRole("heading", { name })).toBeVisible();
  const itemPage = admin.url();

  await admin.goto("/app/admin/credit");
  await admin.getByLabel("Player's email").fill(captainEmail);
  await admin.getByLabel("Amount in dollars").fill("5");
  await admin
    .getByLabel("Why (the player sees this)")
    .fill("For a jersey that went missing");
  await admin.getByRole("button", { name: "Give credit" }).click();
  await expect(admin.getByRole("status")).toContainText("Credit given.");

  // Casey orders from the shop: their profile's size is picked already.
  const captain = await pageAs(browser, "Captain");
  await captain.goto("/app");
  await captain.getByRole("link", { name: "League shop" }).click();
  await expect(
    captain.getByRole("heading", { name: "League shop" }),
  ).toBeVisible();
  await expectNoAxeViolations(captain);
  await captain.getByRole("link", { name }).click();
  await expect(captain.getByRole("heading", { name })).toBeVisible();
  await expect(captain.getByRole("radio", { name: "M" })).toBeChecked();
  const team = captain.getByLabel("Team");
  const bigKicks = await team
    .locator("option", { hasText: "The Big Kicks" })
    .getAttribute("value");
  await team.selectOption(bigKicks ?? "missing");
  await expect(captain.getByLabel(/^Use my league credit/)).toBeChecked();
  await expectNoAxeViolations(captain);
  await captain.route("https://checkout.stripe.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Stripe Checkout</title><h1>Checkout</h1>",
    }),
  );
  await captain.getByRole("button", { name: "Order for $18 each" }).click();
  await expect(captain).toHaveURL(/^https:\/\/checkout\.stripe\.com\//);

  // Stripe confirms the card part; a replay changes nothing.
  const session = await openMerchCheckout(captainEmail, name);
  expect(session.creditCents).toBeGreaterThanOrEqual(500);
  expect(session.totalCents).toBe(1800 - session.creditCents);
  const eventId = `evt_e2e_merch_${Date.now()}`;
  expect(
    await sendCheckoutCompleted(captain.request, session, eventId),
  ).toEqual({ status: 200, outcome: "processed" });
  expect(
    await sendCheckoutCompleted(captain.request, session, eventId),
  ).toEqual({ status: 200, outcome: "duplicate" });
  await captain.goto("/app/shop?order=paid");
  await expect(captain.getByRole("status").first()).toHaveText(
    "Thanks! Your order is in. We'll email you when it's ready.",
  );
  const mine = captain
    .getByRole("region", { name: "Your orders" })
    .getByRole("listitem")
    .filter({ hasText: name });
  await expect(mine).toContainText(`${name} (M), The Big Kicks`);
  await expect(mine).toContainText("Ordered");

  // The admin sees the order, downloads the printer's CSV, and fulfills it.
  await admin.goto(itemPage);
  const order = admin
    .getByRole("region", { name: /^Orders to make/ })
    .getByRole("listitem")
    .filter({ hasText: "Casey Captain" });
  await expect(order).toContainText("M × 1");
  await expect(order).toContainText("The Big Kicks");
  await expect(order).toContainText(" card + ");
  await expectNoAxeViolations(admin);

  await admin.goto("/app/admin/merch");
  const csv = await download(
    admin.getByRole("link", { name: "Download orders to make (CSV)" }),
  );
  expect(csv.name).toBe("merch-orders.csv");
  const [header, ...rows] = csvLines(csv.text);
  expect(header).toBe(
    "Item,Size,Quantity,Team,Team color,Name,Email,Paid each,Ordered at,Order",
  );
  const row = rows.find((r) => r.startsWith(`${name},`));
  expect(row).toMatch(
    new RegExp(
      `^${name},M,1,The Big Kicks,[^,]*,Casey Captain,${captainEmail},18\\.00,`,
    ),
  );

  await admin.goto(itemPage);
  await order
    .getByRole("button", { name: "Mark fulfilled for Casey Captain" })
    .click();
  await expect(admin.getByRole("status").first()).toHaveText(
    "1 order marked fulfilled. The buyer gets a note.",
  );
  await expect(
    admin.getByRole("heading", { name: "Orders to make (0)" }),
  ).toBeVisible();
  await expect(
    admin.getByRole("heading", { name: "Fulfilled (1)" }),
  ).toBeVisible();
  await expectNoAxeViolations(admin);

  await captain.goto("/app/shop");
  await expect(mine).toContainText("Ready");

  await admin.goto("/app/admin/audit");
  await expect(
    admin.getByText("Downloaded the merch orders for the printer").first(),
  ).toBeVisible();
  await expect(
    admin.getByText("Marked a merch order fulfilled").first(),
  ).toBeVisible();

  await admin.context().close();
  await captain.context().close();
});
