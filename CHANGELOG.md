# Changelog

## Unreleased

- `explain_match_result` explains DeepLinkNow's scoring version 2 (deeplinknow.com since 2026-10-24): IP 40; device 27 (screen 15, OS version 12, or 6 when the browser couldn't report its real OS version), counted only when the platform and device class agree; time 18; locale 15 (time zone 10, language 5). A match with `score_version: 2` is explained on these weights, one without `score_version` (older servers, the `test_api_key` demo) on version 1, and a bare score on version 2 with a note. New optional `score_version` argument for a `DeferredDeepLink`, which doesn't carry it. `structuredContent` gives each candidate's `score_version`.
- The `minConfidence` guidance uses the version 2 numbers: an exact match without an IP match scores 60 within 5 minutes, 52 at 30 and 47 at 45, and drops below 50 about 37 minutes after the tap; one where the OS version is only inferred scores 54 and drops below 50 after about 19 minutes. The version 1 numbers are kept for apps tuned before the change.
- Bundled docs snapshot refreshed (2026-10-24): the SDK pages' scoring sections, the Firebase migration guide's short-link import, the FlutterFlow and smart banner pages in `llms.txt`, and the current `llms-full.txt`.

## 1.0.1 (2026-10-21)

- Flutter guidance uses the published `deeplinknow` plugin; bundled docs refreshed.

## 1.0.0

- First release.
