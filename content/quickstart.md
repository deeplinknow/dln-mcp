# Quick start guide

Get deferred deep linking working in a few minutes: one call to initialize, and one handler that receives the deferred link and every link that opens the installed app.

## Prerequisites

1. A DeepLinkNow account and an app created in the dashboard. Your app gets the link domain `<alias>.deeplinknow.com`.
2. Your app's **public** API key (`dln_pub_…`) from the dashboard's **API Keys** page. Creating an app issues one public key (for the SDKs) and one private key (for your server only). The public key is always shown on the API Keys page. The private key is shown once; if you lose it, regenerate it there.
3. Your iOS **Team ID** and **Bundle ID**, and your Android **package name** and **SHA-256 certificate fingerprints**, entered in the app's settings so DeepLinkNow can serve the `.well-known` files.

Any path on your link domain works as a deep link with no setup: `https://<alias>.deeplinknow.com/products/123?ref=newsletter` delivers `/products/123` with `ref=newsletter` to your app.

To try an SDK before creating an app, use the demo key `test_api_key`. It returns mock responses.

## Choose your platform

- [React Native / Expo](#react-native)
- [iOS (Swift)](#ios-swift)
- [Android (Kotlin)](#android-kotlin)
- [Flutter](#flutter)

Building with a coding agent? Use DeepLinkNow from Claude Code, Cursor or VS Code: [install the MCP server](/docs/mcp) in one click or one command (no key needed), then ask the agent to add DeepLinkNow. It reads these docs and checks your link domain.

## React Native

```bash
npx expo install @deeplinknow/react-native   # Expo (development build)
npm install @deeplinknow/react-native && cd ios && pod install   # bare React Native
```

With Expo, add the config plugin with your link domains (`["@deeplinknow/react-native", { "domains": ["<alias>.deeplinknow.com"] }]`), which sets up Associated Domains and the Android intent filter. In bare React Native, add `applinks:<alias>.deeplinknow.com` and an `autoVerify` https intent filter by hand (see the [React Native docs](/docs/react-native)). Then:

```typescript
import DeepLinkNow from "@deeplinknow/react-native";

DeepLinkNow.onLink(
  (link) => {
    // link.type: "deferred" (first launch after install) or "direct"
    // link.source: "clipboard" (iOS), "referrer" (Android), "fingerprint", or how a direct open arrived
    router.push({ pathname: link.path, params: link.queryParams });
  },
  { apiKey: "dln_pub_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }
);
```

`onLink` initializes the SDK, runs the first-launch check and reads `Linking` itself, so there's no other code to write. In bare React Native, pass `schemes: ["myapp"]` if you also want your custom-scheme links. `checkDeferredDeepLink()` still works if you only want the deferred link.

Using Expo Router? Resolve the link in `app/+native-intent.tsx` with `@deeplinknow/react-native/expo-router` instead, so the app opens straight on the right screen. See [Expo Router](/docs/react-native#expo-router).

Next: [Full React Native documentation](/docs/react-native)

## iOS (Swift)

```ruby
pod 'DeepLinkNow', '~> 1.4'
```

Or add `https://github.com/deeplinknow/dln-ios` with Swift Package Manager. Add `applinks:<alias>.deeplinknow.com` under **Signing & Capabilities → Associated Domains**. Then:

```swift
import DeepLinkNow

Task { await DeepLinkNow.initialize(config: DLNConfig(apiKey: "dln_pub_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")) }

// Runs the first-launch check (the same as checkDeferredDeepLink()) and gets every later open
DeepLinkNow.onLink { link in
    // Deferred: pasteboard first (exact), then fingerprint (scored)
    router.open(path: link.path, query: link.queryParams)
}
```

Hand Universal Links that open the installed app to the SDK:

```swift
.onOpenURL { url in
    DeepLinkNow.handle(url)
}
```

Next: [Full iOS documentation](/docs/ios)

## Android (Kotlin)

```kotlin
dependencies {
    implementation("com.deeplinknow:dln-android:1.4.0")
}
```

Add an `autoVerify` https intent filter for `<alias>.deeplinknow.com` to your link-handling activity. Then:

```kotlin
// Application.onCreate
DLN.init(context = this, apiKey = "dln_pub_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")

DLN.onLink { link ->
    // Deferred: Install Referrer first (exact), then fingerprint (scored)
    router.open(link.path, link.queryParams)
}

// The activity with your App Link intent filter, in onCreate and onNewIntent
DLN.handleIntent(intent)
```

`DLN.checkDeferredDeepLink()` still works if you only want the deferred link.

Next: [Full Android documentation](/docs/android)

## Flutter

```bash
flutter pub add deeplinknow
```

The plugin wraps the native iOS and Android SDKs, which Swift Package Manager or CocoaPods and Gradle fetch for you. Add the Associated Domains entitlement and the `autoVerify` intent filter as for the native SDKs. Then:

```dart
import 'package:deeplinknow/deeplinknow.dart';

DeepLinkNow.links.listen((link) {
  // link.type: deferred or direct
  router.go(link.fullPath);
});
DeepLinkNow.listen();
await DeepLinkNow.initialize('dln_pub_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
```

Set `FlutterDeepLinkingEnabled` to `NO` in `Info.plist` and `flutter_deeplinking_enabled` to `false` in `AndroidManifest.xml` so Flutter doesn't route the same link too (see the [Flutter docs](/docs/flutter#every-open-in-one-stream)). `checkDeferredDeepLink()` still works if you only want the deferred link.

Next: [Full Flutter documentation](/docs/flutter)

## How the deferred link is found

| | iOS | Android |
|---|---|---|
| Step 1 (exact) | Pasteboard: the landing page copied the tapped link | Play Install Referrer: the landing page passed a click ID to the Play Store |
| Step 2 (best effort) | Fingerprint match | Fingerprint match |
| Result | `DeferredDeepLink` with `source`, `confidenceScore`, `matchQuality` | same |

Every SDK returns the same `DeferredDeepLink` shape: `path`, `queryParams`, `fullPath`, `url`, `source`, `confidenceScore` (0–100) and `matchQuality` (`HIGH` / `MEDIUM` / `LOW`). Exact sources report `100` / `HIGH`. The `DLNLink` that `onLink` delivers adds `type` (deferred or direct), and links that open the installed app report `100` / `HIGH` too.

### About fingerprint matching

- The server compares the device with clicks on your link pages from the last 1 hour and returns scored candidates. Each has a `confidence_score` (0–100) and a `match_quality`: `HIGH` (75+), `MEDIUM` (50–74), `LOW` (30–49).
- An IP match is not required, because iCloud Private Relay and carrier NAT often give the app a different IP from the browser.
- The time score decays across the 1-hour claim window, and missing data never counts as a match.
- You choose the threshold. The optional `minConfidence` filter is off by default, so you get the server's best candidate and decide what to do with its `matchQuality`.

## Troubleshooting

### Links open the browser instead of the app

- Check the dashboard settings (Team ID + Bundle ID, package name + SHA-256 fingerprints).
- Open `https://<alias>.deeplinknow.com/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json`. Changes can take up to 5 minutes to appear.
- iOS caches the association file when the app is installed. Reinstall after changing it.
- Android: run `adb shell pm get-app-links <your.package>`.

### No deferred link on first launch

- Make sure you register `onLink` (or call `checkDeferredDeepLink()`) at launch, and that the install happened within 1 hour of the click for fingerprint matching.
- It returns a link only once per install. Call `resetDeferredDeepLink()` (or pass `force: true`) to test again.
- Turn on `enableLogs` to see each step's outcome.
- On iOS, tapping **Don't Allow** on the paste prompt skips the pasteboard step; fingerprint matching still runs.

## Need help?

- Email: support@deeplinknow.com
- [Integration checklist](/docs/integration-checklist)