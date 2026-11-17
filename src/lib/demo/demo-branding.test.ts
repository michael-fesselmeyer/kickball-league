import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BrandingError,
  brandingEnv,
  brandingKey,
  loadBranding,
  LOGO_MAX_HEIGHT,
  logoSize,
  prepareLogo,
} from "../../../scripts/demo-branding.mjs";

// Invented values only: the real branding never enters the repository.
const FIXTURE = {
  leagueName: "Harbor Lights Kickball Society",
  shortName: "HLKS",
  logo: "mark.png",
  teams: ["Tidepool Toads", "Lantern Legs", "Foghorn Feet"],
};

let dir: string;
const write = (value: unknown) =>
  writeFileSync(
    join(dir, "demo-branding.json"),
    typeof value === "string" ? value : JSON.stringify(value),
  );

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "demo-branding-"));
  writeFileSync(join(dir, "mark.png"), "not really a png");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("loadBranding", () => {
  it("is null without the file, so nothing changes", () => {
    expect(loadBranding(dir)).toBeNull();
    expect(loadBranding(join(dir, "missing"))).toBeNull();
    expect(brandingEnv(null)).toEqual({});
    expect(brandingKey(null)).toBe("");
  });

  it("reads the name, short name, logo and teams", () => {
    write(FIXTURE);
    expect(loadBranding(dir)).toEqual({
      leagueName: FIXTURE.leagueName,
      shortName: "HLKS",
      logo: join(dir, "mark.png"),
      teams: FIXTURE.teams,
    });
  });

  it("needs only the league's name", () => {
    write({ leagueName: "  Harbor Lights  " });
    expect(loadBranding(dir)).toEqual({
      leagueName: "Harbor Lights",
      shortName: null,
      logo: null,
      teams: [],
    });
  });

  it("says clearly what is wrong with bad JSON", () => {
    write("{ leagueName: oops");
    expect(() => loadBranding(dir)).toThrow(BrandingError);
    expect(() => loadBranding(dir)).toThrow(
      /demo-branding\.json can't be used: it isn't valid JSON .*The demo runs without it\./,
    );
  });

  it.each([
    [[], "it must be a JSON object"],
    [{}, '"leagueName" must be a non-empty string'],
    [{ leagueName: "  " }, '"leagueName" must be a non-empty string'],
    [{ leagueName: "x".repeat(81) }, "longer than 80 characters"],
    [{ leagueName: "A", shortName: 3 }, '"shortName" must be'],
    [{ leagueName: "A", logo: "../mark.png" }, "not a path"],
    [{ leagueName: "A", logo: "mark.gif" }, ".png, .webp or .jpg"],
    [{ leagueName: "A", logo: "gone.png" }, "the logo gone.png isn't in"],
    [{ leagueName: "A", teams: "Toads" }, '"teams" must be a list'],
    [{ leagueName: "A", teams: ["Toads", ""] }, '"teams[1]" must be'],
    [{ leagueName: "A", teams: ["Toads", "toads"] }, "lists toads twice"],
  ])("refuses %j", (value, message) => {
    write(value);
    expect(() => loadBranding(dir)).toThrow(message);
  });
});

describe("brandingEnv", () => {
  it("passes the name, logo and teams to the build and the reset", () => {
    write(FIXTURE);
    const branding = loadBranding(dir);
    expect(
      brandingEnv(branding, {
        src: "/brand/logo-1.png",
        width: 96,
        height: 120,
      }),
    ).toEqual({
      SITE_NAME: FIXTURE.leagueName,
      SITE_SHORT_NAME: "HLKS",
      SITE_LOGO: "/brand/logo-1.png",
      SITE_LOGO_SIZE: "96x120",
      DEMO_TEAM_NAMES: JSON.stringify(FIXTURE.teams),
    });
  });

  it("leaves out what the file doesn't give", () => {
    write({ leagueName: "Harbor Lights" });
    expect(brandingEnv(loadBranding(dir))).toEqual({
      SITE_NAME: "Harbor Lights",
    });
  });
});

describe("brandingKey", () => {
  it("changes with the names and the logo's bytes", () => {
    write(FIXTURE);
    const key = brandingKey(loadBranding(dir));
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    writeFileSync(join(dir, "mark.png"), "a new logo");
    expect(brandingKey(loadBranding(dir))).not.toBe(key);
    write({ ...FIXTURE, teams: ["Tidepool Toads"] });
    expect(brandingKey(loadBranding(dir))).not.toBe(key);
  });
});

describe("logoSize", () => {
  it("shrinks a big logo to the header's height and keeps its shape", () => {
    expect(logoSize({ width: 1200, height: 1500 })).toEqual({
      width: 96,
      height: LOGO_MAX_HEIGHT,
    });
  });

  it("fits the large copy's longer side", () => {
    expect(logoSize({ width: 1114, height: 745 }, 512)).toEqual({
      width: 512,
      height: 342,
    });
  });

  it("never enlarges a small one", () => {
    expect(logoSize({ width: 64, height: 48 })).toEqual({
      width: 64,
      height: 48,
    });
  });
});

describe("prepareLogo", () => {
  it("writes a small PNG under public/brand and says its path and size", async () => {
    await sharp({
      create: { width: 800, height: 1000, channels: 4, background: "#2A9D8F" },
    })
      .png()
      .toFile(join(dir, "mark.png"));
    write(FIXTURE);
    const publicDir = join(dir, "public");
    mkdirSync(join(publicDir, "brand"), { recursive: true });
    writeFileSync(join(publicDir, "brand", "logo-old.png"), "stale");

    const logo = await prepareLogo(loadBranding(dir), publicDir);

    expect(logo).toEqual({
      src: expect.stringMatching(/^\/brand\/logo-[0-9a-f]{8}\.png$/),
      width: 96,
      height: LOGO_MAX_HEIGHT,
    });
    const name = logo!.src.split("/").pop()!;
    const large = name.replace(".png", "-large.png");
    expect(readdirSync(join(publicDir, "brand")).sort()).toEqual([large, name]);
    const meta = await sharp(join(publicDir, logo!.src)).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["png", 96, 120]);
    const big = await sharp(join(publicDir, "brand", large)).metadata();
    expect([big.width, big.height]).toEqual([410, 512]);
  });

  it("removes an old copy and writes nothing without a logo", async () => {
    const publicDir = join(dir, "public");
    mkdirSync(join(publicDir, "brand"), { recursive: true });
    write({ leagueName: "Harbor Lights" });
    expect(await prepareLogo(loadBranding(dir), publicDir)).toBeNull();
    expect(await prepareLogo(null, publicDir)).toBeNull();
    expect(existsSync(join(publicDir, "brand"))).toBe(false);
  });
});
