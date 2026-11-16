import { expect, type Locator } from "@playwright/test";

/**
 * Waits until React has hydrated the element, so typing into it sticks.
 *
 * React sets a pre-filled `<textarea>` back to its server text when it
 * hydrates, so anything typed into one before then is lost. A person can't
 * type that fast; a test can, and on a slow runner the fill lands first.
 * React marks every node it has hydrated with a `__reactFiber$…` property.
 */
export async function expectHydrated(element: Locator) {
  await expect
    .poll(
      () =>
        element.evaluate((node) =>
          Object.keys(node).some((key) => key.startsWith("__reactFiber$")),
        ),
      { message: "React has hydrated the field" },
    )
    .toBe(true);
}
