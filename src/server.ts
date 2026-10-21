/**
 * The DeepLinkNow MCP server (docs/sdks/mcp.md): tools, resources and
 * prompts, with every outside dependency injected (MCP-40).
 */
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type Deps, defaultDeps } from "./lib/deps.js";
import { DOC_PAGES, type DocSlug, getDoc } from "./lib/docs.js";
import { PLATFORMS } from "./lib/platforms.js";
import { VERSION } from "./lib/version.js";
import { checkDomain, checkDomainInput } from "./tools/check-domain.js";
import { explainMatch, explainMatchInput } from "./tools/explain-match.js";
import {
  createLink,
  createLinkInput,
  listLinks,
  listLinksInput,
} from "./tools/links.js";
import { migrateFrom, migrateInput, SOURCES } from "./tools/migrate.js";
import { searchDocs, searchDocsInput } from "./tools/search-docs.js";
import { getSetupGuide, setupGuideInput } from "./tools/setup-guide.js";

export type { Deps } from "./lib/deps.js";
export { defaultDeps } from "./lib/deps.js";

export const INSTRUCTIONS = `DeepLinkNow (deeplinknow.com) does deep linking only: Universal Links and App Links on the app's domain, and deferred deep links that survive an install. No attribution, ad tracking or advertising IDs. Any path and query on the app's link domain (<alias>.deeplinknow.com or a custom domain) already works as a deep link; nothing has to be created first. After install, the SDK's checkDeferredDeepLink() returns the path and query the user tapped.

To add DeepLinkNow to an app: call get_setup_guide with the platform, follow it, then check_domain on the link domain. To replace Firebase Dynamic Links, Branch, AppsFlyer or Adjust: migrate_from. For questions: search_docs. To interpret confidence_score / match_quality or choose minConfidence: explain_match_result. list_links and create_link need a private key in DEEPLINKNOW_API_KEY (paid plans). The app itself must only ever contain the public key (dln_pub_…).`;

const READ_ONLY = {
  destructiveHint: false,
  idempotentHint: true,
  readOnlyHint: true,
} as const;

export function createServer(deps: Deps = defaultDeps()): McpServer {
  const server = new McpServer(
    { name: "deeplinknow", title: "DeepLinkNow", version: VERSION },
    { instructions: INSTRUCTIONS }
  );

  server.registerTool(
    "get_setup_guide",
    {
      annotations: { ...READ_ONLY, openWorldHint: true },
      description:
        "Step-by-step setup and code for adding DeepLinkNow deferred deep linking to an iOS, Android, React Native, Expo or Flutter app: dashboard settings, SDK install, Associated Domains / App Links, initialize, checkDeferredDeepLink and handling links that open the installed app. Fetched live from deeplinknow.com's markdown docs, with a bundled copy when offline. Call this before writing integration code.",
      inputSchema: setupGuideInput,
      title: "Get the DeepLinkNow setup guide",
    },
    (args) => getSetupGuide(args, deps)
  );

  server.registerTool(
    "search_docs",
    {
      annotations: { ...READ_ONLY, openWorldHint: true },
      description:
        "Keyword search across DeepLinkNow's full documentation (SDK docs for iOS, Android, React Native and Flutter, the integration checklist, pricing and comparisons). Returns the best-matching sections with their page URLs. Use it for specific questions such as error codes, options, plan limits or the paste prompt.",
      inputSchema: searchDocsInput,
      title: "Search the DeepLinkNow docs",
    },
    (args) => searchDocs(args, deps)
  );

  server.registerTool(
    "check_domain",
    {
      annotations: { ...READ_ONLY, openWorldHint: true },
      description:
        "Checks a link domain the way iOS and Android will: the apple-app-site-association file (and Apple's CDN copy), the assetlinks.json file (and Google's Digital Asset Links verdict), and whether the domain or its CNAME chain is on the EasyPrivacy or AdGuard block lists that ad blockers use. Works for any domain, not only DeepLinkNow's. Runs on this machine: it fetches only https://<domain>/.well-known/*, Apple's CDN, Google's API and the block lists, and refuses domains that resolve to private addresses.",
      inputSchema: checkDomainInput,
      title: "Check a deep link domain",
    },
    (args) => checkDomain(args, deps)
  );

  server.registerTool(
    "explain_match_result",
    {
      annotations: { ...READ_ONLY, openWorldHint: false },
      description:
        "Explains a DeepLinkNow fingerprint match: what confidence_score and match_quality (HIGH/MEDIUM/LOW) mean, which components (IP 40, device 30, time 20, locale 10) scored and why, and how to choose the SDK's minConfidence threshold. Pass the /sdk/match JSON, a DeferredDeepLink, or just a score. Works offline.",
      inputSchema: explainMatchInput,
      title: "Explain a deferred deep link match",
    },
    (args) => explainMatch(args)
  );

  server.registerTool(
    "migrate_from",
    {
      annotations: { ...READ_ONLY, openWorldHint: true },
      description: `A concrete plan and code diff for moving an app's deep linking from ${SOURCES.join(", ")} to DeepLinkNow, for one platform: how to find the current integration, set up DeepLinkNow, map existing links, replace the code and verify. Attribution isn't migrated: DeepLinkNow does deep linking only.`,
      inputSchema: migrateInput,
      title: "Plan a migration to DeepLinkNow",
    },
    (args) => migrateFrom(args, deps)
  );

  server.registerTool(
    "list_links",
    {
      annotations: { ...READ_ONLY, openWorldHint: true },
      description:
        "Lists the deep links of the app that DEEPLINKNOW_API_KEY (a private key) belongs to, newest first, with their short URLs: links created in the dashboard or API, and on-demand links created when a path was first visited. Optional text search, campaign filter and paging. Needs a paid plan with management API access.",
      inputSchema: listLinksInput,
      title: "List DeepLinkNow links",
    },
    (args) => listLinks(args, deps)
  );

  server.registerTool(
    "create_link",
    {
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
        readOnlyHint: false,
      },
      description:
        "Creates a link in the app that DEEPLINKNOW_API_KEY (a private key) belongs to, with an optional custom path, link-page title and button texts, social preview, metadata and campaign. Creating links is optional: any path on the link domain already works. Use this for a custom preview or to group links in a campaign. Counts toward the plan's link limit. Needs a paid plan with management API access.",
      inputSchema: createLinkInput,
      title: "Create a DeepLinkNow link",
    },
    (args) => createLink(args, deps)
  );

  registerResources(server, deps);
  registerPrompts(server);
  return server;
}

