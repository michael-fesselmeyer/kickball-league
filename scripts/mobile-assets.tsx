/**
 * Draws the native apps' icon and splash sources into mobile/assets/ from
 * the league placeholder mark (src/lib/mobile/assets.ts). Run it again when
 * the mark or the theme colors change, then `npm run mobile:icons` to cut
 * every platform size from them (docs/mobile.md).
 *
 *   npm run mobile:assets
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MOBILE_ASSETS } from "../src/lib/mobile/assets";
import { renderMark } from "../src/lib/pwa/icons";

const dir = join("mobile", "assets");
mkdirSync(dir, { recursive: true });

async function main() {
  for (const asset of MOBILE_ASSETS) {
    const image = await renderMark(asset.size, asset.fraction, asset.colors);
    const png = Buffer.from(await image.arrayBuffer());
    writeFileSync(join(dir, asset.file), png);
    console.log(`${join(dir, asset.file)} (${asset.size}px)`);
  }
}

void main();
