import { describe, expect, it } from "vitest";
import { iosUrlTypeCommands, withAndroidSignInReturn } from "./native-sign-in";

/** The shape of the manifest Capacitor generates, trimmed. */
const MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application android:label="@string/app_name">
        <activity
            android:name=".MainActivity"
            android:launchMode="singleTask"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
        <provider android:name="androidx.core.content.FileProvider" />
    </application>
</manifest>
`;

describe("the apps' sign-in return in the native projects", () => {
  it("adds a browsable intent filter for the scheme to the launcher activity", () => {
    const out = withAndroidSignInReturn(MANIFEST, "com.example.kickball");
    const activity = out.slice(
      out.indexOf("<activity"),
      out.indexOf("</activity>"),
    );
    expect(activity).toContain(
      '<data android:scheme="com.example.kickball" />',
    );
    expect(activity).toContain("android.intent.category.BROWSABLE");
    expect(activity).toContain("android.intent.action.VIEW");
    // The launcher filter is untouched.
    expect(activity).toContain("android.intent.category.LAUNCHER");
  });

  it("replaces its own filter when run again, with a new scheme", () => {
    const once = withAndroidSignInReturn(MANIFEST, "com.example.kickball");
    const twice = withAndroidSignInReturn(once, "org.example.league");
    expect(twice.match(/league sign-in return: begin/g)).toHaveLength(1);
    expect(twice).not.toContain("com.example.kickball");
    expect(twice).toContain('android:scheme="org.example.league"');
    expect(withAndroidSignInReturn(twice, "org.example.league")).toBe(twice);
  });

  it("refuses a manifest without a launcher activity", () => {
    expect(() =>
      withAndroidSignInReturn("<manifest></manifest>", "com.example.kickball"),
    ).toThrow(/launcher/);
  });

  it("sets one iOS URL type for the scheme", () => {
    expect(iosUrlTypeCommands("com.example.kickball")).toEqual([
      "Delete :CFBundleURLTypes",
      "Add :CFBundleURLTypes array",
      "Add :CFBundleURLTypes:0 dict",
      "Add :CFBundleURLTypes:0:CFBundleURLName string com.example.kickball",
      "Add :CFBundleURLTypes:0:CFBundleURLSchemes array",
      "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string com.example.kickball",
    ]);
  });
});
