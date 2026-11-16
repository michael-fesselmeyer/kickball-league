import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "./support/axe";

/**
 * One public page in each new language, one per script (issue 441): Han,
 * Cyrillic, Polish Latin, Bengali, Hangul and Creole Latin. Read on a phone
 * (this file runs in the phone project too) and checked with axe.
 * Read-only: it only opens pages the seed already has.
 */
const PAGES = [
  {
    path: "/zh",
    lang: "zh-Hans",
    heading: "踢踢球",
    script: "PingFang SC",
  },
  {
    path: "/ru/seasons/fall-2026/schedule",
    lang: "ru",
    heading: "Расписание",
  },
  { path: "/pl/about", lang: "pl", heading: "Liga kickballa do" },
  {
    path: "/bn/faq",
    lang: "bn",
    heading: "প্রশ্ন আছে?",
    script: "Kohinoor Bangla",
  },
  {
    path: "/ko/faq",
    lang: "ko",
    heading: "궁금한 점",
    script: "Apple SD Gothic Neo",
  },
  { path: "/ht/events", lang: "ht", heading: "Evènman" },
] as const;

for (const { path, lang, heading, ...rest } of PAGES)
  test(`${path} reads in its own language`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("lang", lang);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      heading,
    );
    // Search engines find the page in every language, Chinese as Simplified.
    await expect(
      page.locator('link[rel="alternate"][hreflang="zh-Hans"]'),
    ).toHaveCount(1);
    await expect(
      page.locator('link[rel="alternate"][hreflang="x-default"]'),
    ).toHaveCount(1);
    // The switcher names each language in itself.
    const switcher = page
      .locator("footer nav")
      .filter({ has: page.locator('a[hreflang="zh-Hans"]') });
    for (const name of ["English", "简体中文", "Русский", "বাংলা", "한국어"])
      await expect(switcher.getByRole("link", { name })).toBeVisible();
    // Anyone can flag a translation that reads wrong.
    await expect(page.locator('footer p a[href="/contact"]')).toHaveCount(1);
    // Scripts Inter doesn't cover use the phone's own font for them.
    if ("script" in rest)
      expect(
        await page.evaluate(() => getComputedStyle(document.body).fontFamily),
      ).toContain(rest.script);
    await expectNoAxeViolations(page);
  });

test("the help center stays in English for the new languages", async ({
  page,
}) => {
  await page.goto("/ko/help/player");
  await expect(page).toHaveURL(/\/help\/player$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});
