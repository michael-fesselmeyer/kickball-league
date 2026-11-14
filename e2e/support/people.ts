import { type Browser, expect, type Page } from "@playwright/test";
import { pageSignedInAs, signIn } from "./sign-in";

/**
 * A made-up person a journey owns, so it can change their account without
 * touching anyone another flow signs in as. Addresses are on
 * `example.test`; the seed's own people use another domain, so a reseed
 * keeps these accounts and a later run signs the same person back in.
 */
export type Member = {
  first: string;
  last: string;
  email: string;
  gender?: "Woman" | "Man" | "Nonbinary";
};

/** Signs a member in (making the account on first use) with a full profile. */
export async function memberPage(
  browser: Browser,
  member: Member,
): Promise<Page> {
  const page = await pageSignedInAs(browser, member.email);
  await saveProfile(page, member);
  await expect(page).toHaveURL(/\/app\/profile\?saved=1/);
  return page;
}

/** The same, in a page that is already open. */
export async function signInMember(page: Page, member: Member) {
  await signIn(page, member.email);
  await saveProfile(page, member);
  await expect(page).toHaveURL(/\/app\/profile\?saved=1/);
}

/**
 * Fills and saves everything registration needs, with invented values
 * (555-01xx numbers are reserved for fiction). The default birth date is
 * well past the 18+ check; the caller checks what the page says.
 */
export async function saveProfile(
  page: Page,
  member: Member,
  birthDate = "1990-03-14",
) {
  await page.goto("/app/profile");
  await page.getByLabel("First name").fill(member.first);
  await page.getByLabel("Last name").fill(member.last);
  await page.getByLabel("Mobile phone").fill("(718) 555-0163");
  await page.getByLabel("Birth date").fill(birthDate);
  await page
    .getByRole("combobox", { name: "Gender", exact: true })
    .selectOption({ label: member.gender ?? "Woman" });
  if (member.gender === "Nonbinary")
    await page
      .getByRole("combobox", { name: /^For the fielding rule, count me with/ })
      .selectOption({ label: "Women" });
  await page
    .getByRole("combobox", { name: "Shirt size" })
    .selectOption({ label: "M" });
  const emergency = page.getByRole("group", { name: "Emergency contact" });
  await emergency.getByLabel("Name").fill("Lee Example");
  await emergency.getByLabel("Phone").fill("(718) 555-0177");
  await page.getByRole("button", { name: "Save profile" }).click();
}
