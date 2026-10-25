# DeepLinkNow iOS SDK

## Overview

When a user taps one of your links before installing your app, the DeepLinkNow iOS SDK (`DeepLinkNow`, Swift) hands your app the path and query they tapped on first launch. It is not an analytics or attribution SDK. It never reads the advertising identifier (IDFA), never triggers the App Tracking Transparency prompt, and needs no ATT consent.

On iOS the deferred link comes from two sources, tried in this order:

1. **Pasteboard (exact).** The landing page copies the tapped link before sending the user to the App Store. On first launch the SDK reads it back.
2. **Fingerprint (best effort).** If the pasteboard has no link of yours, the SDK asks the server for scored candidates from clicks on your link pages in the last hour.

You get both with one call: `checkDeferredDeepLink()`. From 1.4.0, `onLink` gives you the deferred link and every link that opens the installed app through one handler, so you write your routing once.

## Requirements

- iOS 13.0+
- Swift 5.5+ (async/await)
- Xcode 13.2+
- No `Info.plist` keys are required. iOS has no pasteboard usage-description key.

## Installation

### Swift Package Manager

In Xcode choose **File > Add Package Dependencies...** and enter `https://github.com/deeplinknow/dln-ios`, or add it to `Package.swift`:

```swift
.package(url: "https://github.com/deeplinknow/dln-ios.git", from: "1.4.0")
```

### CocoaPods

```ruby
pod 'DeepLinkNow', '~> 1.4'
```

Then run `pod install`. If it says no spec satisfies `DeepLinkNow (~> 1.4)`, your local CocoaPods spec cache is older than the release: run `pod install --repo-update` once.

### Universal Links (Associated Domains)

