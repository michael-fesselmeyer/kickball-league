import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** WCAG 2.2 AA, the project's target (docs/design-system.md). */
const WCAG_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * Fails the test on any axe violation, listing each rule and element.
 *
 * Right after a client-side navigation (a Server Action's redirect, say),
 * the new page's content can be on screen a moment before React puts its
 * `<title>` in the head. Scanning in that gap reports a missing title that
 * no visitor ever sees, so the scan waits for one first. A page with no
 * title at all still fails, here instead of in axe.
 */
export async function expectNoAxeViolations(page: Page) {
  await expect
    .poll(() => page.title(), { message: `a <title> on ${page.url()}` })
    .not.toBe("");
  const { violations } = await new AxeBuilder({ page })
    .withTags(WCAG_AA)
    .analyze();
  const summary = violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help} — ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
  );
  expect(summary, `axe violations on ${page.url()}`).toEqual([]);
}
