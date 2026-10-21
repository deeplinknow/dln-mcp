# DeepLinkNow Android SDK

## Overview

The DeepLinkNow Android SDK (`com.deeplinknow:dln-android`, Kotlin, class `com.deeplinknow.DLN`) does one job: when a user taps one of your links before installing your app, it hands your app the path and query they tapped on first launch. It is not an analytics or attribution SDK. It never reads the Google Advertising ID (GAID) and needs no ad-related permissions.

On Android the deferred link comes from two sources, tried in this order:

1. **Play Install Referrer (exact).** The landing page adds a click ID to the Play Store link. After install, the SDK reads it from the Install Referrer API and looks up the exact click.
2. **Fingerprint (best effort).** If there is no usable referrer, the SDK asks the server for scored candidates from clicks on your link pages in the last hour.

You get both with one call: `DLN.checkDeferredDeepLink()`. The Android SDK does not read the clipboard by default.

## Requirements

- Android API level 24+
- Kotlin 1.9+, AndroidX
- `android.permission.INTERNET` (declared by the library)

## Installation

```kotlin
// build.gradle.kts
dependencies {
    implementation("com.deeplinknow:dln-android:1.3.0")
}
```

```gradle
// build.gradle
dependencies {
    implementation 'com.deeplinknow:dln-android:1.3.0'
}
```

The library declares `android.permission.INTERNET` itself and ships consumer R8/ProGuard rules for its model classes. The Install Referrer library adds its own permission.

### App Links

1. In the dashboard, set your **package name** and your **SHA-256 signing certificate fingerprints** (debug, upload and Play App Signing). DeepLinkNow serves `https://<alias>.deeplinknow.com/.well-known/assetlinks.json` (and the same file for a verified custom domain). Changes are live within 5 minutes.
2. Add an intent filter to the activity that handles links:

```xml
<intent-filter android:autoVerify="true">
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="https" android:host="myapp.deeplinknow.com" />
    <!-- add <data android:host="go.myapp.com" /> for a custom domain -->
</intent-filter>
```

3. Verify with `adb shell pm get-app-links <your.package>`.

## Getting Started

### Initialize the SDK

Use your app's **public** API key (`dln_pub_…`) from the dashboard's **API Keys** page. The SDK endpoints (`/api/v1/sdk/*`) reject private keys, and a private key must never ship inside an app.

```kotlin
import com.deeplinknow.DLN

class MyApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        // Returns immediately. Init and the Install Referrer read run in the background.
        DLN.init(this, "dln_pub_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", enableLogs = BuildConfig.DEBUG) { result ->
            // Optional, called once on the main thread with Result<DLNAppInfo>
            result.onFailure { Log.w("App", "DeepLinkNow init failed: ${it.message}") }
        }
    }
}
```

`DLN.init` returns immediately and never blocks the main thread. It validates the key, loads your link domains and starts reading the Install Referrer in the background. Observe the outcome with `onComplete`, `DLN.awaitInitialization()` or `DLN.isInitialized`.

Optional parameters: `baseUrl` (default `https://deeplinknow.com`), `timeoutMs` (default 10 000), `retryAttempts` (default 2), and `overrideScreenWidth` / `overrideScreenHeight` / `overridePixelRatio` for reproducible matching on emulators.

For local testing before you have created an app, you can use the demo key `test_api_key`. It returns mock responses and never touches real data.

### Get the deferred deep link

Call `checkDeferredDeepLink()` once on launch, after `DLN.init`. It never throws: it returns a Kotlin `Result`.

```kotlin
lifecycleScope.launch {
    DLN.checkDeferredDeepLink()
        .onSuccess { link ->
            if (link != null) {
                // link.path        "/products/123"
                // link.queryParams {"ref": QueryValue.Single("newsletter")}
                // link.source      REFERRER or FINGERPRINT
                // link.confidenceScore 0-100, link.matchQuality HIGH / MEDIUM / LOW
                router.open(link.path, link.queryParams)
            }
        }
        .onFailure { e ->
            val error = e as DLNException // error.code: NOT_INITIALIZED, NETWORK, RATE_LIMITED, ...
            // Errors are not "no link": the SDK tries again on the next call.
        }
}
```

`checkDeferredDeepLink` is a static method on `DLN`. From Java, use the callback overload:

```java
DLN.checkDeferredDeepLink(null, false, new DeferredDeepLinkCallback() {
    @Override public void onResult(DeferredDeepLink link, DLNException error) { /* main thread */ }
});
```

How `checkDeferredDeepLink()` works:

1. **Install Referrer**: the SDK waits for the referrer, extracts the `fp_id` (or `deeplink_id`) the landing page added, and calls `GET /api/v1/sdk/referrer-lookup`. A hit is returned with `source = REFERRER`, `confidenceScore = 100`, `matchQuality = HIGH`.
2. **Fingerprint**: otherwise it calls `POST /api/v1/sdk/match` and returns the best candidate the server sent, with the server's `confidence_score` and `match_quality` unchanged (`source = FINGERPRINT`).

It returns a link at most once per install. After a definitive answer (a link, or nothing found) later calls return `null` without network access. Errors such as being offline don't count, so the next launch tries again. The Play Store keeps the referrer for 90 days.

Parameters:

| Parameter | Default | Meaning |
|---|---|---|
| `minConfidence` | `null` (off) | Discard fingerprint candidates whose `confidence_score` is below this value. Referrer results are exact and never filtered. |
| `force` | `false` | Ignore the "already checked" flag (useful while testing). |

