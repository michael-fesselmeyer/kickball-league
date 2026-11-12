import { describe, expect, it } from "vitest";
import {
  APP_ICONS,
  appIconPath,
  artScale,
  isAppIconName,
  renderAppIcon,
} from "./icons";

describe("app icons", () => {
  it("lists the sizes the design system asks for", () => {
    expect(APP_ICONS["icon-192.png"].size).toBe(192);
    expect(APP_ICONS["icon-512.png"].size).toBe(512);
    expect(APP_ICONS["maskable-512.png"]).toEqual({
      size: 512,
      maskable: true,
    });
    expect(appIconPath("icon-192.png")).toBe("/icons/icon-192.png");
  });

  it("keeps maskable art inside the central 80%", () => {
    // The corners of the pole and the pennant, in the badge's 100-unit box.
    const corners = [
      [4, 8],
      [11, 8],
      [4, 96],
      [11, 96],
      [92, 50],
    ] as const;
    const scale = artScale(APP_ICONS["maskable-512.png"]);
    for (const [x, y] of corners) {
      const reach = (Math.hypot(x - 50, y - 50) / 100) * scale;
      expect(reach).toBeLessThanOrEqual(0.4);
    }
    expect(artScale(APP_ICONS["icon-512.png"])).toBeGreaterThan(scale);
  });

  it("knows its own names and nothing else", () => {
    expect(isAppIconName("icon-512.png")).toBe(true);
    expect(isAppIconName("constructor")).toBe(false);
    expect(isAppIconName("../secrets")).toBe(false);
  });

  it("draws a PNG at the requested size", async () => {
    const response = await renderAppIcon(APP_ICONS["icon-192.png"]);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    const png = new Uint8Array(await response.arrayBuffer());
    const view = new DataView(png.buffer);
    // Width and height sit in the IHDR chunk, bytes 16 to 23.
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([192, 192]);
  });
});
