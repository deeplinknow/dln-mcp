# DeepLinkNow React Native SDK

## Overview

`@deeplinknow/react-native` gives React Native and Expo apps the same two calls as the native SDKs: initialize, and get the deferred deep link. It wraps the native iOS and Android SDKs, so it behaves the same way and returns the same shapes on both platforms.

When a user taps one of your links before installing your app, `checkDeferredDeepLink()` returns the path and query they tapped:

- **iOS**: 1. the link the landing page copied to the pasteboard (exact), then 2. fingerprint matching (best effort).
- **Android**: 1. the Play Install Referrer (exact), then 2. fingerprint matching (best effort).

It is not an analytics or attribution SDK. It never reads advertising identifiers and never triggers the App Tracking Transparency prompt.

## Requirements

- React Native 0.81+ (old or new architecture), or Expo SDK 54+ with a development build
- iOS 13+, Android API 24+
- Expo Go has no native code, so only the fingerprint step works there (the SDK logs a warning). Use a development build.

## Installation

### Expo

```sh
npx expo install @deeplinknow/react-native
```

Add the config plugin with your link domains. It adds `applinks:<domain>` to the iOS Associated Domains and an auto-verified App Links intent filter on Android for each domain:

```json
{
  "expo": {
    "plugins": [
      ["@deeplinknow/react-native", { "domains": ["myapp.deeplinknow.com", "go.myapp.com"] }]
    ]
  }
}
```

Then rebuild the native projects: `npx expo prebuild` (or let EAS Build do it), then `npx expo run:ios` / `npx expo run:android`.

### Bare React Native

```sh
npm install @deeplinknow/react-native
cd ios && pod install
```

If `pod install` (or `npx expo prebuild`) says no spec satisfies `DeepLinkNow (~> 1.2.0)`, your local CocoaPods spec cache is older than the release. Run `cd ios && pod install --repo-update` once.

Autolinking picks the right native module (TurboModule on the new architecture, bridge module on the old one). Add the Associated Domains entitlement (`applinks:myapp.deeplinknow.com`) on iOS and an `autoVerify` https intent filter for your link domains on Android. See the [iOS](/docs/ios) and [Android](/docs/android) docs for details and the dashboard settings that serve the `.well-known` files.

## Getting Started

### Initialize the SDK

Use your app's **public** API key (`dln_pub_…`) from the dashboard's **API Keys** page. The SDK endpoints (`/api/v1/sdk/*`) reject private keys, and a private key must never ship inside an app.

```typescript
import DeepLinkNow from "@deeplinknow/react-native";

const app = await DeepLinkNow.initialize("dln_pub_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", {
  enableLogs: __DEV__,
});
// app: DLNAppInfo { id, alias, domains, accountStatus, creditsRemaining }, or null if it failed
```

Config options: `enableLogs` (default `false`), `baseUrl` (default `https://deeplinknow.com`), `timeoutMs` (default 10 000), `retryAttempts` (default 2). `initialize` makes one `/init` request per call and resolves with `DLNAppInfo`. It never rejects: if it fails it resolves `null`, logs a warning and keeps the error in `DeepLinkNow.lastError`, so no `try`/`catch` is needed. `DeepLinkNow.isInitialized()` tells you whether it succeeded.

For local testing before you have created an app, you can use the demo key `test_api_key`. It returns mock responses and never touches real data.

### Get the deferred deep link

```typescript
const link = await DeepLinkNow.checkDeferredDeepLink();
if (link) {
  // link.path            "/products/123"
  // link.queryParams     { ref: "newsletter" }
  // link.source          "clipboard" | "referrer" | "fingerprint"
  // link.confidenceScore 0-100
  // link.matchQuality    "HIGH" | "MEDIUM" | "LOW"
  router.push({ pathname: link.path, params: link.queryParams });
}
```

`checkDeferredDeepLink` never throws or rejects. "No link" and a failure (offline, invalid key, not initialized) both resolve `null`, so the app just carries on to its normal start screen. To tell them apart, check `DeepLinkNow.lastError`: a `DLNError` with `code` (`notInitialized`, `network`, `rateLimited`, …), plus `status` and `serverMessage` when the server sent one. It is cleared by the next successful call.

It returns a link at most once per install. After a definitive answer (a link, or nothing found) later calls resolve to `null` without network, clipboard or referrer access. Errors don't count, so an offline first launch can still succeed on the next launch.

Options:

| Option | Default | Meaning |
|---|---|---|
| `minConfidence` | unset (off) | Discard fingerprint candidates whose `confidence_score` is below this value. Clipboard and referrer results are exact and never filtered. |
| `useClipboard` | `true` | iOS only: read the pasteboard first (may show the iOS 16+ paste prompt). Ignored on Android. |
| `force` | `false` | Ignore the "already checked" flag (useful while testing). |

