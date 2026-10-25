# Integration checklist

An end-to-end checklist for integrating DeepLinkNow into your mobile app.

## Dashboard setup

### Account and app

- [ ] Create a DeepLinkNow account and an app in the dashboard
- [ ] Choose your app alias (e.g. `myapp` → `myapp.deeplinknow.com`)
- [ ] Copy your keys from the **API Keys** page. Each app gets one **public** key (`dln_pub_…`, for the SDKs) and one **private** key (`dln_priv_…`, for your server only). The public key is always shown there. The private key is shown once; regenerate it there if you lose it, and choose how long the old one keeps working (24 hours by default, or immediately if it leaked).
- [ ] Optional: configure a fallback URL for desktop visitors

### iOS settings

- [ ] Bundle ID (e.g. `com.company.myapp`)
- [ ] Team ID / App ID prefix (from your Apple Developer account)
- [ ] App Store ID (once the app is published)

### Android settings

- [ ] Package name (e.g. `com.company.myapp`)
- [ ] SHA-256 certificate fingerprints: Play App Signing, upload key and debug (`keytool -list -v -keystore ~/.android/debug.keystore`)

### Verify the .well-known files

- [ ] `https://myapp.deeplinknow.com/.well-known/apple-app-site-association` contains your Team ID and Bundle ID
- [ ] `https://myapp.deeplinknow.com/.well-known/assetlinks.json` contains your package name and fingerprints

These files are served from your saved settings and cached for up to 5 minutes.

## SDK installation

- [ ] **React Native / Expo**: `npx expo install @deeplinknow/react-native` (development build, not Expo Go) or `npm install @deeplinknow/react-native` + `pod install`
- [ ] **iOS**: `pod 'DeepLinkNow', '~> 1.3'` or Swift Package Manager `https://github.com/deeplinknow/dln-ios`
- [ ] **Android**: `implementation("com.deeplinknow:dln-android:1.3.0")` (the library declares `INTERNET` itself)
- [ ] **Flutter**: `flutter pub add deeplinknow` (iOS 13+, Android `minSdk` 24; rebuild the app after adding it)
- [ ] iOS: Associated Domains `applinks:myapp.deeplinknow.com` (and your custom domain)
- [ ] Android: `autoVerify` https intent filter for `myapp.deeplinknow.com` (and your custom domain)
- [ ] No ATT prompt, IDFA, or advertising-ID permission is needed for DeepLinkNow

## Initialization

- [ ] Initialize once at app start with your **public** key (`dln_pub_…`)
- [ ] Never ship your private key in an app
- [ ] Handle an initialization failure (invalid key, inactive account, offline) separately from "no deferred link"
- [ ] Use `enableLogs` only in development builds

## Deferred deep linking

- [ ] Call `checkDeferredDeepLink()` once on launch, after initialization
- [ ] Route to `link.path` with `link.queryParams` when it returns a link
- [ ] Decide your threshold for fingerprint results. Every result carries `confidenceScore` (0–100) and `matchQuality` (`HIGH` 75+, `MEDIUM` 50–74, `LOW` 30–49). The optional `minConfidence` filter is off by default.
- [ ] Consider confirming `MEDIUM` or `LOW` fingerprint matches with the user before routing
- [ ] iOS: decide whether to keep the pasteboard step (`useClipboard`, default `true`), which can show the iOS 16+ paste prompt
- [ ] Treat errors as "try again later", not as "no link". The SDK retries on the next call.

## Links that open the installed app

- [ ] Pass incoming Universal Links / App Links to `parseDeepLink(url)`
- [ ] Route deferred and direct links through the same function

```typescript
function route(path: string, query: Record<string, string | true | string[]>) {
  switch (path) {
    case "/product":
      navigation.navigate("Product", { id: query.id });
      break;
    case "/category":
      navigation.navigate("Category", { name: query.name });
      break;
    default:
      navigation.navigate("Home");
  }
}
```

- [ ] Handle unknown paths gracefully

## Testing

### Direct links

- [ ] Tap `https://myapp.deeplinknow.com/product?id=123` from Notes or Messages with the app installed: the app opens on the right screen
- [ ] Android: `adb shell pm get-app-links <your.package>` shows your domains as verified

### Deferred links

- [ ] Uninstall the app, tap a link, install, open: the app lands on the right screen
- [ ] iOS: test both **Allow** and **Don't Allow** on the paste prompt (Don't Allow falls back to fingerprint matching)
- [ ] Android: test an install through the link's Play Store button (Install Referrer) and one without it (fingerprint)
- [ ] Check the logs for each step's outcome, `source`, `confidenceScore` and `matchQuality`
- [ ] Use `resetDeferredDeepLink()` or `force: true` to repeat the test without reinstalling
- [ ] A click older than 1 hour is not offered as a fingerprint match

### Edge cases

- [ ] First launch offline: no crash, and the next launch still finds the link
- [ ] Unknown path: falls back to a sensible screen
- [ ] A link copied from another app's domain is ignored

## Production readiness

- [ ] Only the public key is in the app binary
- [ ] Logging is off in release builds
- [ ] `.well-known` files are correct for your release signing certificates
- [ ] Privacy labels: the SDKs collect device characteristics and an app-scoped install ID for app functionality only, not for tracking

## Optional

- [ ] Custom domain (paid plans): add it under **Domains**, create the DNS record, wait for verification, then add it to Associated Domains and your intent filters
- [ ] Customize the landing page (title, subtitle, button text, social preview)
- [ ] Forward deferred-link events to your own analytics tool (DeepLinkNow does not do analytics)

## Need help?

- [Quick Start](/docs/quickstart)
- [iOS](/docs/ios), [Android](/docs/android), [React Native](/docs/react-native), [Flutter](/docs/flutter)
- [MCP server for coding agents](/docs/mcp)
- Email: support@deeplinknow.com