const RESOURCE_DOCS: DocSlug[] = [
  "quickstart",
  "ios",
  "android",
  "react-native",
  "flutter",
  "firebase-migration",
  "integration-checklist",
];

function registerResources(server: McpServer, deps: Deps) {
  server.registerResource(
    "llms-txt",
    "deeplinknow://llms.txt",
    {
      description: "The index of DeepLinkNow's docs for AI assistants.",
      mimeType: "text/plain",
      title: "DeepLinkNow llms.txt",
    },
    async (uri) => {
      const doc = await getDoc("llms", deps);
      return {
        contents: [{ mimeType: "text/plain", text: doc.text, uri: uri.href }],
      };
    }
  );

  server.registerResource(
    "docs",
    new ResourceTemplate("deeplinknow://docs/{page}", {
      list: () => ({
        resources: RESOURCE_DOCS.map((slug) => ({
          mimeType: "text/markdown",
          name: `DeepLinkNow docs: ${slug}`,
          uri: `deeplinknow://docs/${slug}`,
        })),
      }),
    }),
    {
      description: `A DeepLinkNow docs page as markdown. Pages: ${RESOURCE_DOCS.join(", ")}.`,
      mimeType: "text/markdown",
      title: "DeepLinkNow docs page",
    },
    async (uri, { page }) => {
      const slug = String(page);
      if (!(RESOURCE_DOCS as string[]).includes(slug) || !(slug in DOC_PAGES)) {
        throw new Error(
          `Unknown docs page "${slug}". Pages: ${RESOURCE_DOCS.join(", ")}.`
        );
      }
      const doc = await getDoc(slug as DocSlug, deps);
      return {
        contents: [
          { mimeType: "text/markdown", text: doc.text, uri: uri.href },
        ],
      };
    }
  );
}

function registerPrompts(server: McpServer) {
  server.registerPrompt(
    "add_deferred_deep_linking",
    {
      argsSchema: {
        platform: z
          .enum(PLATFORMS)
          .describe("ios, android, react-native, expo or flutter"),
      },
      description:
        "Walks a coding agent through adding DeepLinkNow to this app, end to end.",
      title: "Add DeepLinkNow deferred deep linking",
    },
    ({ platform }) => ({
      messages: [
        {
          content: {
            text: `Add DeepLinkNow deferred deep linking to this ${platform} app.
1. Call get_setup_guide with platform "${platform}" and follow it.
2. Initialize the SDK once at launch with the public key (dln_pub_…). Read it from config; never put the private key in the app.
3. Call checkDeferredDeepLink() once on launch and route to link.path with link.queryParams using the app's existing router.
4. Handle links that open the installed app with the SDK's parse method, through the same routing code.
5. Add the Associated Domains entitlement and the Android App Links intent filter for the link domain.
6. Ask me for the app's alias if you can't find it, then run check_domain on <alias>.deeplinknow.com.
7. Use explain_match_result to choose how to treat MEDIUM and LOW fingerprint matches.`,
            type: "text",
          },
          role: "user",
        },
      ],
    })
  );

  server.registerPrompt(
    "migrate_to_deeplinknow",
    {
      argsSchema: {
        platform: z
          .enum(PLATFORMS)
          .describe("ios, android, react-native, expo or flutter"),
        source: z.enum(SOURCES).describe(SOURCES.join(", ")),
      },
      description:
        "Replaces Firebase Dynamic Links, Branch, AppsFlyer or Adjust deep linking with DeepLinkNow in this app.",
      title: "Migrate to DeepLinkNow",
    },
    ({ source, platform }) => ({
      messages: [
        {
          content: {
            text: `Move this ${platform} app's deep linking from ${source} to DeepLinkNow. Call migrate_from with source "${source}" and platform "${platform}", show me the plan, then apply it step by step. Keep ${source} if the app uses it for attribution; replace only the deep linking.`,
            type: "text",
          },
          role: "user",
        },
      ],
    })
  );
}
