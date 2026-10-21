<!--
Draft copy for a public docs page, e.g. /docs/mcp ("Set up DeepLinkNow with your coding agent").
Not wired into web/. If it ships: add it to MARKDOWN_DOCS in web/utils/markdown-twins.ts (so it gets a .md twin and an llms.txt entry), the sitemap and the docs nav.
-->

# Set up DeepLinkNow with your coding agent

If you build your app with Claude Code, Cursor, VS Code or Windsurf, you can let the agent do the DeepLinkNow integration. Install the DeepLinkNow MCP server and the agent gets our docs, a domain checker and a migration planner as tools, so it writes the integration from the current docs instead of from memory.

## Install

Claude Code:

```sh
claude mcp add deeplinknow -- npx -y @deeplinknow/mcp
```

Cursor (`.cursor/mcp.json`), Windsurf (`~/.codeium/windsurf/mcp_config.json`) and other clients that take an `mcpServers` file:

```json
{
  "mcpServers": {
    "deeplinknow": { "command": "npx", "args": ["-y", "@deeplinknow/mcp"] }
  }
}
```

VS Code (`.vscode/mcp.json`):

```json
{
  "servers": {
    "deeplinknow": { "type": "stdio", "command": "npx", "args": ["-y", "@deeplinknow/mcp"] }
  }
}
```

It needs Node.js 20 or later and runs on your machine.

## Then ask

> Add DeepLinkNow deferred deep linking to this app. Our link domain is myapp.deeplinknow.com.

The agent reads the setup guide for your platform, installs the SDK, adds the Associated Domains entitlement and the Android intent filter, calls `checkDeferredDeepLink()` on launch and routes the result through your existing router. Then it checks your domain.

Other things to ask:

- "Check myapp.deeplinknow.com" (or your custom domain). It validates `apple-app-site-association` against Apple's CDN copy, `assetlinks.json` against Google's Digital Asset Links API, and looks the domain up on the EasyPrivacy and AdGuard block lists. It works for any domain, so you can also check the one you use today.
- "We're on Firebase Dynamic Links. Move us to DeepLinkNow." Branch, AppsFlyer and Adjust work too. You get a plan and a code diff for your platform. If you use one of those for attribution, the plan keeps it for that and moves only the deep links.
- "This match came back MEDIUM with a score of 58. Should we route it?" The agent explains each part of the score and what a `minConfidence` of 50 or 75 would do. The threshold is still your call.

## What the agent can use

| Tool | Does |
|---|---|
| `get_setup_guide` | Setup and code for iOS, Android, React Native, Expo or Flutter |
| `search_docs` | Searches all DeepLinkNow docs |
| `check_domain` | AASA, assetlinks and ad-block list checks for a domain |
| `explain_match_result` | Explains `confidenceScore`, `matchQuality` and `minConfidence` |
| `migrate_from` | Plan and code diff from Firebase Dynamic Links, Branch, AppsFlyer or Adjust |
| `list_links`, `create_link` | Your app's links, through the management API |

None of the first five needs an account or a key.

## Managing links (optional)

You never have to create links: any path on your link domain already works. If you want the agent to list links or create ones with a custom preview, give the server your app's **private** key (`dln_priv_…`, from the app's API Keys page) as `DEEPLINKNOW_API_KEY`. The management API is on the Startup plan and up ([pricing](https://deeplinknow.com/pricing)).

```sh
claude mcp add deeplinknow --scope user --env DEEPLINKNOW_API_KEY=YOUR_PRIVATE_KEY -- npx -y @deeplinknow/mcp
```

The private key stays in your MCP config. Your app only ever contains the public key (`dln_pub_…`).

## Keep agents on track

Paste this into your repo's `AGENTS.md` or `CLAUDE.md` so every session knows the rules:

```markdown
## Deep linking: DeepLinkNow

- Link domain: myapp.deeplinknow.com. Any path and query on it is a deep link; nothing has to be created first.
- The app contains only the public key (dln_pub_…). Never commit or ship the private key.
- Initialize once at launch. Call checkDeferredDeepLink() once on launch and route to link.path with link.queryParams. Send links that open the installed app through the SDK's parse method and the same router.
- Fingerprint matches are scored (confidenceScore, matchQuality). minConfidence is off by default; decide how to treat MEDIUM and LOW.
- Use the DeepLinkNow MCP tools (get_setup_guide, check_domain, search_docs) instead of guessing.
```

## Privacy

The server sends nothing about your code anywhere. It fetches our public docs from deeplinknow.com, and `check_domain` fetches only the domain you name, Apple's CDN, Google's API and the public block lists. It has no telemetry and stores nothing on disk. The link tools send your key and the link fields to the DeepLinkNow API.

The source is MIT licensed: [npm](https://www.npmjs.com/package/@deeplinknow/mcp).
