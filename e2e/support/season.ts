import { expect, type Page } from "@playwright/test";

export type NewSeason = {
  name: string;
  slug: string;
  /** YYYY-MM-DD dates. */
  firstGameDay: string;
  lastGameDay: string;
  registrationCloses: string;
  /** Whole dollars. */
  teamFee: number;
  freeAgentFee: number;
  rosterMin: number;
  rosterMax: number;
};

/**
 * An admin creates a per-team-fee season, opens registration and gives it
 * the league's current waiver, the way registration.spec.ts walks it.
 */
export async function openSeason(admin: Page, season: NewSeason) {
  await admin.goto("/app/admin/seasons/new");
  await admin.getByLabel("Name").fill(season.name);
  await admin.getByLabel("First game day").fill(season.firstGameDay);
  await admin.getByLabel("Last game day").fill(season.lastGameDay);
  await admin.getByRole("radio", { name: "Per team" }).check();
  await admin.getByLabel("Team fee ($)").fill(String(season.teamFee));
  await admin
    .getByLabel("Free agent fee ($)")
    .fill(String(season.freeAgentFee));
  await admin.getByLabel("Opens", { exact: true }).fill("2026-01-01");
  await admin
    .getByLabel("Closes", { exact: true })
    .fill(season.registrationCloses);
  await admin.getByLabel("Payment deadline").fill(season.registrationCloses);
  await admin.getByLabel("Smallest roster").fill(String(season.rosterMin));
  await admin.getByLabel("Largest roster").fill(String(season.rosterMax));
  await admin.getByRole("button", { name: "Create season" }).click();
  await expect(admin).toHaveURL(
    new RegExp(`/app/admin/seasons/${season.slug}\\?created=1`),
  );

  await admin.getByLabel("Status").selectOption({ label: "Registration open" });
  await admin.getByRole("button", { name: "Save changes" }).click();
  await expect(admin).toHaveURL(/\?saved=1/);
  await expect(admin.getByLabel("Status")).toHaveValue("registration_open");

  await admin.goto("/app/admin/waivers");
  // A label around a select also names it by the chosen option.
  const seasonWaiver = admin.getByLabel(new RegExp(`^${season.name}`));
  await seasonWaiver.selectOption({ index: 1 });
  await admin
    .locator("form")
    .filter({ has: seasonWaiver })
    .getByRole("button", { name: "Save" })
    .click();
  await expect(admin.getByRole("status")).toHaveText(
    `Saved the waiver for ${season.name}.`,
  );
}

/** Signs a season's waiver from the season page's link. */
export async function signWaiver(page: Page, slug: string, fullName: string) {
  await page.goto(`/app/seasons/${slug}`);
  await page.getByRole("link", { name: "Read and sign the waiver" }).click();
  await page
    .getByLabel("I have read the whole waiver and I agree to it.")
    .check();
  await page.getByLabel("Type your full name to sign").fill(fullName);
  await page.getByRole("button", { name: "Sign the waiver" }).click();
  await expect(page.getByRole("status")).toContainText("Signed.");
}

/** Joins a season's free-agent pool from its registration page. */
export async function joinAsFreeAgent(page: Page, slug: string) {
  await page.goto(`/app/seasons/${slug}/register`);
  await page
    .getByRole("region", { name: "Or join on your own" })
    .getByRole("button", { name: "Join as a free agent" })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "You're in the free-agent pool",
  );
}
