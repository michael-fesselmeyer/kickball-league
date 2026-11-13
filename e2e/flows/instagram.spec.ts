import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";

/**
 * The demo league starts with photos kept from a disconnected Instagram
 * account. An admin connects the recorded fixture (src/services/
 * instagram-fixture.ts, no network), which syncs its posts; features one,
 * which then shows on the home page linking to Instagram; hides it again;
 * and disconnects, keeping the photos.
 */
test("an admin connects Instagram, features a post and disconnects", async ({
  browser,
}) => {
  const page = await pageAs(browser, "Admin");
  await page.goto("/app/admin/instagram");
  await expect(
    page.getByRole("heading", { name: "Instagram photos" }),
  ).toBeVisible();
  await expectNoAxeViolations(page);

  await page.getByRole("button", { name: "Connect Instagram" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Instagram is connected." }),
  ).toContainText("5 new posts copied");
  await expect(page.getByText("@mccarrenkickball.example")).toBeVisible();

  const caption = "Championship Sunday. Congrats to the Big Kicks!";
  const card = page.getByRole("listitem").filter({ hasText: caption });
  await expect(card).toContainText("Not shown yet");
  await card.getByRole("button", { name: "Feature" }).click();
  await expect(
    page.getByRole("listitem").filter({ hasText: caption }),
  ).toContainText("Featured");
  await expectNoAxeViolations(page);

  await page.goto("/");
  const photo = page.getByRole("link", { name: new RegExp(caption) });
  await expect(photo).toHaveAttribute(
    "href",
    "https://www.instagram.com/p/FixtureChampionship/",
  );

  await page.goto("/app/admin/instagram");
  await page
    .getByRole("listitem")
    .filter({ hasText: caption })
    .getByRole("button", { name: "Hide" })
    .click();
  await expect(
    page.getByRole("listitem").filter({ hasText: caption }),
  ).toContainText("Hidden");
  // The visit right after a change may still get the cached page while
  // the fresh one renders (docs/architecture.md, section 17).
  await expect
    .poll(async () => {
      await page.goto("/");
      return page.getByRole("link", { name: new RegExp(caption) }).count();
    })
    .toBe(0);

  await page.goto("/app/admin/instagram");
  await page.getByText("Disconnect Instagram").click();
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Instagram is disconnected." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect Instagram" }),
  ).toBeVisible();
  await page.context().close();
});
