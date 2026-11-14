import { expect, type Locator, type Page } from "@playwright/test";

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
  /** Whole dollars off every fee until the day it ends (YYYY-MM-DD). */
  earlyBird?: { discount: number; endsOn: string };
};

/** A date `days` from today in the league's time zone, as YYYY-MM-DD. */
export function leagueDate(days: number): string {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(new Date());
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

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
  if (season.earlyBird) {
    await admin
      .getByLabel("Early-bird discount ($)")
      .fill(String(season.earlyBird.discount));
    await admin.getByLabel("Early bird ends").fill(season.earlyBird.endsOn);
  }
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

/**
 * Ticks "I'm 21 or older" (or the season's minimum) inside `scope`. By role,
 * so a page Next keeps mounted but hidden behind this one never matches.
 */
export async function confirmAge(scope: Page | Locator) {
  await scope.getByRole("checkbox", { name: /^I'm \d+ or older$/ }).check();
}

/** Signs a season's waiver from the season page's link. */
export async function signWaiver(page: Page, slug: string, fullName: string) {
  await page.goto(`/app/seasons/${slug}`);
  await page.getByRole("link", { name: "Read and sign the waiver" }).click();
  await page
    .getByLabel("I have read the whole waiver and I agree to it.")
    .check();
  await page.getByLabel("Type your full name to sign").fill(fullName);
  await confirmAge(page);
  await page.getByRole("button", { name: "Sign the waiver" }).click();
  await expect(page.getByRole("status")).toContainText("Signed.");
}

/** Joins a season's free-agent pool from its registration page. */
export async function joinAsFreeAgent(page: Page, slug: string) {
  await page.goto(`/app/seasons/${slug}/register`);
  const pool = page.getByRole("region", { name: "Or join on your own" });
  await confirmAge(pool);
  await pool.getByRole("button", { name: "Join as a free agent" }).click();
  await expect(page.getByRole("status")).toContainText(
    "You're in the free-agent pool",
  );
}
