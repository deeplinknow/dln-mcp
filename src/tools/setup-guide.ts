/**
 * get_setup_guide (MCP-20..23): the setup steps and code for one platform,
 * from the live `.md` docs twin, with the bundled snapshot as a fallback.
 */
import { z } from "zod";
import type { Deps } from "../lib/deps.js";
import { type Doc, getDoc, sourceLine } from "../lib/docs.js";
import {
  PLATFORM_DOC,
  PLATFORM_LABEL,
  PLATFORMS,
  type Platform,
} from "../lib/platforms.js";
import { ok } from "../lib/result.js";

export const setupGuideInput = {
  platform: z
    .enum(PLATFORMS)
    .describe(
      "The app's platform. Use react-native for bare React Native, expo for Expo (development builds), flutter for Flutter (which calls the native SDKs through a platform channel)."
    ),
};

const BEFORE_YOU_START = `## Before you start (once per app)

1. Create an app at https://deeplinknow.com/dashboard. It gets the link domain \`<alias>.deeplinknow.com\`.
2. In the app's settings, enter the iOS Team ID and Bundle ID and the Android package name and SHA-256 signing certificate fingerprints. DeepLinkNow serves \`apple-app-site-association\` and \`assetlinks.json\` from them (live within 5 minutes).
3. Use the app's **public** key (\`dln_pub_…\`) in the app. The private key (\`dln_priv_…\`) is for servers only and must never ship in an app. The demo key \`test_api_key\` returns mock responses if you want to try the SDK first.
4. Any path and query on the link domain already works as a deep link: \`https://<alias>.deeplinknow.com/products/123?ref=newsletter\` delivers \`/products/123\` and \`{ ref: "newsletter" }\` to the app. Nothing has to be created first.
5. When the domain is set up, run the \`check_domain\` tool on \`<alias>.deeplinknow.com\` (or your custom domain) to verify the AASA and assetlinks files.`;

/** The Expo guide is the React Native page without its bare-React-Native install section. */
export function expoOnly(markdown: string): string {
  return markdown.replace(/\n### Bare React Native\n[\s\S]*?(?=\n## )/, "\n");
}

export function renderGuide(platform: Platform, doc: Doc): string {
  const body = platform === "expo" ? expoOnly(doc.text) : doc.text;
  return [
    `# DeepLinkNow setup: ${PLATFORM_LABEL[platform]}`,
    "",
    sourceLine(doc),
    "",
    BEFORE_YOU_START,
    "",
    "---",
    "",
    body.trim(),
    "",
    "---",
    "",
    "Before shipping, go through the integration checklist: https://deeplinknow.com/docs/integration-checklist.md",
  ].join("\n");
}

export async function getSetupGuide(
  args: { platform: Platform },
  deps: Pick<Deps, "fetch" | "now">
) {
  const doc = await getDoc(PLATFORM_DOC[args.platform], deps);
  return ok(renderGuide(args.platform, doc), {
    platform: args.platform,
    source: doc.source,
    url: doc.url,
  });
}
