# DeepLinkNow Flutter SDK

## Overview

[`deeplinknow`](https://pub.dev/packages/deeplinknow) is the Flutter plugin for DeepLinkNow. It gives Flutter and FlutterFlow apps the same two calls as the native SDKs: initialize, and get the deferred deep link.

The plugin is a thin wrapper over the native [iOS](/docs/ios) and [Android](/docs/android) SDKs (1.3). All deferred-link logic runs natively: the pasteboard and Install Referrer steps, fingerprint matching, first-launch handling and link parsing. So a Flutter app gets the same answers as a Swift, Kotlin or React Native app.

When a user taps one of your links before installing your app, `checkDeferredDeepLink()` returns the path and query they tapped:

- **iOS**: 1. the link the landing page copied to the pasteboard (exact), then 2. fingerprint matching (best effort).
- **Android**: 1. the Play Install Referrer (exact), then 2. fingerprint matching (best effort).

It is not an analytics or attribution SDK. It never reads advertising identifiers and never triggers the App Tracking Transparency prompt.

## Requirements

- Flutter 3.24+ (Dart 3.5+)
- iOS 13+, with Swift Package Manager or CocoaPods
- Android API 24+ (`minSdk 24`)
- Your app's **public** API key (`dln_pub_…`) from the dashboard's **API Keys** page

## Installation

```sh
flutter pub add deeplinknow
```

This also installs `deeplinknow_ios`, the plugin's iOS implementation. You don't add it yourself.

- **iOS**: nothing else to install. With Swift Package Manager (the default in recent Flutter) Xcode fetches `dln-ios`; with CocoaPods, `pod install` (which `flutter run` and `flutter build` run for you) fetches the `DeepLinkNow` pod. With CocoaPods, set at least `platform :ios, '13.0'` in `ios/Podfile`. No `Info.plist` keys are needed.
- **Android**: the native SDK (`com.deeplinknow:dln-android:1.3.0`) comes from Maven Central, which new Flutter projects already list in `android/settings.gradle(.kts)`. Make sure `minSdk` is at least 24 in `android/app/build.gradle(.kts)`.

Stop the app and rebuild it after adding the package. Hot restart doesn't load native code.

## Set up your link domains

DeepLinkNow serves the `.well-known` files for your domains from your dashboard settings, so links open your app when it's installed.

1. In the dashboard, set your **Team ID** and **Bundle ID** (iOS) and your **package name** and **SHA-256 certificate fingerprints** (Android).
2. **iOS**: open `ios/Runner.xcworkspace` in Xcode, go to **Runner → Signing & Capabilities → + Capability → Associated Domains**, and add `applinks:<alias>.deeplinknow.com` (and `applinks:<your custom domain>` if you have one).
3. **Android**: add an App Links intent filter to the `MainActivity` in `android/app/src/main/AndroidManifest.xml`:

```xml
<intent-filter android:autoVerify="true">
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="https" android:host="<alias>.deeplinknow.com" />
</intent-filter>
```

Replace `<alias>` with your app's alias, and add one `<data>` line per custom domain.

## Getting started

### Initialize and get the deferred deep link

```dart
import 'package:deeplinknow/deeplinknow.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Never throws: null means it failed (see DeepLinkNow.lastError).
  await DeepLinkNow.initialize(
    'dln_pub_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    config: const DLNConfig(enableLogs: kDebugMode),
  );

  // Delivered once per install; null on later launches.
  final link = await DeepLinkNow.checkDeferredDeepLink();

  runApp(MyApp(initialRoute: link?.path ?? '/'));
}
```

`DLNConfig` options: `enableLogs` (default `false`), `baseUrl` (default `https://deeplinknow.com`), `timeoutMs` and `retryAttempts`. Leave them unset to use the native defaults. `initialize` makes one native init per call and resolves `DLNAppInfo` (`id`, `alias`, `domains`, `primaryDomain`, …), or `null` if it failed. `DeepLinkNow.isInitialized` tells you whether the last `initialize` succeeded.

`link.path` is the path the user tapped (`/products/123`) and `link.queryParams` holds the query (`{ref: newsletter}`). Route on them the way you route any other link. With go_router:

```dart
final link = await DeepLinkNow.checkDeferredDeepLink();
if (link != null) router.go(link.fullPath); // path + query, as tapped
```

For local testing before you have created an app, you can use the demo key `test_api_key`. It returns mock responses and never touches real data.

### No link, or an error?

`checkDeferredDeepLink` never throws. "No link" and a failure (offline, invalid key, not initialized) both resolve `null`, so the app carries on to its normal start screen. To tell them apart, check `DeepLinkNow.lastError`: a `DLNError` with a `code` (`notInitialized`, `invalidApiKey`, `accountInactive`, `noCredits`, `rateLimited`, `badRequest`, `server`, `network` or `invalidResponse`, the same codes as every DeepLinkNow SDK), plus `status`, `serverMessage`, `message` and `cause` when present. It is cleared by the next successful call.

```dart
final link = await DeepLinkNow.checkDeferredDeepLink();
if (link == null && DeepLinkNow.lastError != null) {
  // Offline or misconfigured. Errors don't use up the first launch,
  // so the next launch tries again.
}
```

It returns a link at most once per install. After a definitive answer (a link, or nothing found) later calls resolve `null` without network, clipboard or referrer access.

Options:

| Option | Default | Meaning |
|---|---|---|
| `minConfidence` | unset (off) | Discard fingerprint candidates whose score is below this value. Clipboard and referrer results are exact and never filtered. |
| `useClipboard` | `true` | iOS only: read the pasteboard first (may show the iOS 16+ paste prompt). Ignored on Android. |
| `force` | `false` | Ignore the "already checked" flag (useful while testing). |

```dart
final link = await DeepLinkNow.checkDeferredDeepLink(minConfidence: 50);
```

`await DeepLinkNow.resetDeferredDeepLink()` clears the first-launch state so you can test again without reinstalling. It is a test call, and it throws a `DLNError` if the native reset fails.

### The result: `DeferredDeepLink`

| Field | Type | Meaning |
|---|---|---|
| `path` | `String` | The tapped path up to the first `?`, always starting with `/` |
| `queryParams` | `Map<String, QueryValue>` | Query parameters (see below) |
| `fullPath` | `String` | Path and query exactly as tapped |
| `url` | `String` | Absolute https URL of the link |
| `source` | `DeferredDeepLinkSource` | `clipboard`, `referrer` or `fingerprint`: which signal produced the answer |
| `confidenceScore` | `double` | `0`–`100`. Server score for fingerprint results, `100` for clipboard and referrer |
| `matchQuality` | `MatchQuality` | `HIGH` 75+, `MEDIUM` 50–74, `LOW` 30–49 |
| `deeplinkId`, `targetUrl`, `campaignId`, `metadata`, `matchedAt`, `expiresAt` | optional | From the server |
| `matchDetails` | `MatchDetails?` | Score breakdown (fingerprint results) |

A `QueryValue` is one of:

- `SingleQueryValue` for `?ref=newsletter`
- `FlagQueryValue` for `?debug` or `?debug=`
- `MultipleQueryValue` for a repeated key, `?tag=a&tag=b`

Use `.stringValue` for the common case (`link.queryParams['ref']?.stringValue`), `.stringValues` for lists, or switch on the type.

## How fingerprint matching works

- The landing page stores a small description of the click: IP address, device class, OS version, screen size, language, time zone, and the path and query that were tapped.
- The SDK sends the same kind of description of the device. The server compares it with clicks on your app's link pages from the **last 1 hour** and returns up to 10 candidates, best first, each with a `confidence_score` (0–100) and a `match_quality` (`HIGH`, `MEDIUM`, `LOW`). Candidates below 30 are not returned.
- An IP match is not required (iCloud Private Relay and carrier NAT often change the IP between browser and app).
- Missing data never counts as agreement, and the time score decays linearly across the 1-hour claim window.
- **You choose the threshold.** `minConfidence` is off by default. Use `matchQuality` or `confidenceScore` to decide what to route automatically and what to confirm with the user.

## Handling links that open the app

When the app is already installed, a tap on your link opens it directly (Universal Link / App Link). Receive the URL with a package such as [`app_links`](https://pub.dev/packages/app_links), then parse it with the same rules as the deferred result:

```dart
final parsed = await DeepLinkNow.parseDeepLink(uri.toString());
if (parsed != null) router.go(parsed.fullPath);
```

`parseDeepLink(url)` returns `{path, queryParams, fullPath, url}`, or `null` for URLs that are not on your link domains (exactly `<alias>.deeplinknow.com` or your verified custom domain). It returns a `Future` because Flutter platform channels are asynchronous; the parse itself runs in the native SDK.

### iOS apps on the UIScene lifecycle (Flutter 3.41+ by default)

If links that open the installed app never reach your Dart code on iOS, check these:

1. **Use `app_links` 7.0.0 or later.** Flutter 3.38 added UIScene support, Flutter 3.41 turns it on by default (and migrates an unmodified app delegate automatically), and apps built with Xcode 27 must use it. Once your app is on UIScene, iOS delivers links to the scene delegate, not the app delegate. `app_links` 6.x only hooks the app-delegate callbacks, so links never reach Dart and nothing reports an error. 7.0.0 added UISceneDelegate support. The same applies to any plugin that only calls `addApplicationDelegate`.
2. **Set `FlutterDeepLinkingEnabled` to `false`** in `ios/Runner/Info.plist` when a plugin handles your links. Otherwise the engine hands links it doesn't claim back to iOS, and the user bounces from the app to Safari and back.
3. **Subscribe to `uriLinkStream` synchronously at the top of `initState`**, before any `await`. The stream doesn't replay links that arrived before you subscribed. Queue the link until your startup is ready.
4. **Put a timeout on every external `await` in startup** (for example `FirebaseMessaging.getInitialMessage()`), and drain the link queue in a `finally` block, so one slow call can't hold the link forever.

## API

All members are static on `DeepLinkNow`.

| Member | Returns | Notes |
|---|---|---|
| `initialize(apiKey, {config})` | `Future<DLNAppInfo?>` | One native init. `null` on failure, never throws |
| `isInitialized` | `bool` | Whether the last `initialize` succeeded |
| `appInfo` | `DLNAppInfo?` | App id, alias, link domains, primary domain |
| `checkDeferredDeepLink({minConfidence, useClipboard, force})` | `Future<DeferredDeepLink?>` | `null` = no link or failure; never throws |
| `resetDeferredDeepLink()` | `Future<void>` | Clears the first-launch state, for testing |
| `findDeferredUser()` | `Future<MatchResponse?>` | Every fingerprint candidate from `/api/v1/sdk/match`, in server order, as typed classes. `null` on failure |
| `getReferrerData()` | `Future<ReferrerData?>` | Android only: the raw Install Referrer result. `null` on iOS |
| `checkClipboard()` | `Future<String?>` | The clipboard text if it is one of your links. May show the iOS paste prompt |
| `hasDeepLinkToken()` | `Future<bool>` | Cheap check that shows no paste prompt |
| `parseDeepLink(url)` | `Future<ParsedDeepLink?>` | Validate and parse a URL on your link domains |
| `isValidDomain(host)` | `Future<bool>` | Whether the host is one of your link domains |
| `lastError` | `DLNError?` | Last failure of `initialize`, `checkDeferredDeepLink` or `findDeferredUser` |
| `sdkVersion` | `String` | `"1.3.0"` |

Not in the Flutter plugin: a link stream for direct opens (use `app_links`) and `createDeepLink`. Web, macOS, Windows and Linux aren't supported: there, every call resolves `null` or `false` and `lastError` is `notInitialized`.

## FlutterFlow

Add `deeplinknow: ^1.3.0` under a custom action's **Pubspec Dependencies**. The [FlutterFlow guide](/docs/flutterflow) has the custom action that opens the right FlutterFlow page from the link, plus the entitlement and intent filter steps in FlutterFlow's Configuration Files.

## Testing your integration

- A link is delivered once per install. To try again without reinstalling, call `DeepLinkNow.resetDeferredDeepLink()` or pass `force: true`.
- iOS: open your link in Safari on the device, tap the App Store button (this copies the link), then run the app from Xcode.
- Android: test the Install Referrer with an internal test track install from a link. A sideloaded build has no referrer and falls back to fingerprint matching.
- `DLNConfig(enableLogs: true)` turns on the native debug logs (`[DeepLinkNow]` in the Xcode console, tag `DLN` in Logcat). The API key is never logged.
- Universal Links not opening the app: check Apple's CDN copy of your association file at `https://app-site-association.cdn-apple.com/a/v1/<your domain>`, or run the free [AASA validator](/tools/aasa-validator).
- `lastError` says "native plugin is not available": stop the app and rebuild it after adding the package.

## Privacy

The plugin adds nothing to what the native SDKs collect: the device fields used for matching (platform, OS version, device model, screen size, language, time zone, an app-scoped install ID), sent only to DeepLinkNow, and no advertising identifiers. It adds no Android permissions. See the [iOS](/docs/ios) and [Android](/docs/android) docs for the App Store privacy labels and the Play Data safety form.

## API endpoints used

| Endpoint | Key | Used by |
|---|---|---|
| `POST /api/v1/sdk/init` | public | `initialize` (one call per `initialize`) |
| `GET /api/v1/sdk/referrer-lookup` | public | `checkDeferredDeepLink` on Android |
| `POST /api/v1/sdk/match` | public | `checkDeferredDeepLink` (fingerprint step), `findDeferredUser` |

## Support

- Email: support@deeplinknow.com
- Package: [pub.dev/packages/deeplinknow](https://pub.dev/packages/deeplinknow)