`DLN.resetDeferredDeepLink()` clears the first-launch flag and the cached referrer result so you can test the flow again without reinstalling.

### The result: `DeferredDeepLink`

| Field | Meaning |
|---|---|
| `path` | The tapped path up to the first `?`, not decoded, always starting with `/` |
| `queryParams` | `Map<String, QueryValue>` with `URLSearchParams` semantics: `Single(value)`, `Flag` (`?k` or `?k=`), `Multiple(values)` (repeated key). `toPlain()` gives `String`, `true` or `List<String>` |
| `fullPath` | Path and query exactly as tapped |
| `url` | Absolute https URL of the link |
| `source` | `DeferredDeepLinkSource.REFERRER` or `FINGERPRINT` (`.value` gives `"referrer"` / `"fingerprint"`) |
| `confidenceScore` | `0`–`100`. Server score for fingerprint results, `100` for the referrer |
| `matchQuality` | `MatchQuality.HIGH` (75+), `MEDIUM` (50–74) or `LOW` (30–49) |
| `deeplinkId`, `targetUrl`, `campaignId`, `metadata`, `matchedAt`, `expiresAt` | From the server |
| `matchDetails` | Score breakdown (fingerprint results) |

## How fingerprint matching works

Fingerprint matching is the backup for installs without a usable referrer (for example, an install that didn't come through your link's Play Store button).

- The landing page stores a small description of the click: IP address, device class, OS version, screen size, language, time zone, and the path and query that were tapped.
- The SDK sends the same kind of description of the device. The server compares it with clicks on **your** app's link pages from the **last 1 hour** and returns up to 10 candidates, best first.
- Each candidate has a `confidence_score` (0–100) and a `match_quality`: `HIGH` (75+), `MEDIUM` (50–74) or `LOW` (30–49). Candidates below 30 are not returned.
- An IP match is not required. Clicks from the same device class with a matching screen or OS version are considered too.
- Score weights: IP 40, device 30, time 20, locale 10. Missing data never counts as agreement. The time score decays linearly across the 1-hour claim window.
- **You choose the threshold.** The `minConfidence` filter is off by default. Use `matchQuality` or `confidenceScore` to decide what to route automatically and what to confirm with the user.

## Handling links that open the app

Pass incoming URLs to `DLN.parseDeepLink(url)` in both `onCreate` and `onNewIntent`. It returns `ParsedDeepLink(path, queryParams, fullPath, url)`, or `null` for URLs that are not on your link domains:

```kotlin
override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    handleIntent(intent)
}

private fun handleIntent(intent: Intent) {
    val url = intent.data?.toString() ?: return
    DLN.parseDeepLink(url)?.let { link ->
        router.open(link.path, link.queryParams)
    }
}
```

Alternatively register a callback with `DLN.setDeepLinkCallback(...)` and call `DLN.handleDeepLink(url)`.

Deferred results and direct opens use the same parsing rules, so you can route both the same way. The host rule accepts exactly `<alias>.deeplinknow.com` and your verified custom domain, case-insensitively. Other `deeplinknow.com` subdomains and lookalike hosts are rejected.

## Low-level API

| Method | Purpose |
|---|---|
| `DLN.findDeferredUserResult()` | `Result<MatchResponse>`: every fingerprint candidate from `/api/v1/sdk/match`, unfiltered, in server order, each with `confidenceScore`, `matchQuality`, `matchDetails` and `deeplink` (`queryParams`, `fullPath`) |
| `getInstance().findDeferredUser()` | 1.0 API: `MatchResponse?` (null on any error) |
| `getInstance().getDeferredDeepLink()` | 1.0 API: the cached referrer result, returned on every launch. Prefer `DLN.checkDeferredDeepLink()` |
| `getInstance().getReferrerData()` | The raw Install Referrer data (`referrerString`, `fpId`, `deeplinkId`, `processedAt`) |
| `getInstance().checkClipboard()` | The clipboard text if, trimmed, it is exactly one URL on your link domains, else `null`. On Android 12+ reading shows a system "pasted" toast |
| `getInstance().hasDeepLinkToken()` | Checks the clip description only (no toast) |
| `DLN.parseDeepLink(url)` | `ParsedDeepLink(path, queryParams, fullPath, url)` or `null` |
| `DLN.isValidDomain(host)` | The host rule |
| `getInstance().parseDeepLink(url)` | Deprecated 1.0 API returning a `Pair` (decoded path, first value of repeated keys); use `DLN.parseDeepLink(url)` |

## Privacy

The SDK sends only what matching needs: a synthesized user agent, platform, OS version, device model, screen size, language, time zone, and `ANDROID_ID` (app-scoped), which the server uses only to claim a click for this install. `advertising_id` is always `null`. The server reads the IP from the connection. On the device the SDK stores only the first-launch flag and the referrer result, excluded from backups.

## API endpoints used

| Endpoint | Key | Used by |
|---|---|---|
| `POST /api/v1/sdk/init` | public | `DLN.init` |
| `GET /api/v1/sdk/referrer-lookup` | public | `checkDeferredDeepLink` (referrer step) |
| `POST /api/v1/sdk/match` | public | `checkDeferredDeepLink` (fingerprint step), `findDeferredUser` |

These calls are exempt from per-minute rate limits; `init` counts toward monthly active users.

## Support

- Email: support@deeplinknow.com
- Source and issues: [github.com/deeplinknow/dln-android](https://github.com/deeplinknow/dln-android)