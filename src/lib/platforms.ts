/**
 * The DeepLinkNow side of an integration, per platform, taken from the public
 * docs (content/*.md, SDK 1.2.0). Used by migrate_from (MCP-50..53) so its code
 * diffs match what get_setup_guide returns.
 */
export const PLATFORMS = [
  "ios",
  "android",
  "react-native",
  "expo",
  "flutter",
] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_LABEL: Record<Platform, string> = {
  android: "Android (Kotlin)",
  expo: "Expo",
  flutter: "Flutter",
  ios: "iOS (Swift)",
  "react-native": "React Native",
};

/** Which docs page covers the platform (Expo is a section of the React Native page). */
export const PLATFORM_DOC = {
  android: "android",
  expo: "react-native",
  flutter: "flutter",
  ios: "ios",
  "react-native": "react-native",
} as const satisfies Record<Platform, string>;

export const INSTALL: Record<Platform, string> = {
  android: [
    "Add `com.deeplinknow:dln-android` from Maven Central: see https://deeplinknow.com/docs/android.md#installation.",
    'Add an `android:autoVerify="true"` https intent filter for `<alias>.deeplinknow.com` to the activity that handles links.',
  ].join("\n"),
  expo: [
    "```sh",
    "npx expo install @deeplinknow/react-native",
    "```",
    "In app.json, add the config plugin (it sets up Associated Domains and the Android intent filter), then `npx expo prebuild` or an EAS build (Expo Go can't run the native code):",
    "```json",
    '{ "expo": { "plugins": [["@deeplinknow/react-native", { "domains": ["<alias>.deeplinknow.com"] }]] } }',
    "```",
  ].join("\n"),
  flutter: [
    "```sh",
    "flutter pub add deeplinknow",
    "```",
    "The `deeplinknow` plugin wraps the native iOS and Android SDKs. Add `applinks:<alias>.deeplinknow.com` to Associated Domains (iOS) and an `autoVerify` https intent filter for it (Android); details in https://deeplinknow.com/docs/flutter.md.",
  ].join("\n"),
  ios: [
    "Swift Package Manager or CocoaPods: see https://deeplinknow.com/docs/ios.md#installation.",
    "Xcode → Signing & Capabilities → Associated Domains: add `applinks:<alias>.deeplinknow.com` (and `applinks:<your custom domain>` if you have one).",
  ].join("\n"),
  "react-native": [
    "```sh",
    "npm install @deeplinknow/react-native",
    "cd ios && pod install",
    "```",
    "Add `applinks:<alias>.deeplinknow.com` to Associated Domains (iOS) and an `autoVerify` https intent filter for it (Android).",
  ].join("\n"),
};

/** Initialize + deferred link + links that open the installed app. */
export const DLN_CODE: Record<Platform, { lang: string; code: string }> = {
  android: {
    code: `import com.deeplinknow.DLN

// Application.onCreate (public key, dln_pub_…)
DLN.init(this, "dln_pub_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")

// After an install: the link the user tapped before installing
lifecycleScope.launch {
    DLN.checkDeferredDeepLink().onSuccess { link ->
        if (link != null) router.open(link.path, link.queryParams)
    }
}

// App already installed (onCreate and onNewIntent)
intent.data?.toString()?.let { url ->
    DLN.parseDeepLink(url)?.let { link -> router.open(link.path, link.queryParams) }
}`,
    lang: "kotlin",
  },
  expo: {
    code: `import DeepLinkNow from "@deeplinknow/react-native";
import { Linking } from "react-native";

await DeepLinkNow.initialize("dln_pub_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");

// After an install: the link the user tapped before installing
const link = await DeepLinkNow.checkDeferredDeepLink();
if (link) router.push({ pathname: link.path, params: link.queryParams });

// App already installed: the Universal Link / App Link that opened it
const handleUrl = (url: string | null) => {
  const parsed = url ? DeepLinkNow.parseDeepLink(url) : null;
  if (parsed) router.push({ pathname: parsed.path, params: parsed.queryParams });
};
Linking.getInitialURL().then(handleUrl);
Linking.addEventListener("url", ({ url }) => handleUrl(url));`,
    lang: "typescript",
  },
  flutter: {
    code: `import 'package:deeplinknow/deeplinknow.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Public key (dln_pub_…) from the dashboard's API Keys page. Never throws.
  await DeepLinkNow.initialize('dln_pub_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');

  // After an install: the link the user tapped before installing (null otherwise)
  final link = await DeepLinkNow.checkDeferredDeepLink();
  runApp(MyApp(initialRoute: link?.path ?? '/'));
}
// App already installed: receive Universal Links / App Links with app_links >= 7.0.0
// and route with await DeepLinkNow.parseDeepLink(url) (see the Flutter guide).`,
    lang: "dart",
  },
  ios: {
    code: `import DeepLinkNow

// At launch (public key, dln_pub_…, from the dashboard's API Keys page)
await DeepLinkNow.initialize(config: DLNConfig(apiKey: "dln_pub_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"))

// After an install: the link the user tapped before installing
if let link = await DeepLinkNow.checkDeferredDeepLink() {
    router.open(path: link.path, query: link.queryParams)
}

// App already installed (SwiftUI)
.onOpenURL { url in
    if let link = DeepLinkNow.parseLink(url) {
        router.open(path: link.path, query: link.queryParams)
    }
}`,
    lang: "swift",
  },
  "react-native": {
    code: `import DeepLinkNow from "@deeplinknow/react-native";
import { Linking } from "react-native";

await DeepLinkNow.initialize("dln_pub_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");

// After an install: the link the user tapped before installing
const link = await DeepLinkNow.checkDeferredDeepLink();
if (link) router.push({ pathname: link.path, params: link.queryParams });

// App already installed: the Universal Link / App Link that opened it
const handleUrl = (url: string | null) => {
  const parsed = url ? DeepLinkNow.parseDeepLink(url) : null;
  if (parsed) router.push({ pathname: parsed.path, params: parsed.queryParams });
};
Linking.getInitialURL().then(handleUrl);
Linking.addEventListener("url", ({ url }) => handleUrl(url));`,
    lang: "typescript",
  },
};
