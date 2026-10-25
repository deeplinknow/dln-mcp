# Migrating from Firebase Dynamic Links

Firebase Dynamic Links shut down on 25 August 2025: every `page.link` URL now returns a 404, and the `.page.link` domains are gone. Nobody can bring those URLs back, DeepLinkNow included. This guide moves the *behaviour* to DeepLinkNow: links that open your app if it's installed, survive an install if it isn't, and hand your app the original link on first launch.

There are two ways to do it. Pick one, or start with the first and move to the second over time.

## Option 1: keep your long links, change the host

If you built Dynamic Links in code as long links, like

```
https://yourapp.page.link/?link=https%3A%2F%2Fyourapp.com%2Finvite%2F8Fk2&apn=com.yourapp&ibi=com.yourapp.ios
```

the same URL works on your DeepLinkNow domain with only the host changed:

```
https://yourapp.deeplinknow.com/?link=https%3A%2F%2Fyourapp.com%2Finvite%2F8Fk2&apn=com.yourapp&ibi=com.yourapp.ios
```

DeepLinkNow accepts any path and query on your domain without creating links first, and passes the query through untouched. Your app gets the Firebase-style `link` parameter back, already decoded, in `queryParams.link`, both when the link opens the installed app and after an install.

All long links on `/` count as **one** link against your plan's link limit, because the limit counts distinct paths and ignores the query string.

What's different from Firebase:

- `apn`, `ibi`, `isi` and `efr` aren't needed. DeepLinkNow knows your app from the domain, and it sends users to the App Store or Google Play listing you set in the dashboard. They're harmless to leave in.
- `afl`, `ifl` and `ofl` (fallback URLs) aren't followed. Phones go to the store; desktop shows a QR code and store buttons.
- `st`, `sd` and `si` (social preview) aren't read from the URL. Set the preview title, description and image in the dashboard (paid plans).
- Short links (`yourapp.page.link/abc`) have no equivalent code to keep: use a path instead (Option 2). If your short links were on your own domain, you can import them (see below).

### React Native

Before (`@react-native-firebase/dynamic-links`):

```typescript
const initial = await dynamicLinks().getInitialLink();
if (initial) handle(initial.url);
dynamicLinks().onLink((link) => handle(link.url));
```

After (`@deeplinknow/react-native`):

```typescript
import DeepLinkNow from "@deeplinknow/react-native";
import { Linking } from "react-native";

await DeepLinkNow.initialize("dln_pub_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");

const linkParam = (q: Record<string, unknown>) =>
  typeof q.link === "string" ? q.link : null;

// After an install: the link the user tapped before installing.
const deferred = await DeepLinkNow.checkDeferredDeepLink();
const fromInstall = deferred && linkParam(deferred.queryParams);
if (fromInstall) handle(fromInstall);

// App already installed: the Universal Link / App Link that opened it.
const onUrl = (url: string | null) => {
  const parsed = url ? DeepLinkNow.parseDeepLink(url) : null;
  const value = parsed && linkParam(parsed.queryParams);
  if (value) handle(value);
};
Linking.getInitialURL().then(onUrl);
Linking.addEventListener("url", ({ url }) => onUrl(url));
```

### iOS (Swift)

```swift
import DeepLinkNow

await DeepLinkNow.initialize(config: DLNConfig(apiKey: "dln_pub_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"))

// After an install
if let deferred = await DeepLinkNow.checkDeferredDeepLink(),
   let value = deferred.queryParams["link"]?.stringValue {
    handle(URL(string: value))
}

// App already installed (SwiftUI)
.onOpenURL { url in
    if let link = DeepLinkNow.parseLink(url),
       let value = link.queryParams["link"]?.stringValue {
        handle(URL(string: value))
    }
}
```

### Android (Kotlin)

```kotlin
// After an install (inside a coroutine; it returns a Result and never throws)
DLN.checkDeferredDeepLink().onSuccess { deferred ->
    (deferred?.queryParams?.get("link") as? QueryValue.Single)?.value?.let(::handle)
}

// App already installed (onCreate and onNewIntent)
intent.data?.toString()?.let { url ->
    DLN.parseDeepLink(url)?.let { link ->
        (link.queryParams["link"] as? QueryValue.Single)?.value?.let(::handle)
    }
}
```

