import { describe, expect, it } from "vitest";
import { renderMark } from "@/lib/pwa/icons";
import { ADAPTIVE_FRACTION, MOBILE_ASSETS } from "./assets";

const byFile = (file: string) => {
  const asset = MOBILE_ASSETS.find((a) => a.file === file);
  if (!asset) throw new Error(`no ${file}`);
  return asset;
};

describe("native app icon and splash sources", () => {
  it("names every file the assets tool looks for, at its size", () => {
    expect(MOBILE_ASSETS.map((a) => [a.file, a.size])).toEqual([
      ["icon-only.png", 1024],
      ["icon-foreground.png", 1024],
      ["icon-background.png", 1024],
      ["splash.png", 2732],
      ["splash-dark.png", 2732],
    ]);
  });

  it("keeps the adaptive icon's pennant inside Android's smallest crop", () => {
    // The pennant's corners in its 100-unit box (see icons.test.ts).
    const corners = [
      [4, 8],
      [11, 8],
      [4, 96],
      [11, 96],
      [92, 50],
    ] as const;
    const safeRadius = 66 / 108 / 2;
    for (const [x, y] of corners) {
      const reach = (Math.hypot(x - 50, y - 50) / 100) * ADAPTIVE_FRACTION;
      expect(reach).toBeLessThanOrEqual(safeRadius);
    }
    expect(byFile("icon-foreground.png").colors.background).toBeNull();
    expect(byFile("icon-background.png").fraction).toBe(0);
  });

  it("draws the dark splash in the dark theme's colors", () => {
    expect(byFile("splash.png").colors.background).toBe("#FBF8F1");
    expect(byFile("splash-dark.png").colors.background).toBe("#0E1220");
  });

  it("renders a mark at the requested size", async () => {
    const image = await renderMark(64, 0.6);
    const png = new DataView(await image.arrayBuffer());
    expect([png.getUint32(16), png.getUint32(20)]).toEqual([64, 64]);
  });
});