1. In the dashboard, set your app's **Team ID / App ID prefix** and **Bundle ID**. DeepLinkNow serves `https://<alias>.deeplinknow.com/.well-known/apple-app-site-association` (and the same file for a verified custom domain) from those values. Changes are live within 5 minutes.
2. In Xcode, open **Signing & Capabilities → Associated Domains** and add `applinks:<alias>.deeplinknow.com`, plus `applinks:<your-custom-domain>` if you have one.
3. Pass incoming URLs to `DeepLinkNow.handle(url)` (see [Handle every link with one handler](#handle-every-link-with-one-handler)).

## Getting started

### Initialize the SDK

Use your app's **public** API key (`dln_pub_…`) from the dashboard's **API Keys** page. The SDK endpoints (`/api/v1/sdk/*`) reject private keys, and a private key must never ship inside an app.

```swift
import DeepLinkNow

let config = DLNConfig(
    apiKey: "dln_pub_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    enableLogs: false           // true while developing
)
do {
    let app = try await DeepLinkNow.initializeThrowing(config: config)
    print("Link domains:", app.linkDomains)
} catch let error as DeepLinkNowError {
    // .invalidApiKey, .accountInactive, .noCredits, .rateLimited, .network, .server,
    // .invalidResponse, .invalidConfiguration
    print("DeepLinkNow init failed:", error.code)
}
```

`DLNConfig` options:

| Option | Default | Meaning |
|---|---|---|
| `apiKey` | — | Your public key |
| `enableLogs` | `false` | Debug logging with the `[DeepLinkNow]` prefix. The API key is never logged. |
| `baseUrl` | `https://deeplinknow.com` | API base URL. A trailing `/` is fine. |
| `timeout` | `10` s | Per request |
| `retryAttempts` | `2` | Retries for transient failures (network, timeouts, 5xx, 429) |

`await DeepLinkNow.initialize(config:)` never throws: it logs failures instead, and you can check `DeepLinkNow.isInitialized` and `DeepLinkNow.initializationError` (or `DeepLinkNow.lastError`). Initialization never reads the pasteboard and never asks for a permission. A non-https `baseUrl` is refused (http only for localhost).

For local testing before you have created an app, you can use the demo key `test_api_key`. It returns mock responses and never touches real data.

### Handle every link with one handler

From 1.4.0, `onLink` hands your app the same `DLNLink` whether the user tapped the link before installing (deferred) or the link opened the installed app (direct). This is the recommended setup for new integrations:

```swift
// At launch
Task { await DeepLinkNow.initialize(config: DLNConfig(apiKey: "dln_pub_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")) }
DeepLinkNow.onLink { link in            // runs on the main actor
    // link.type    .deferred (first launch after install) or .direct
    // link.source  .clipboard / .fingerprint for deferred, .universalLink / .scheme for direct
    router.open(path: link.path, query: link.queryParams)
}

// SwiftUI: hand every URL that opens the app to the SDK
.onOpenURL { url in
    if !DeepLinkNow.handle(url) { /* not one of your links: route it yourself */ }
}
.onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
    if let url = activity.webpageURL { DeepLinkNow.handle(url) }
}

// UIKit: scene(_:continue:) or application(_:continue:restorationHandler:)
if let url = userActivity.webpageURL { DeepLinkNow.handle(url) }
```

Registering the handler runs the first-launch check for you, with the same pasteboard and fingerprint steps and the same once-per-install rule as `checkDeferredDeepLink()`. If you register before `initialize` has finished, the check waits for it. A link that arrives before you register is handed to the handler when you do, and the same URL handed in twice within 3 seconds is delivered once.

`handle(_:)` returns `true` for a link on your link domains and for your own URL scheme, and `false` for anything else (`mailto:`, `tel:`, https links on other hosts), which you route yourself. A direct open has `confidenceScore` 100 and `matchQuality` `.high`.

Options (`DLNLinkOptions`, passed as `DeepLinkNow.onLink(options: …) { … }`):

| Option | Default | Meaning |
|---|---|---|
| `minConfidence`, `useClipboard`, `force` | `nil`, `true`, `false` | Passed to the first-launch check (see [Get the deferred deep link](#get-the-deferred-deep-link)) |
| `hold` | `false` | Keep links in `DeepLinkNow.pendingLinks` instead of calling the handler |
| `schemes` | your Info.plist schemes | The custom URL schemes `handle(_:)` accepts, for example `["myapp"]` |
| `resolve` | `false` | Look up each Universal Link on the server before delivering it |

**Hold a link until the user signs in.** A deferred link often arrives while the user is still on your sign-in screen. Register with `hold: true` and the SDK keeps the latest deferred link and the latest direct one in `DeepLinkNow.pendingLinks` (deferred first; `DeepLinkNow.pendingLink` is the first of them). You can read `pendingLink` to show "Sign in to open your invite". When sign-in finishes, `releasePendingLink()` delivers them to your handler and ends the hold, so later links go straight through. `clearPendingLink()` drops them and keeps holding, for example when the user signs out.

```swift
DeepLinkNow.onLink(options: DLNLinkOptions(hold: true)) { link in
    router.open(path: link.path, query: link.queryParams)
}

// After sign-in
DeepLinkNow.releasePendingLink()
```

**Custom URL schemes.** `myapp://products/123?x=1` arrives with `path` `/products/123` and `source` `.scheme`. By default the SDK accepts the schemes your Info.plist declares under `CFBundleURLTypes` → `CFBundleURLSchemes`. Pass `schemes: ["myapp"]` to list them yourself.

**Short links imported from Firebase.** A short link such as `/abc123` means nothing to your app until it's looked up. With `resolve: true`, the SDK calls `GET /api/v1/sdk/resolve` for each Universal Link open and fills `deeplinkId`, `targetUrl`, `campaignId` and `metadata` before delivering it, so `link.targetUrl` holds the original Firebase deep link. It adds a request to every open, so it's off by default. If the lookup fails, times out or finds nothing, you get the link unresolved. `await DeepLinkNow.resolveLink(url)` does the same lookup for one URL. See [Import your old short links](/docs/firebase-migration#import-your-old-short-links).

### Get the deferred deep link

`checkDeferredDeepLink()` keeps working, and it's what `onLink` runs on first launch. If you'd rather call it yourself, call it once on launch, after `initialize`:

```swift
if let link = await DeepLinkNow.checkDeferredDeepLink() {
    // link.path        "/products/123"
    // link.queryParams ["ref": .string("newsletter")]
    // link.source      .clipboard or .fingerprint
    // link.confidenceScore 0-100, link.matchQuality HIGH / MEDIUM / LOW
    router.open(path: link.path, query: link.queryParams)
}
// No link? Carry on to your normal start screen.
```

`checkDeferredDeepLink()` never throws. `nil` means there was no link, or the check failed (not initialized, offline, invalid key…). A failure is logged as a warning and kept in `DeepLinkNow.lastError` (a `DeepLinkNowError`: `.notInitialized`, `.network`, `.rateLimited`, …) until the next successful check, and it doesn't use up the first launch, so the SDK tries again on the next call. If you'd rather handle the error yourself, use the throwing variant:

```swift
do {
    if let link = try await DeepLinkNow.checkDeferredDeepLinkThrowing() {
        router.open(path: link.path, query: link.queryParams)
    }
} catch let error as DeepLinkNowError {
    print("Deferred check failed:", error.code)
}
```

How `checkDeferredDeepLink()` works:

1. **Pasteboard**: if the pasteboard holds a link on one of your link domains (`<alias>.deeplinknow.com` or your verified custom domain), it is parsed locally and returned with `source = .clipboard`, `confidenceScore = 100`, `matchQuality = .high`. No server match call is made. From 1.4.0, a copied link whose click has already been used (for example, one left on the pasteboard from an earlier install) isn't delivered, and the SDK moves on to fingerprinting.
2. **Fingerprint**: otherwise the SDK calls `POST /api/v1/sdk/match` and returns the best candidate the server sent, with the server's `confidence_score` and `match_quality` unchanged (`source = .fingerprint`).

It returns a link at most once per install. After a definitive answer (a link, or nothing found) later calls return `nil` without touching the pasteboard or the network. Errors don't count, so an offline first launch can still succeed on the next launch.

Options (`DLNDeferredOptions`):

| Option | Default | Meaning |
|---|---|---|
| `minConfidence` | `nil` (off) | Discard fingerprint candidates whose `confidence_score` is below this value. Pasteboard results are exact and are never filtered. |
| `useClipboard` | `true` | Read the pasteboard first. Set `false` to skip it and rely on fingerprinting only. |
| `force` | `false` | Ignore the "already checked" flag (useful while testing). |

```swift
let link = await DeepLinkNow.checkDeferredDeepLink(
    DLNDeferredOptions(minConfidence: 50, useClipboard: true)
)
```

`DeepLinkNow.resetDeferredDeepLink()` clears the first-launch flag so you can test the flow again without reinstalling.

### The result: `DLNDeferredDeepLink`

| Field | Meaning |
|---|---|
| `path` | The tapped path up to the first `?`, not decoded, always starting with `/` |
| `queryParams` | Query parameters with `URLSearchParams` semantics: a string, a flag (`?k`), or a list for repeated keys |
| `fullPath` | Path and query exactly as tapped |
| `url` | Absolute https URL of the link |
| `source` | `.clipboard` or `.fingerprint` (`.referrer` exists for parity with Android) |
| `confidenceScore` | `0`–`100`. Server score for fingerprint results, `100` for the pasteboard |
| `matchQuality` | `HIGH` (75+), `MEDIUM` (50–74) or `LOW` (30–49) |
| `deeplinkId`, `targetUrl`, `campaignId`, `metadata`, `matchedAt`, `expiresAt` | From the server (fingerprint results) |
| `matchDetails` | Score breakdown (fingerprint results) |

The `DLNLink` that `onLink` delivers has the same fields plus `type` (`.deferred` or `.direct`), and its `source` can also be `.universalLink` or `.scheme`.

## How fingerprint matching works

Fingerprint matching is the backup for when the pasteboard is empty, the user denied the paste prompt, or you set `useClipboard: false`.

- The landing page stores a small description of the click: IP address, device class, OS version, screen size, language, time zone, and the path and query that were tapped.
- On first launch the SDK sends the same kind of description of the device. The server compares it with clicks on **your** app's link pages from the **last 1 hour** and returns up to 10 candidates, best first.
- Each candidate has a `confidence_score` (0–100) and a `match_quality`: `HIGH` (75+), `MEDIUM` (50–74) or `LOW` (30–49). Candidates below 30 are not returned.
- **An IP match is not required.** iCloud Private Relay and carrier NAT often give the app a different IP from Safari, so the server also considers clicks from the same device class with a matching screen or OS version.
- Score weights: IP 40, device 27 (screen 15, OS version 12), time 18, locale 15 (time zone 10, language 5). Device points count only when the platform and device class agree (an iPad click never scores for an iPhone). When the browser couldn't report its real iOS version (Chrome for iOS, in-app browsers such as Instagram's), a compatible OS version earns 6 instead of 12. Missing data never counts as agreement.
- The time score decays linearly across the 1-hour claim window: full marks within 5 minutes, half at about 32 minutes, zero at 60 minutes.
- So without an IP match, a match where everything else agrees scores 60 (MEDIUM), or 54 from Chrome for iOS or an in-app browser. Each match in the `/sdk/match` response carries `score_version` (`2` since October 2026). If you tuned `minConfidence` on the old weights (IP 40, device 30, time 20, locale 10), check it again: Chrome for iOS and in-app browser matches without an IP match moved from 60 to 54.
- **You choose the threshold.** `checkDeferredDeepLink()` returns the server's best candidate as is. The `minConfidence` filter is off by default. Use `matchQuality` or `confidenceScore` to decide, for example, to route `HIGH` matches straight away and confirm `MEDIUM` or `LOW` ones with the user.

Once a device gets a `MEDIUM` or better match, the click is claimed for that device, so another phone on the same Wi-Fi doesn't receive it too.

## The pasteboard and the paste prompt

On iOS 16+, reading a link that Safari copied shows the system prompt **"App would like to paste from Safari"**. The SDK keeps this to a minimum:

- It reads the pasteboard only during `checkDeferredDeepLink()` on first launch (or when you call `checkClipboard()` yourself), never at init and never in the background.
- On iOS 14+ it first checks for a web URL with `detectPatterns`, which shows no prompt. If there is no URL, it skips straight to fingerprinting.
- If the user taps **Don't Allow**, that counts as "nothing found" and the SDK continues with fingerprinting.
- It never writes to or clears the pasteboard, and never logs content that is not one of your links.

If you don't want the prompt, pass `useClipboard: false`, or show your own "Paste your link" button with `UIPasteControl` (iOS 16+) and pass the result to `parseLink`.

## Handling links that open the app

When the app is already installed, a Universal Link opens it directly. With `onLink`, pass the URL to `DeepLinkNow.handle(url)` and your handler gets it (see [Handle every link with one handler](#handle-every-link-with-one-handler)). Without a handler, parse it with `parseLink`, which keeps working and returns `nil` for URLs that are not on your link domains:

```swift
// SwiftUI
.onOpenURL { url in
    if let link = DeepLinkNow.parseLink(url) {
        router.open(path: link.path, query: link.queryParams)
    }
}

// UIKit (SceneDelegate)
func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    guard userActivity.activityType == NSUserActivityTypeBrowsingWeb,
          let url = userActivity.webpageURL,
          let link = DeepLinkNow.parseLink(url) else { return }
    router.open(path: link.path, query: link.queryParams)
}
```

Deferred results and direct opens use the same parsing rules, so you can route both the same way.

## Low-level API

The building blocks behind `checkDeferredDeepLink()` stay available:

| Method | Purpose |
|---|---|
| `findDeferredUserThrowing()` / `findDeferredUser()` | Every fingerprint candidate from `/api/v1/sdk/match`, unfiltered: `confidence_score`, `match_quality`, `match_details` and `deeplink` (with `full_path` and `query_params`), plus `ttl_seconds`. `findDeferredUser()` returns `nil` on any error; `findDeferredUserThrowing()` throws a `DeepLinkNowError` |
| `checkClipboard()` | The pasteboard text if it is exactly one URL on your link domains, else `nil` (may show the paste prompt) |
| `hasDeepLinkToken()` / `hasDeepLinkTokenAsync()` | Cheap "is there probably a URL on the pasteboard" check that never reads the content and shows no prompt |
| `parseLink(_:)` | Validate and parse a URL on your link domains into `DLNParsedLink` (`path`, `queryParams`, `fullPath`, `url`) |
| `parseDeepLink(_:)` | Older tuple form `(path, parameters)` of `parseLink(_:)` |
| `isValidDomain(_:)` | The host rule: exactly `<alias>.deeplinknow.com` or a verified custom domain, case-insensitive |
| `createDeepLink(path:customParameters:)` | Build an https link on your primary link domain that `parseLink` round-trips (`nil` before init) |
| `isInitialized`, `initializationError`, `appInfo`, `sdkVersion` | Init state and SDK version (`"1.4.0"`) |

If you call these yourself, check the pasteboard before fingerprinting:

```swift
if let copied = DeepLinkNow.checkClipboard(),
   let url = URL(string: copied),
   let link = DeepLinkNow.parseLink(url) {
    router.open(path: link.path, query: link.queryParams)
} else if let response = try? await DeepLinkNow.findDeferredUserThrowing(),
          let best = response.matches.first(where: { $0.deeplink != nil }) {
    // best.confidenceScore and best.matchQuality: your call
}
```

## Privacy

The SDK sends only what matching needs: a synthesized user agent, platform, OS version, device class (`iPhone`/`iPad`), screen size in points with scale, language, time zone, and the app-scoped vendor ID (IDFV), which the server uses only to claim a click for this install. `advertising_id` is always `null`. The server reads the IP from the connection. The SDK stores nothing on the device except the first-launch flag, and ships a privacy manifest (`PrivacyInfo.xcprivacy`) with tracking set to false.

## API endpoints used

| Endpoint | Key | Used by |
|---|---|---|
| `POST /api/v1/sdk/init` | public | `initialize`: validates the key and account, returns your link domains |
| `POST /api/v1/sdk/match` | public | `checkDeferredDeepLink` (fingerprint step), `findDeferredUser` |
| `GET /api/v1/sdk/resolve` | public | `onLink` with `resolve: true`, `resolveLink` |

`init` and `match` are exempt from per-minute rate limits, and `init` counts toward monthly active users. `resolve` counts toward your key's per-minute limit (600 a minute on the Developer and Startup plans) but not toward the monthly API quota.

## Support

- Email: support@deeplinknow.com
- Source and issues: [github.com/deeplinknow/dln-ios](https://github.com/deeplinknow/dln-ios)