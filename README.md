# @deeplinknow/mcp

The [DeepLinkNow](https://deeplinknow.com) MCP server. It lets coding agents (Claude Code, Cursor, VS Code, Windsurf and any other MCP client) add deferred deep linking to an iOS, Android, React Native, Expo or Flutter app, check a link domain's Universal Links and App Links setup, and migrate from Firebase Dynamic Links, Branch, AppsFlyer or Adjust.

DeepLinkNow does deep linking only: Universal Links and App Links on your domain, and deferred deep links that survive an install. No attribution, ad tracking or advertising IDs. Any path on your link domain already works as a deep link.

## Tools

| Tool | Needs a key | What it does |
|---|---|---|
| `get_setup_guide` | No | Setup steps and code for `ios`, `android`, `react-native`, `expo` or `flutter`, from the live docs (bundled copy when offline) |
| `search_docs` | No | Searches the full DeepLinkNow docs and returns the matching sections with links |
| `check_domain` | No | Checks a domain's `apple-app-site-association` (and Apple's CDN copy), `assetlinks.json` (and Google's verdict), and whether the domain or its CNAME chain is on the EasyPrivacy or AdGuard block lists. Works for any domain |
| `explain_match_result` | No | Explains a fingerprint match's `confidence_score` and `match_quality`, and how to choose `minConfidence` |
| `migrate_from` | No | A migration plan and code diff from `firebase-dynamic-links`, `branch`, `appsflyer` or `adjust` |
| `list_links` | Private key, paid plan | Lists the app's links (dashboard, API and on-demand), with search and paging |
| `create_link` | Private key, paid plan | Creates a link with a custom path, link-page text, social preview, metadata or campaign |

It also exposes `deeplinknow://llms.txt` and `deeplinknow://docs/{page}` as resources, and two prompts: `add_deferred_deep_linking` and `migrate_to_deeplinknow`.

## Install

Requires Node.js 20 or later. The server runs locally over stdio.

### Claude Code

```sh
claude mcp add deeplinknow -- npx -y @deeplinknow/mcp
```

With the link tools (`--scope user` keeps the key out of the project's `.mcp.json`):

```sh
claude mcp add deeplinknow --scope user --env DEEPLINKNOW_API_KEY=YOUR_PRIVATE_KEY -- npx -y @deeplinknow/mcp
```

### Cursor

Add to `.cursor/mcp.json` in the project, or `~/.cursor/mcp.json` for every project:

```json
{
  "mcpServers": {
    "deeplinknow": {
      "command": "npx",
      "args": ["-y", "@deeplinknow/mcp"],
      "env": { "DEEPLINKNOW_API_KEY": "${env:DEEPLINKNOW_API_KEY}" }
    }
  }
}
```

Leave out `env` if you don't need the link tools.

### VS Code

Add to `.vscode/mcp.json`. VS Code asks for the key once and stores it securely:

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "deeplinknow-api-key",
      "description": "DeepLinkNow private API key (dln_priv_…), only for list_links and create_link. Leave empty otherwise.",
      "password": true
    }
  ],
  "servers": {
    "deeplinknow": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@deeplinknow/mcp"],
      "env": { "DEEPLINKNOW_API_KEY": "${input:deeplinknow-api-key}" }
    }
  }
}
```

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "deeplinknow": {
      "command": "npx",
      "args": ["-y", "@deeplinknow/mcp"],
      "env": { "DEEPLINKNOW_API_KEY": "YOUR_PRIVATE_KEY" }
    }
  }
}
```

Leave out `env` if you don't need the link tools. This file is in your home directory, so the key isn't committed with your project.

### Other clients

Any MCP client that runs stdio servers: command `npx`, arguments `-y @deeplinknow/mcp`.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `DEEPLINKNOW_API_KEY` | unset | Your app's **private** key (`dln_priv_…`) from the app's API Keys page in the [dashboard](https://deeplinknow.com/dashboard). Only `list_links` and `create_link` use it. The management API is on paid plans ([pricing](https://deeplinknow.com/pricing)). A private key is scoped to one app. |
| `DEEPLINKNOW_API_URL` | `https://deeplinknow.com` | API base URL. Must be https (http only for localhost). |

Never put the private key in your app: the app uses the public key (`dln_pub_…`). The server never prints, logs or returns the key; it only sends it in the `x-api-key` header to the API.

## Tell your agent about it

Paste [AGENTS.md](./AGENTS.md) into your repo's `AGENTS.md` or `CLAUDE.md` so every agent session knows how to use DeepLinkNow.

## Privacy Policy

- **What it sends, and where.** `get_setup_guide`, `search_docs`, `migrate_from` and the resources fetch public docs from `https://deeplinknow.com`. `check_domain` fetches only `https://<the domain you give it>/.well-known/…`, Apple's CDN (`app-site-association.cdn-apple.com`), Google's Digital Asset Links API and the four public block lists; it refuses domains that resolve to private or local addresses. `list_links` and `create_link` send your API key and the link fields you give them to the DeepLinkNow API. `explain_match_result` makes no requests.
- **What it stores.** Nothing on disk. Docs, block lists and check results are cached in memory while the server runs (docs for an hour, block lists for a day, domain results for 5 minutes).
- **No telemetry.** The server collects no usage data and has no analytics.
- DeepLinkNow's own data handling is in the [privacy policy](https://deeplinknow.com/privacy). Questions: [deeplinknow.com](https://deeplinknow.com).

## Develop

```sh
pnpm install
pnpm test        # vitest, network mocked
pnpm typecheck
pnpm lint        # Ultracite (Biome)
pnpm build       # dist/, runnable with node dist/index.js
pnpm smoke       # starts dist/index.js over stdio and lists the tools
```

The spec, with requirement IDs (`MCP-…`) that the tests cite, is `docs/sdks/mcp.md` in the DeepLinkNow repository.

## License

MIT
