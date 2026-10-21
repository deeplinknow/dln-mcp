<!-- Paste this into your repository's AGENTS.md (or CLAUDE.md, .cursor/rules, .windsurfrules). -->

## Deep linking: DeepLinkNow

This app uses [DeepLinkNow](https://deeplinknow.com) for deep links and deferred deep links. The DeepLinkNow MCP server (`npx -y @deeplinknow/mcp`) has the docs and checks; use its tools instead of guessing.

- **Link domain:** `<alias>.deeplinknow.com` (replace with ours). Any path and query on it is a deep link; nothing has to be created in a dashboard first. `https://<alias>.deeplinknow.com/products/123?ref=email` reaches the app as `path: "/products/123"`, `queryParams: { ref: "email" }`.
- **Keys:** the app contains only the **public** key (`dln_pub_…`). The private key (`dln_priv_…`) is for servers and the MCP server's `DEEPLINKNOW_API_KEY`; never commit it or ship it in the app.
- **SDK calls:** initialize once at launch; call `checkDeferredDeepLink()` once on launch and route to `link.path` with `link.queryParams` through the app's normal router; send links that open the installed app (Universal Links / App Links) through the SDK's parse method (`parseLink` on iOS, `parseDeepLink` on Android and React Native) and the same router.
- **Fingerprint matches are scored.** `source` is `referrer` or `clipboard` (exact) or `fingerprint` (scored: `confidenceScore` 0-100, `matchQuality` HIGH / MEDIUM / LOW). `minConfidence` is off by default; decide how to treat MEDIUM and LOW (use `explain_match_result`).
- **Setup or changes:** `get_setup_guide` for the platform. After touching entitlements, intent filters or the domain, run `check_domain` on the link domain.
- **Questions:** `search_docs` before answering from memory.
- DeepLinkNow does deep linking only. Don't add attribution, ad tracking or advertising IDs for it.
