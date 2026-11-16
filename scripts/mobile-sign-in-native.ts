/**
 * Registers the apps' URL scheme (MOBILE_APP_ID) in the native projects so
 * the system browser returns to the app after Google sign-in (ADR 0075):
 * an intent filter in android/app/src/main/AndroidManifest.xml and a URL
 * type in ios/App/App/Info.plist. Skips a project that hasn't been
 * generated yet; safe to run again. PlistBuddy ships with macOS.
 *
 *   npm run mobile:sign-in
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { appScheme } from "../src/lib/mobile/app-scheme";
import {
  iosUrlTypeCommands,
  withAndroidSignInReturn,
} from "../src/lib/mobile/native-sign-in";

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });
const scheme = appScheme(process.env.MOBILE_APP_ID);

const manifest = join("android", "app", "src", "main", "AndroidManifest.xml");
if (existsSync(manifest)) {
  writeFileSync(
    manifest,
    withAndroidSignInReturn(readFileSync(manifest, "utf8"), scheme),
  );
  console.log(`${manifest}: returns from sign-in on ${scheme}:`);
} else console.log(`No ${manifest} yet; skipping Android.`);

const plist = join("ios", "App", "App", "Info.plist");
if (existsSync(plist)) {
  for (const command of iosUrlTypeCommands(scheme)) {
    try {
      execFileSync("/usr/libexec/PlistBuddy", ["-c", command, plist], {
        stdio: ["ignore", "ignore", "pipe"],
      });
    } catch (error) {
      // Deleting a URL type list that isn't there yet is fine.
      if (!command.startsWith("Delete")) throw error;
    }
  }
  console.log(`${plist}: returns from sign-in on ${scheme}:`);
} else console.log(`No ${plist} yet; skipping iOS.`);
