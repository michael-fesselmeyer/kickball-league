# iOS and Android apps

The league's iOS and Android apps are a native shell around the site ([ADR 0074](adr/0074-ios-and-android-apps-as-a-shell-around-the-site.md)). Each opens the site in a web view and adds an app icon, Android's back button, outside links in the system browser and edge-to-edge layout. They are built and run **locally only**: in the iOS Simulator and Android emulator, or on your own phone. Nothing here needs an Apple or Google developer account, and nothing is published to a store.

## One-time setup

Run these once on the Mac that builds the apps. Everything is free.

### 1. Node

The project runs on Node 24 (`.nvmrc`):

```bash
nvm install 24 && nvm use 24
```

### 2. Xcode, for the iOS app

Capacitor 8 needs Xcode 26 or later. The command-line tools alone are not enough.

1. Install **Xcode** from the Mac App Store (free, about 15 GB) and open it once.
2. Point the command-line tools at it and accept the license:

```bash
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
```

```bash
sudo xcodebuild -license accept
```

```bash
xcodebuild -runFirstLaunch
```

3. Download an iOS simulator:

```bash
xcodebuild -downloadPlatform iOS
```

CocoaPods is **not** needed: Capacitor 8 uses Swift Package Manager, which comes with Xcode.

### 3. Android Studio, for the Android app

Capacitor 8 needs Android Studio 2025.2.1 or later. It brings its own Java.

1. Install **Android Studio** from developer.android.com/studio (free) and run its setup wizard with the standard options.
2. In **Settings → Languages & Frameworks → Android SDK**, install:
   - SDK Platforms: **Android 16 (API 36)**;
   - SDK Tools: **Android SDK Build-Tools**, **Android SDK Platform-Tools** and **Android Emulator**.
3. In **Device Manager**, create a phone emulator (for example a Pixel with API 36).
4. Add the SDK to your shell (in `~/.zshrc`), then open a new terminal:

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator"
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
```

### 4. The shell's packages

Exact versions, all published at least two weeks before they were chosen. From the repository's root:

```bash
npm install --save-exact @capacitor/core@8.6.0 @capacitor/ios@8.6.0 @capacitor/android@8.6.0 @capacitor/app@8.1.2 @capacitor/browser@8.0.5
```

```bash
npm install --save-exact --save-dev @capacitor/cli@8.6.0 @capacitor/assets@4.0.0
```

`@capacitor/core` and the plugins are dependencies so the native projects can find them; the site never imports them, so no page gets heavier.

### 5. Where the apps point

Add the site's address to `.env.local`. For a dev server on this Mac:

```bash
MOBILE_APP_URL=http://localhost:3000
```

It must be the site's origin alone: https for a real site, plain http only for `localhost`. `BETTER_AUTH_URL` should be the same address, so sign-in cookies belong to it. To build the apps against the production site later, set `MOBILE_APP_URL` to its https address and sync again.

Optionally set `MOBILE_APP_ID` to the league's own reverse domain (for example `org.example.kickball`) before generating the projects; the default `com.example.kickball` is a placeholder.

### 6. Generate the native projects

```bash
npm run mobile:add:ios
```

```bash
npm run mobile:add:android
```

```bash
npm run mobile:icons
```

The first two create `ios/` and `android/` (commit both); `mobile:add:ios` also writes the site's host into the iOS app's `WKAppBoundDomains`, which WKWebView needs before it runs the site's service worker. The third cuts every icon and splash size from `mobile/assets/`.

## Running the apps

Start the site, then the app. The service worker (offline game page, offline scores) runs in production builds only, so use a production build when testing offline:

```bash
npm run dev
```

or

```bash
npm run build && npm start
```

**iOS Simulator:**

```bash
npm run mobile:ios
```

**Android emulator.** Start the emulator from Android Studio's Device Manager, then let it reach the Mac's `localhost`:

```bash
adb reverse tcp:3000 tcp:3000
```

```bash
npm run mobile:android
```

`mobile:ios` and `mobile:android` sync first (`npm run mobile:sync`: the shell's pages, the config, the plugins and the iOS app-bound domains), so run them again after changing `MOBILE_APP_URL`. To work in the IDEs instead, use `npm run mobile:open:ios` or `npm run mobile:open:android`.

**On your own phone.** Android: enable developer options and USB debugging, plug it in, run `adb reverse tcp:3000 tcp:3000` and `npm run mobile:android`. iPhone: open the project with `npm run mobile:open:ios`, choose your Apple ID's free **Personal Team** under Signing & Capabilities, and run it on the phone; the install lasts 7 days. A dev server on the Mac is `localhost` only to the Mac, so point a physical iPhone at an https address.

## Scripts

| Script                        | What it does                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| `npm run mobile:assets`       | Draw the icon and splash sources in `mobile/assets/` from the placeholder mark       |
| `npm run mobile:icons`        | Cut every iOS and Android icon and splash size from those sources                    |
| `npm run mobile:web`          | Write the shell's own start and error pages for `MOBILE_APP_URL` into `mobile/www/`  |
| `npm run mobile:add:ios`      | Generate the iOS project (once)                                                      |
| `npm run mobile:add:android`  | Generate the Android project (once)                                                  |
| `npm run mobile:sync`         | Copy the pages, config and plugins into both projects and set the app-bound domains |
| `npm run mobile:ios`          | Sync, then build and run in the iOS Simulator                                        |
| `npm run mobile:android`      | Sync, then build and run on the Android emulator or a plugged-in phone               |
| `npm run mobile:open:ios`     | Open the iOS project in Xcode                                                        |
| `npm run mobile:open:android` | Open the Android project in Android Studio                                           |

## How the apps behave

- **Pages.** Every screen is the site's own; the apps have no copy of their own to keep in step.
- **Edges.** The layout pads itself clear of the notch, status bar and home indicator.
- **Back button (Android).** Closes an open dialog first, then goes back a page; at the first page the app goes to the background.
- **Outside links** open in the system browser, so the app never strands someone on another site. Stripe Checkout opens there too, and the purchase shows as paid once Stripe's webhook arrives.
- **No signal.** The site's own offline behavior works in the apps: the saved next game, offline score entry and the offline page. An app opened with no signal before the site ever loaded shows the shell's "Can't reach the league" page.
- **Install offer.** Not shown inside the apps.
- **Push.** Not available inside the apps yet; the profile page says so, and email still comes. Web push keeps working in the phone's browser.

## Known gaps

- **Signing in.** Google refuses sign-in inside an app's web view, and a magic link opens in the phone's browser, not the app. Signing in in the apps needs a sign-in code from the email that can be typed into the app (issue #524). Until then the apps show the public pages, and signed-in screens need the browser or the installed web app.
- **Push.** Native push needs FCM on Android (free) and APNs on iOS (paid developer account).
- **Deep links.** Links in email and push open the browser. Android App Links are free and can be added with the signing key's fingerprint; iOS universal links need the paid account.

## Not approved

Creating an Apple Developer Program or Google Play Console account, or submitting a build to either store. Both cost money, and the league's apps run at no cost ([ADR 0021](adr/0021-free-services-only.md)).
