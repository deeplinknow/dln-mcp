# Flutter Integration Guide

## Overview

There is no official Flutter SDK or pub package for DeepLinkNow. This is an integration guide: it shows how to call the native [iOS](/docs/ios) and [Android](/docs/android) SDKs from a Flutter app through a platform channel. All deferred-link logic (pasteboard and Install Referrer, fingerprint matching, first-launch handling, link parsing) runs in the native SDKs. Your Dart code only receives the result.

## 1. Add the native SDKs

**iOS** (`ios/Podfile`):

```ruby
target 'Runner' do
  use_frameworks!
  pod 'DeepLinkNow', '~> 1.2'
end
```

Run `cd ios && pod install`.

**Android** (`android/app/build.gradle`):

```gradle
dependencies {
    implementation 'com.deeplinknow:dln-android:1.2.0'
}
```

## 2. Configure your link domains

- **iOS**: in Xcode (`ios/Runner.xcworkspace`), add **Associated Domains** → `applinks:<alias>.deeplinknow.com` (and your custom domain).
- **Android**: in `android/app/src/main/AndroidManifest.xml`, add an `autoVerify` https intent filter for `<alias>.deeplinknow.com` to `MainActivity`.
- In the dashboard, set your Team ID + Bundle ID and package name + SHA-256 fingerprints so the `.well-known` files are served.

## 3. Dart side

```dart
import 'package:flutter/services.dart';

class DeepLinkNowChannel {
  static const _channel = MethodChannel('com.deeplinknow/sdk');

  /// Use your app's public key (dln_pub_...).
  static Future<void> initialize(String apiKey) =>
      _channel.invokeMethod('initialize', {'apiKey': apiKey});

  /// Returns {path, queryParams, fullPath, url, source, confidenceScore, matchQuality} or null.
  static Future<Map<String, dynamic>?> checkDeferredDeepLink({double? minConfidence}) async {
    final result = await _channel.invokeMethod<Map>(
      'checkDeferredDeepLink',
      {'minConfidence': minConfidence},
    );
    return result?.cast<String, dynamic>();
  }

  static Future<void> resetDeferredDeepLink() =>
      _channel.invokeMethod('resetDeferredDeepLink');
}
```

## 4. iOS side (`ios/Runner/AppDelegate.swift`)

```swift
import Flutter
import UIKit
import DeepLinkNow

@main
@objc class AppDelegate: FlutterAppDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    let controller = window?.rootViewController as! FlutterViewController
    let channel = FlutterMethodChannel(name: "com.deeplinknow/sdk",
                                       binaryMessenger: controller.binaryMessenger)

    channel.setMethodCallHandler { call, result in
      let args = call.arguments as? [String: Any]
      switch call.method {
      case "initialize":
        guard let apiKey = args?["apiKey"] as? String else {
          result(FlutterError(code: "INVALID_ARGUMENT", message: "apiKey is required", details: nil))
          return
        }
        Task {
          await DeepLinkNow.initialize(config: DLNConfig(apiKey: apiKey))
          result(DeepLinkNow.isInitialized)
        }
      case "checkDeferredDeepLink":
        let minConfidence = args?["minConfidence"] as? Double
        Task {
          do {
            // Pasteboard first, then fingerprint
            let link = try await DeepLinkNow.checkDeferredDeepLinkThrowing(
              DLNDeferredOptions(minConfidence: minConfidence))
            result(link.map { [
              "path": $0.path,
              "queryParams": $0.queryParams.mapValues { $0.anyValue },
              "fullPath": $0.fullPath,
              "url": $0.url,
              "source": $0.source.rawValue,
              "confidenceScore": $0.confidenceScore,
              "matchQuality": $0.matchQuality.rawValue,
            ] })
          } catch {
            result(FlutterError(code: "DLN_ERROR", message: "\(error)", details: nil))
          }
        }
      case "resetDeferredDeepLink":
        DeepLinkNow.resetDeferredDeepLink()
        result(nil)
      default:
        result(FlutterMethodNotImplemented)
      }
    }

    GeneratedPluginRegistrant.register(with: self)
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
```

## 5. Android side (`MainActivity.kt`)

```kotlin
import com.deeplinknow.DLN
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.launch

class MainActivity : FlutterActivity() {
    private val scope = MainScope()

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "com.deeplinknow/sdk")
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "initialize" -> {
                        val apiKey = call.argument<String>("apiKey")
                        if (apiKey == null) {
                            result.error("INVALID_ARGUMENT", "apiKey is required", null)
                        } else {
                            DLN.init(applicationContext, apiKey, onComplete = { r ->
                                result.success(r.isSuccess)
                            })
                        }
                    }
                    "checkDeferredDeepLink" -> scope.launch {
                        // Install Referrer first, then fingerprint
                        DLN.checkDeferredDeepLink(minConfidence = call.argument<Double>("minConfidence"))
                            .onSuccess { link ->
                                result.success(link?.let {
                                    mapOf(
                                        "path" to it.path,
                                        "fullPath" to it.fullPath,
                                        "url" to it.url,
                                        "queryParams" to it.queryParams.mapValues { (_, v) -> v.toPlain() },
                                        "source" to it.source.value,
                                        "confidenceScore" to it.confidenceScore,
                                        "matchQuality" to it.matchQuality.name,
                                    )
                                })
                            }
                            .onFailure { result.error("DLN_ERROR", it.message, null) }
                    }
                    "resetDeferredDeepLink" -> {
                        DLN.resetDeferredDeepLink()
                        result.success(null)
                    }
                    else -> result.notImplemented()
                }
            }
    }
}
```

## 6. Use it in your app

```dart
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await DeepLinkNowChannel.initialize('dln_pub_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');

  final link = await DeepLinkNowChannel.checkDeferredDeepLink();
  runApp(MyApp(initialPath: link?['path'] as String?));
}
```

Each result carries `source` (`clipboard`, `referrer` or `fingerprint`), `confidenceScore` (0–100) and `matchQuality` (`HIGH`, `MEDIUM`, `LOW`). Exact sources report `100` / `HIGH`. For fingerprint results you choose the threshold; the optional `minConfidence` filter is off by default. See [how fingerprint matching works](/docs/ios#how-fingerprint-matching-works).

## Links that open the installed app

Use a Flutter package such as `app_links` to receive Universal Links / App Links, then route on the URL's path and query. To apply the same domain and parsing rules as the native SDKs, add a `parseDeepLink` method to the channel that calls `DeepLinkNow.parseLink` (iOS) or `DLN.parseDeepLink` (Android).

## Need Help?

- Email: support@deeplinknow.com
- [iOS SDK](/docs/ios) · [Android SDK](/docs/android)