```typescript
const link = await DeepLinkNow.checkDeferredDeepLink({ minConfidence: 50 });
```

`await DeepLinkNow.resetDeferredDeepLink()` clears the first-launch state and the cached referrer result so you can test again without reinstalling. `clearReferrerCache()` is a deprecated alias.

### The result: `DeferredDeepLink`

| Field | Type | Meaning |
|---|---|---|
| `path` | `string` | The tapped path up to the first `?`, not decoded, always starting with `/` |
| `queryParams` | `Record<string, string \| true \| string[]>` | Query parameters with `URLSearchParams` semantics; `true` for a bare flag, an array for repeated keys |
| `fullPath` | `string` | Path and query exactly as tapped |
| `url` | `string` | Absolute https URL of the link |
| `source` | `"clipboard" \| "referrer" \| "fingerprint"` | Which signal produced the answer |
| `confidenceScore` | `number` | `0`–`100`. Server score for fingerprint results, `100` for clipboard and referrer |
| `matchQuality` | `"HIGH" \| "MEDIUM" \| "LOW"` | `HIGH` 75+, `MEDIUM` 50–74, `LOW` 30–49 |
| `deeplinkId`, `targetUrl`, `campaignId`, `metadata`, `matchedAt`, `expiresAt` | optional | From the server |
| `matchDetails` | optional | Score breakdown (fingerprint results) |

## How fingerprint matching works

- The landing page stores a small description of the click: IP address, device class, OS version, screen size, language, time zone, and the path and query that were tapped.
- The SDK sends the same kind of description of the device. The server compares it with clicks on your app's link pages from the **last 1 hour** and returns up to 10 candidates, best first, each with a `confidence_score` (0–100) and a `match_quality` (`HIGH`, `MEDIUM`, `LOW`). Candidates below 30 are not returned.
- An IP match is not required (iCloud Private Relay and carrier NAT often change the IP between browser and app).
- Missing data never counts as agreement, and the time score decays linearly across the 1-hour claim window.
- **You choose the threshold.** `minConfidence` is off by default. Use `matchQuality` or `confidenceScore` to decide what to route automatically and what to confirm with the user.

## Handling links that open the app

```typescript
import { Linking } from "react-native";

function handleUrl(url: string | null) {
  if (!url) return;
  const link = DeepLinkNow.parseDeepLink(url);
  if (link) router.push({ pathname: link.path, params: link.queryParams });
}

Linking.getInitialURL().then(handleUrl);
Linking.addEventListener("url", ({ url }) => handleUrl(url));
```

`parseDeepLink(url)` returns `{ path, queryParams, fullPath, url }`, or `null` for URLs that are not on your link domains (exactly `<alias>.deeplinknow.com` or your verified custom domain). The older `parameters` field is kept as a deprecated alias of `queryParams`.

## Low-level API

| Method | Purpose |
|---|---|
| `findDeferredUser()` | Every fingerprint candidate from `/api/v1/sdk/match` in the server's snake_case shape: `matches[]` with `confidence_score`, `match_quality`, `match_details`, `deeplink` (`target_url`, `full_path`, `query_params`, …), plus `ttl_seconds`. Resolves `null` on failure (never rejects), with the error in `DeepLinkNow.lastError` |
| `getReferrerData()` | Android only: raw Install Referrer data (`null` on iOS) |
| `checkClipboard()` | The clipboard text if it is exactly one URL on your link domains, else `null` |
| `hasDeepLinkToken()` | Cheap "is there probably a URL on the clipboard" check that shows no paste prompt |
| `parseDeepLink(url)` | Validate and parse a URL on your link domains |
| `isValidDomain(host)` | The host rule |
| `getModuleType()` | `"expo" \| "turbo" \| "bridge" \| "none"`: which native module is in use |

## Privacy

The native SDKs send only what matching needs (platform, OS version, device class, screen, language, time zone, and an app-scoped install ID used only to claim a click). `advertising_id` is always `null`. The server reads the IP from the connection.

## API endpoints used

| Endpoint | Key | Used by |
|---|---|---|
| `POST /api/v1/sdk/init` | public | `initialize` (exactly one call per `initialize`) |
| `GET /api/v1/sdk/referrer-lookup` | public | `checkDeferredDeepLink` on Android |
| `POST /api/v1/sdk/match` | public | `checkDeferredDeepLink` (fingerprint step), `findDeferredUser` |

## Support

- Email: support@deeplinknow.com
- Package: [npmjs.com/package/@deeplinknow/react-native](https://www.npmjs.com/package/@deeplinknow/react-native)