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
  knockOutBackground,
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
      logoBackground: "keep",
      teams: FIXTURE.teams,
    });
  });

  it("needs only the league's name", () => {
    write({ leagueName: "  Harbor Lights  " });
    expect(loadBranding(dir)).toEqual({
      leagueName: "Harbor Lights",
      shortName: null,
      logo: null,
      logoBackground: "keep",
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
    [{ leagueName: "A", logoBackground: "white" }, '"logoBackground" must be'],
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

  it("knocks out a white background into a trimmed transparent copy", async () => {
    await whiteRingLogo(join(dir, "mark.png"));
    const before = await sharp(join(dir, "mark.png")).raw().toBuffer();
    write({ ...FIXTURE, logoBackground: "knock-out" });
    const publicDir = join(dir, "public");

    const logo = await prepareLogo(loadBranding(dir), publicDir);

    // The ring is 300 px square inside a 600 by 400 white canvas: trimmed to
    // the ring, at the header's 120 px.
    expect(logo).toMatchObject({
      width: LOGO_MAX_HEIGHT,
      height: LOGO_MAX_HEIGHT,
    });
    const small = await sharp(join(publicDir, logo!.src)).metadata();
    expect([small.width, small.height, small.hasAlpha]).toEqual([
      120,
      120,
      true,
    ]);
    // The original is only read.
    expect(await sharp(join(dir, "mark.png")).raw().toBuffer()).toEqual(before);
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

/** A navy ring with a white middle on a 600 by 400 white canvas. */
async function whiteRingLogo(file: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400">
    <rect width="600" height="400" fill="#fff"/>
    <circle cx="300" cy="200" r="140" fill="#fff" stroke="#1d3557" stroke-width="20"/>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(file);
}

describe("knockOutBackground", () => {
  const pixel = async (png: Buffer, x: number, y: number) => {
    const { data, info } = await sharp(png)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const i = (y * info.width + x) * 4;
    return [...data.subarray(i, i + 4)];
  };

  it("clears the background from the edges and keeps the white inside", async () => {
    await whiteRingLogo(join(dir, "mark.png"));
    const out = await knockOutBackground(join(dir, "mark.png"));
    const meta = await sharp(out).metadata();
    // Trimmed to the ring: 280 across plus the 20 px stroke.
    expect([meta.width, meta.height]).toEqual([300, 300]);
    // Corners outside the ring are clear.
    expect((await pixel(out, 5, 5))[3]).toBe(0);
    // The white middle, which the fill can't reach, stays solid white.
    expect(await pixel(out, 150, 150)).toEqual([255, 255, 255, 255]);
    // The ring stays solid navy.
    expect(await pixel(out, 150, 5)).toEqual([0x1d, 0x35, 0x57, 255]);
  });

  it("leaves a logo without a solid light background as it is", async () => {
    await sharp({
      create: { width: 40, height: 30, channels: 4, background: "#1d3557" },
    })
      .png()
      .toFile(join(dir, "mark.png"));
    const out = await knockOutBackground(join(dir, "mark.png"));
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height]).toEqual([40, 30]);
    expect(await pixel(out, 0, 0)).toEqual([0x1d, 0x35, 0x57, 255]);
  });
});
