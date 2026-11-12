import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/domain/color/contrast";
import { colorTokens, contrastPairs, dark, light, type Theme } from "./tokens";

describe.each([
  ["light", light],
  ["dark", dark],
] as const)("%s theme", (_name, theme) => {
  it.each(
    contrastPairs.map((p) => [`${p.fg} on ${p.bg} (${p.why})`, p] as const),
  )("%s meets WCAG AA", (_label, pair) => {
    const ratio = contrastRatio(theme[pair.fg], theme[pair.bg]);
    expect(
      ratio,
      `${ratio.toFixed(2)}:1, needs ${pair.min}:1`,
    ).toBeGreaterThanOrEqual(pair.min);
  });
});

/** The custom properties a CSS block sets, e.g. { bg: "#FBF8F1", ... }. */
function declaredColors(block: string): Record<string, string> {
  return Object.fromEntries(
    [...block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [
      m[1],
      m[2]?.toLowerCase(),
    ]),
  );
}

describe("globals.css", () => {
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  const block = (marker: string) => {
    const start = css.indexOf(marker);
    expect(start, `missing block: ${marker}`).toBeGreaterThan(-1);
    return css.slice(start, css.indexOf("}", start));
  };

  it.each([
    ["light", "/* tokens:light */", light],
    ["dark", "/* tokens:dark */", dark],
    ["system dark", "/* tokens:dark-system */", dark],
  ] as const)(
    "sets exactly the %s token values",
    (_name, marker, theme: Theme) => {
      const declared = declaredColors(block(marker));
      const expected = Object.fromEntries(
        colorTokens.map((t) => [t, theme[t].toLowerCase()]),
      );
      expect(declared).toEqual(expected);
    },
  );
});
