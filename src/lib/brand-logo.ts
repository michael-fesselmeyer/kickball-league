import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { BRAND, type SiteLogo } from "@/lib/site";

const TYPES: Record<string, string> = {
  png: "image/png",
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  svg: "image/svg+xml",
};

let cached: Promise<string | null> | undefined;

/**
 * The configured logo (src/lib/site.ts) as a data URL, for the images the
 * server draws itself: share images and home-screen icons, from the larger
 * copy when there is one. Null without a logo, or when its file is missing,
 * so they fall back to the pennant.
 */
export function logoDataUrl(logo: SiteLogo | null = BRAND.logo) {
  if (!logo) return Promise.resolve(null);
  const file = (src: string) => readFile(join(process.cwd(), "public", src));
  // The demo writes a larger copy beside the header's (scripts/demo-branding.mjs).
  const large = logo.src.replace(/\.png$/, "-large.png");
  cached ??= (
    large === logo.src
      ? file(logo.src)
      : file(large).catch(() => file(logo.src))
  ).then(
    (bytes) => {
      const type = TYPES[logo.src.split(".").pop()?.toLowerCase() ?? ""];
      return type ? `data:${type};base64,${bytes.toString("base64")}` : null;
    },
    () => null,
  );
  return cached;
}
