/**
 * Registers the apps' own URL scheme in the native projects, so the system
 * browser returns to the app after Google sign-in (ADR 0075):
 *
 * - Android: an intent filter on the main activity, so the Custom Tab's
 *   redirect to `<scheme>:/sign-in?code=…` opens the app.
 * - iOS: a URL type in Info.plist, for an iOS app built without the
 *   WebAuthSession plugin, which falls back to the same redirect.
 *
 * Pure text transforms, so they can be tested without the projects;
 * scripts/mobile-sign-in-native.ts applies them. Running them again
 * replaces what they added before.
 */

const BEGIN = "<!-- league sign-in return: begin -->";
const END = "<!-- league sign-in return: end -->";

export function androidIntentFilter(scheme: string): string {
  return [
    BEGIN,
    "<intent-filter>",
    '    <action android:name="android.intent.action.VIEW" />',
    '    <category android:name="android.intent.category.DEFAULT" />',
    '    <category android:name="android.intent.category.BROWSABLE" />',
    `    <data android:scheme="${scheme}" />`,
    "</intent-filter>",
    END,
  ].join("\n            ");
}

/**
 * Adds (or replaces) the intent filter inside the activity that launches
 * the app. Refuses a manifest without one, rather than guessing.
 */
export function withAndroidSignInReturn(
  manifest: string,
  scheme: string,
): string {
  const cleaned = manifest.replace(
    new RegExp(`\\s*${escape(BEGIN)}[\\s\\S]*?${escape(END)}`, "g"),
    "",
  );
  const launcher = cleaned.indexOf("android.intent.category.LAUNCHER");
  const close = launcher < 0 ? -1 : cleaned.indexOf("</activity>", launcher);
  if (close < 0)
    throw new Error("AndroidManifest.xml has no launcher activity.");
  return `${cleaned.slice(0, close)}    ${androidIntentFilter(scheme)}\n        ${cleaned.slice(close)}`;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** PlistBuddy commands that set the app's one URL type to the scheme. */
export function iosUrlTypeCommands(scheme: string): string[] {
  return [
    "Delete :CFBundleURLTypes",
    "Add :CFBundleURLTypes array",
    "Add :CFBundleURLTypes:0 dict",
    `Add :CFBundleURLTypes:0:CFBundleURLName string ${scheme}`,
    "Add :CFBundleURLTypes:0:CFBundleURLSchemes array",
    `Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string ${scheme}`,
  ];
}
