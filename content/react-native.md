# DeepLinkNow React Native SDK

## Overview

`@deeplinknow/react-native` gives React Native and Expo apps the same two calls as the native SDKs: initialize, and get the deferred deep link. It wraps the native iOS and Android SDKs, so it behaves the same way and returns the same shapes on both platforms.

When a user taps one of your links before installing your app, `checkDeferredDeepLink()` returns the path and query they tapped:

- **iOS**: 1. the link the landing page copied to the pasteboard (exact), then 2. fingerprint matching (best effort).
- **Android**: 1. the Play Install Referrer (exact), then 2. fingerprint matching (best effort).

From 1.4.0, `onLink` (or the `useDeepLink()` hook) gives you the deferred link and every link that opens the installed app through one handler, so you write your routing once.

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

If `pod install` (or `npx expo prebuild`) says no spec satisfies `DeepLinkNow (~> 1.4.0)`, your local CocoaPods spec cache is older than the release. Run `cd ios && pod install --repo-update` once.

Autolinking picks the right native module (TurboModule on the new architecture, bridge module on the old one). Add the Associated Domains entitlement (`applinks:myapp.deeplinknow.com`) on iOS and an `autoVerify` https intent filter for your link domains on Android. See the [iOS](/docs/ios) and [Android](/docs/android) docs for details and the dashboard settings that serve the `.well-known` files.

## Getting started

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

### Handle every link with one handler

From 1.4.0, `onLink` hands your app the same `DLNLink` whether the user tapped the link before installing (deferred) or the link opened the installed app (a Universal Link, an App Link or your URL scheme). The SDK reads `Linking.getInitialURL()` and `url` events itself, so you don't write any `Linking` code. This is the recommended setup for new integrations without Expo Router:

```typescript
import DeepLinkNow from "@deeplinknow/react-native";

const unsubscribe = DeepLinkNow.onLink(
  (link) => {
    // link.type    "deferred" (first launch after install) or "direct"
    // link.source  "referrer" | "clipboard" | "fingerprint" | "universalLink" | "appLink" | "scheme"
    navigate(link.path, link.queryParams);
  },
  { apiKey: "dln_pub_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }
);
```

Registering the handler starts the first-launch check, the same single check as `checkDeferredDeepLink()`, so calling both doesn't run it twice. With `apiKey` set, `onLink` initializes the SDK first. A link that arrives before you register is handed to the first handler once, and the same URL within 3 seconds counts as one open. A direct open has `confidenceScore` 100 and `matchQuality` `"HIGH"`.

In a React component, `useDeepLink()` gives you the same thing as state: `{ link, pendingLink, pendingLinks, isLoading, release, clear }`. It takes the same options as `onLink`, plus `enabled`.

Options:

| Option | Default | Meaning |
|---|---|---|
| `apiKey`, `config` | unset | Initialize first when the SDK isn't initialized yet |
| `minConfidence`, `useClipboard` | off, `true` | Passed to the first-launch check (see [Get the deferred deep link](#get-the-deferred-deep-link)) |
| `hold` | `false` | Keep links in `DeepLinkNow.pendingLinks` instead of calling the handler |
| `schemes` | the Expo config's `scheme` | Your custom URL schemes, for example `["myapp"]` |
| `resolve` | `false` | Look up each Universal Link or App Link on the server before delivering it |

**Hold a link until the user signs in.** A deferred link often arrives while the user is still on your sign-in screen. With `hold: true` the SDK keeps the latest deferred link and the latest direct one in `DeepLinkNow.pendingLinks` (deferred first; `DeepLinkNow.pendingLink` is the first of them). When sign-in finishes, `DeepLinkNow.releasePendingLink()` delivers them and ends the hold, so later links go straight to your handler. `DeepLinkNow.clearPendingLink()` drops them and keeps holding. With the hook, pass `hold: !isSignedIn` and the link is delivered once when the user signs in (see [Open the link after sign-in](#open-the-link-after-sign-in)).

**Custom URL schemes.** `myapp://products/1?x=1` arrives with `path` `/products/1` and `source` `"scheme"`. Expo apps get the `scheme` from the Expo config by default. Bare React Native apps must pass the list themselves, for example `schemes: ["myapp"]`, or scheme links aren't delivered.

**Short links imported from Firebase.** A short link such as `/abc123` means nothing to your app until it's looked up. With `resolve: true`, the SDK calls `GET /api/v1/sdk/resolve` for each Universal Link or App Link open and fills `deeplinkId`, `targetUrl`, `campaignId` and `metadata` before delivering it, so `link.targetUrl` holds the original Firebase deep link. It adds a request to every open, bounded by `timeoutMs`, so it's off by default. If the lookup fails, times out or finds nothing, you get the link unresolved. `await DeepLinkNow.resolveLink(url)` does the same lookup for one URL. See [Import your old short links](/docs/firebase-migration#import-your-old-short-links).

### Get the deferred deep link

`checkDeferredDeepLink()` keeps working, and it's what `onLink` runs on first launch. Call it yourself if you'd rather not use a handler:

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

Using Expo Router? See [Expo Router](#expo-router).

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

The `DLNLink` that `onLink` delivers has the same fields plus `type` (`"deferred"` or `"direct"`), and its `source` can also be `"universalLink"`, `"appLink"` or `"scheme"`.

## Expo Router

If your app uses Expo Router, get the deferred deep link in `app/+native-intent.tsx`. Expo Router calls this file with the URL that launched the app, before the first screen mounts. Resolving the link there means the app opens straight on the screen the user tapped: the home screen doesn't flash first, and your layouts' redirects (an auth gate, onboarding) see the right route from the start.

The minimal setup is two files. Create `app/+native-intent.tsx`:

```tsx
import { createRedirectSystemPath } from "@deeplinknow/react-native/expo-router";

export const redirectSystemPath = createRedirectSystemPath({
  apiKey: "dln_pub_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
});
```

And handle late links in your root layout, `app/_layout.tsx`:

```tsx
import { useDeferredDeepLink } from "@deeplinknow/react-native";
import { Stack, useRouter } from "expo-router";
import { useEffect } from "react";

export default function RootLayout() {
  const { link, clear } = useDeferredDeepLink();
  const router = useRouter();

  useEffect(() => {
    if (link) {
      clear(); // so it opens once
      router.push(link.fullPath);
    }
  }, [link]);

  return <Stack />;
}
```

**Don't skip the second file.** The helper waits at most `timeoutMs` (3 seconds by default) before the first screen mounts. If the link is found after that, for example on a slow connection, it reaches your app only through `useDeferredDeepLink()`. Without the hook, that link is dropped. The hook shares the helper's check, so the network calls run once, and a link the helper already opened comes back as `null`.

You don't need to call `DeepLinkNow.initialize` anywhere else: the helper does it.

What happens on each launch:

| The app was opened… | The helper returns |
|---|---|
| for the first time after install, from the store or the home screen | The link the user tapped before installing, e.g. `/products/123?ref=newsletter`. If there is none, or the check takes longer than `timeoutMs`, the app starts on its normal route |
| by a link on your DeepLinkNow domains (`yourapp.deeplinknow.com` or a verified custom domain) | That link's path and query, e.g. `/products/123?ref=newsletter` |
| any other way (a later launch, another URL, your own `myapp://` links) | The URL unchanged, so Expo Router handles it as usual |

The helper never throws. If something fails (offline, a wrong API key), the app starts where it would have without DeepLinkNow, and `DeepLinkNow.lastError` says why.

### Options

| Option | Default | Description |
|---|---|---|
| `apiKey` | required | Your public API key (`dln_pub_…`) |
| `config` | `{}` | Passed to `initialize`: `enableLogs`, `baseUrl`, `timeoutMs`, `retryAttempts` |
| `minConfidence` | off | Ignore fingerprint matches scoring below this (0–100). See [How fingerprint matching works](#how-fingerprint-matching-works) |
| `useClipboard` | `true` | iOS: check the link the landing page copied first |
| `timeoutMs` | `3000` | The longest the first launch waits for the link, in milliseconds. `0` never waits |
| `mapUniversalLinks` | `true` | Rewrite links on your DeepLinkNow domains to their in-app path |
| `routeDeferredLink` | `true` | Open the app on the deferred link at launch. Set `false` to start on the normal route and deliver the link through the hook instead (1.4.0, see [Open the link after sign-in](#open-the-link-after-sign-in)) |
| `mapLink` | the link's `fullPath` | `(link, source) => string \| null`. Use it when your screen paths differ from your link paths. `source` is `"deferred"` or `"universal"`. Return `null` to keep the incoming URL |

For example, if your links look like `/p/123` but the screen is `app/products/[id].tsx`:

```tsx
export const redirectSystemPath = createRedirectSystemPath({
  apiKey: "dln_pub_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  minConfidence: 50,
  mapLink: (link) =>
    link.path.startsWith("/p/") ? `/products/${link.path.slice(3)}` : link.fullPath,
});
```

If you already have a `redirectSystemPath` with your own rewrites, call `redirectSystemPathWithDeferredLink(event, options)` from it and apply your rewrites to the result.

### Open the link after sign-in

If a deep-linked screen needs a signed-in user, hold the link until sign-in finishes, then open it once. From 1.4.0, set `routeDeferredLink: false` in `+native-intent.tsx`. The helper still starts the check at launch, so the link is found inside its 1-hour claim window, but the app starts on its normal route:

```tsx
// app/+native-intent.tsx
import { createRedirectSystemPath } from "@deeplinknow/react-native/expo-router";

export const redirectSystemPath = createRedirectSystemPath({
  apiKey: "dln_pub_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  routeDeferredLink: false,
});
```

Then hold the link in your root layout with `useDeepLink()`:

```tsx
// app/_layout.tsx
import { useDeepLink } from "@deeplinknow/react-native";
import { Stack, useRouter } from "expo-router";
import { useEffect } from "react";

export default function RootLayout() {
  const { isSignedIn } = useAuth(); // your auth
  const router = useRouter();
  const { link, pendingLink } = useDeepLink({ hold: !isSignedIn });

  useEffect(() => {
    if (link) router.push(link.fullPath); // a new object for every link, delivered once
  }, [link]);

  // On the sign-in screen, `pendingLink` can say "Sign in to open your invite".
  return <Stack />;
}
```

While `hold` is true, a new link waits in `pendingLink`. When the user signs in it moves to `link`, once. `release()` delivers it early and ends the hold, and `clear()` drops it while still holding (on sign-out, or when the user declines the invite). Expo Router opens Universal Links, App Links and your scheme links itself through `+native-intent`, so `useDeepLink()` doesn't deliver those a second time; protect those routes with your layout's auth redirect as usual. The held link lives in memory only, so if the app is killed before sign-in it's gone.

`useDeferredDeepLink()` also takes `hold` and an `onLink` callback from 1.4.0, and the 1.3 pattern (`timeoutMs: 0` in the helper, then `if (link && isSignedIn) { clear(); router.push(link.fullPath); }` in an effect) still works.

### Without Expo Router

`useDeferredDeepLink()` works in any React Native app. Pass your API key, and it initializes the SDK and checks once:

```tsx
import { useDeferredDeepLink } from "@deeplinknow/react-native";
import { useEffect } from "react";

function App() {
  const { link, isLoading, clear } = useDeferredDeepLink({ apiKey: "dln_pub_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" });

  useEffect(() => {
    if (link) {
      clear();
      navigation.navigate("Product", { path: link.path, params: link.queryParams });
    }
  }, [link]);

  // …
}
```

It returns `{ link, isLoading, clear }`. `link` is `null` until a link is found, after `clear()`, and on every launch after the first (in Expo Go, which has no native first-launch flag, the check runs again on each launch while the click can still be claimed).

## How fingerprint matching works

- The landing page stores a small description of the click: IP address, device class, OS version, screen size, language, time zone, and the path and query that were tapped.
- The SDK sends the same kind of description of the device. The server compares it with clicks on your app's link pages from the **last 1 hour** and returns up to 10 candidates, best first, each with a `confidence_score` (0–100) and a `match_quality` (`HIGH`, `MEDIUM`, `LOW`). Candidates below 30 are not returned.
- An IP match is not required (iCloud Private Relay and carrier NAT often change the IP between browser and app).
- Missing data never counts as agreement, and the time score decays linearly across the 1-hour claim window.
- **You choose the threshold.** `minConfidence` is off by default. Use `matchQuality` or `confidenceScore` to decide what to route automatically and what to confirm with the user.

## Handling links that open the app

With `onLink` or `useDeepLink()` you don't need this: the SDK reads the URLs itself (see [Handle every link with one handler](#handle-every-link-with-one-handler)). Without them, read the URL with `Linking` and parse it:

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
| `GET /api/v1/sdk/resolve` | public | `onLink` with `resolve: true`, `resolveLink` |

## Support

- Email: support@deeplinknow.com
- Package: [npmjs.com/package/@deeplinknow/react-native](https://www.npmjs.com/package/@deeplinknow/react-native)