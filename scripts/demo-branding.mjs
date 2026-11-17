// The laptop demo's private branding (docs/demo.md, "Show a league's own
// name and logo"). An optional file outside git, private/brand/
// demo-branding.json, names the league, its logo and its teams; without it
// the demo shows the generic league. Pure helpers, kept apart from
// scripts/demo.mjs so they can be tested without starting anything.
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export const BRANDING_FILE = "demo-branding.json";
/** Where the resized logo goes at build time; git ignores it. */
export const PUBLIC_LOGO_DIR = "brand";
/** The logo is drawn at most 40 px tall in the header: 3x covers every phone. */
export const LOGO_MAX_HEIGHT = 120;
/** The larger copy share images and home-screen icons draw from (up to 512 px). */
export const LOGO_LARGE_SIDE = 512;
const LOGO_TYPES = new Set([".png", ".webp", ".jpg", ".jpeg"]);
const LIMITS = { leagueName: 80, shortName: 24, team: 60, teams: 64 };

export class BrandingError extends Error {
  name = "BrandingError";
}

const problem = (file, detail) =>
  new BrandingError(
    `${file} can't be used: ${detail}. The demo runs without it.`,
  );

function text(file, value, field, max) {
  if (typeof value !== "string" || value.trim() === "")
    throw problem(file, `"${field}" must be a non-empty string`);
  const trimmed = value.trim();
  if (trimmed.length > max)
    throw problem(file, `"${field}" is longer than ${max} characters`);
  return trimmed;
}

/**
 * Reads `<dir>/demo-branding.json`. Returns null when there is no such file;
 * throws a BrandingError, which says what to fix, when it can't be used.
 *
 *   {
 *     "leagueName": "the league's full name",
 *     "shortName": "a short form for phones (optional)",
 *     "logo": "a .png, .webp or .jpg file in the same folder (optional)",
 *     "teams": ["team names, in the order the seed's teams get them (optional)"]
 *   }
 */
export function loadBranding(dir) {
  const file = path.join(dir, BRANDING_FILE);
  if (!existsSync(file)) return null;
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw problem(file, `it isn't valid JSON (${error.message})`);
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    throw problem(file, "it must be a JSON object");

  const leagueName = text(
    file,
    raw.leagueName,
    "leagueName",
    LIMITS.leagueName,
  );
  const shortName =
    raw.shortName === undefined
      ? null
      : text(file, raw.shortName, "shortName", LIMITS.shortName);

  let logo = null;
  if (raw.logo !== undefined) {
    const name = text(file, raw.logo, "logo", 200);
    if (path.basename(name) !== name)
      throw problem(file, `"logo" must be a file name in ${dir}, not a path`);
    if (!LOGO_TYPES.has(path.extname(name).toLowerCase()))
      throw problem(file, `"logo" must be a .png, .webp or .jpg file`);
    logo = path.join(dir, name);
    if (!existsSync(logo))
      throw problem(file, `the logo ${name} isn't in ${dir}`);
  }

  let teams = [];
  if (raw.teams !== undefined) {
    if (!Array.isArray(raw.teams))
      throw problem(file, `"teams" must be a list of names`);
    if (raw.teams.length > LIMITS.teams)
      throw problem(file, `"teams" has more than ${LIMITS.teams} names`);
    teams = raw.teams.map((team, i) =>
      text(file, team, `teams[${i}]`, LIMITS.team),
    );
    const seen = new Set();
    for (const team of teams) {
      if (seen.has(team.toLowerCase()))
        throw problem(file, `"teams" lists ${team} twice`);
      seen.add(team.toLowerCase());
    }
  }

  return { leagueName, shortName, logo, teams };
}

/**
 * The environment the demo's build, reset and server get from the branding.
 * `logo` is the resized copy under public/: its URL path and size.
 * Nothing at all without branding, so the demo is exactly as before.
 */
export function brandingEnv(branding, logo = null) {
  if (!branding) return {};
  const env = { SITE_NAME: branding.leagueName };
  if (branding.shortName) env.SITE_SHORT_NAME = branding.shortName;
  if (logo) {
    env.SITE_LOGO = logo.src;
    env.SITE_LOGO_SIZE = `${logo.width}x${logo.height}`;
  }
  if (branding.teams.length > 0)
    env.DEMO_TEAM_NAMES = JSON.stringify(branding.teams);
  return env;
}

/**
 * The size to resize a logo to: at most LOGO_MAX_HEIGHT tall, or with
 * `largeSide`, at most that on its longer side. Never larger than it is.
 */
export function logoSize({ width, height }, largeSide = null) {
  if (!(width > 0 && height > 0))
    throw new BrandingError("The logo has no size.");
  const scale = Math.min(
    1,
    largeSide ? largeSide / Math.max(width, height) : LOGO_MAX_HEIGHT / height,
  );
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * A fingerprint of the branding and the logo's bytes, for the build key: a
 * changed name, team list or logo makes the next demo rebuild. It reveals
 * nothing about the values.
 */
export function brandingKey(branding) {
  if (!branding) return "";
  const hash = createHash("sha256").update(
    JSON.stringify({
      ...branding,
      logo: branding.logo && path.basename(branding.logo),
    }),
  );
  if (branding.logo) hash.update(readFileSync(branding.logo));
  return hash.digest("hex").slice(0, 16);
}

/**
 * Puts a small PNG copy of the branding's logo in `<publicDir>/brand/` (git
 * ignores it) and returns its URL path and size, after removing any older
 * copy. Beside it goes `<name>-large.png`, which the server draws share
 * images and home-screen icons from (src/lib/brand-logo.ts). Null without a logo. Uses sharp, which Next.js already installs for
 * its image optimizer; throws when it is missing or the logo can't be read.
 */
export async function prepareLogo(branding, publicDir) {
  const dir = path.join(publicDir, PUBLIC_LOGO_DIR);
  rmSync(dir, { recursive: true, force: true });
  if (!branding?.logo) return null;
  const { default: sharp } = await import("sharp");
  const metadata = await sharp(branding.logo).metadata();
  const resized = (size) =>
    sharp(branding.logo)
      .resize(size.width, size.height)
      .png({ compressionLevel: 9, palette: true })
      .toBuffer();
  const size = logoSize(metadata);
  const name = `logo-${brandingKey(branding).slice(0, 8)}`;
  const [small, large] = await Promise.all([
    resized(size),
    resized(logoSize(metadata, LOGO_LARGE_SIDE)),
  ]);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${name}.png`), small);
  writeFileSync(path.join(dir, `${name}-large.png`), large);
  return { src: `/${PUBLIC_LOGO_DIR}/${name}.png`, ...size };
}