## Option 2: put the path in the link

Firebase needed the `link=` wrapper because `page.link` wasn't your domain. On DeepLinkNow it is. Instead of wrapping `https://yourapp.com/invite/8Fk2`, use the path directly:

```
https://yourapp.deeplinknow.com/invite/8Fk2
```

Your app gets `path: "/invite/8Fk2"` and any query parameters, and routes on them. This is shorter, reads better in a message, and works with your own domain (`go.yourapp.com/invite/8Fk2`) on paid plans.

Each distinct path counts once against your link limit, so put per-user values in the query (`/invite?code=8Fk2`) if you generate a lot of them.

## Import your old short links

If your Dynamic Links used your own domain (such as `links.yourapp.com`) rather than `page.link`, the short links people already shared can keep working. Point that domain at DeepLinkNow as your app's custom domain, then import the links Firebase let you export.

1. Export your Dynamic Links with Google Takeout. You get one CSV file per domain.
2. In the dashboard, open your app's **Deep Links** page and choose **Import from Firebase**.
3. Choose the CSV files. The preview shows how many links each file holds, which domains they use, and any rows that can't be imported.
4. Choose **Import**. When it finishes you can download the rows that weren't imported as a CSV, fix them and import that file again.

Each short link becomes a link on the same path, so `https://links.yourapp.com/abc123` is stored as `abc123`. Its target URL is the original Firebase deep link, its link name becomes the title, and the social title, description and image carry over. The other Firebase parameters (`apn`, `ibi`, `utm_source` and so on) are kept in the link's metadata under `fdl`.

When someone taps an imported link and installs your app, the deferred result carries the original deep link in `targetUrl`. When the app is already installed, the link opens it directly without reaching DeepLinkNow. From SDK 1.4.0, register `onLink` with `resolve: true` and the SDK looks each open up for you, so `link.targetUrl` holds the original deep link (see the [iOS](/docs/ios#handle-every-link-with-one-handler), [Android](/docs/android#handle-every-link-with-one-handler), [React Native](/docs/react-native#handle-every-link-with-one-handler) and [Flutter](/docs/flutter#every-open-in-one-stream) docs). Otherwise, look the path up yourself:

```typescript
const res = await fetch(
  `https://deeplinknow.com/api/v1/sdk/resolve?path=${encodeURIComponent("/abc123")}`,
  { headers: { "x-api-key": "dln_pub_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" } }
);
if (res.ok) {
  const { deeplink } = await res.json();
  handle(deeplink.target_url);
}
```

A path your app already has is skipped, never overwritten. Every imported link counts toward your plan's link limit, and links past it are reported so you can import them again after upgrading. Archived links are left out unless you ask for them.

## Checklist

1. Create the app in the DeepLinkNow dashboard and enter your iOS Team ID and Bundle ID and your Android package name and SHA-256 fingerprints. DeepLinkNow serves `apple-app-site-association` and `assetlinks.json` for your domain.
2. Add `applinks:yourapp.deeplinknow.com` to Associated Domains (iOS) and an `autoVerify` https intent filter for it (Android). With Expo, the config plugin does both.
3. Replace the Firebase Dynamic Links SDK calls as shown above, and remove the `firebase_dynamic_links` / `@react-native-firebase/dynamic-links` dependency.
4. Change the host in the code that builds links (Option 1), or switch to paths (Option 2).
5. Check your domain with the free [deep link domain checker](/tools).

## What DeepLinkNow doesn't replace

- Old `page.link` URLs no longer work. Update links you control (emails, QR codes, your site), and accept that old shared links won't open.
- Firebase Auth email-link sign-in used Dynamic Links for the sign-in email; Firebase's own documentation covers moving that flow off Dynamic Links. DeepLinkNow doesn't handle sign-in links.
- Firebase reported clicks into Google Analytics. DeepLinkNow shows click and install counts, and hands your app the link so you can send it to your own analytics.