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
- Short links (`yourapp.page.link/abc`) have no equivalent code to keep: use a path instead (Option 2).

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

## Checklist

1. Create the app in the DeepLinkNow dashboard and enter your iOS Team ID and Bundle ID and your Android package name and SHA-256 fingerprints. DeepLinkNow serves `apple-app-site-association` and `assetlinks.json` for your domain.
2. Add `applinks:yourapp.deeplinknow.com` to Associated Domains (iOS) and an `autoVerify` https intent filter for it (Android). With Expo, the config plugin does both.
3. Replace the Firebase Dynamic Links SDK calls as shown above, and remove the `firebase_dynamic_links` / `@react-native-firebase/dynamic-links` dependency.
4. Change the host in the code that builds links (Option 1), or switch to paths (Option 2).
5. Check your domain with the free [deep link domain checker](/tools).

## What DeepLinkNow doesn't replace

- **Old `page.link` URLs.** They're dead. Update links you control (emails, QR codes, your site), and accept that old shared links won't open.
- **Firebase Auth email-link sign-in.** It used Dynamic Links for the sign-in email; Firebase's own documentation covers moving that flow off Dynamic Links. DeepLinkNow doesn't handle sign-in links.
- **Analytics.** Firebase reported clicks into Google Analytics. DeepLinkNow shows click and install counts, and hands your app the link so you can send it to your own analytics.
