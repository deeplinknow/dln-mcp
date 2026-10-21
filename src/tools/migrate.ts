/**
 * migrate_from (MCP-50..55): a migration plan and code diff from Firebase
 * Dynamic Links, Branch, AppsFlyer or Adjust to DeepLinkNow. Facts about the
 * other vendors come only from docs/research (competitors-2026-10.md,
 * feature-matrix-2026-10.md), with their dates; everything else is
 * DeepLinkNow's own behaviour.
 */
import { z } from "zod";
import type { Deps } from "../lib/deps.js";
import { getDoc, sourceLine } from "../lib/docs.js";
import {
  DLN_CODE,
  INSTALL,
  PLATFORM_LABEL,
  PLATFORMS,
  type Platform,
} from "../lib/platforms.js";
import { ok } from "../lib/result.js";

export const SOURCES = [
  "firebase-dynamic-links",
  "branch",
  "appsflyer",
  "adjust",
] as const;
export type Source = (typeof SOURCES)[number];

export const migrateInput = {
  platform: z
    .enum(PLATFORMS)
    .describe("The app's platform, for the code diff."),
  source: z
    .enum(SOURCES)
    .describe("The deep linking product the app uses today."),
};

interface VendorFacts {
  /** Is it also an attribution platform? (DLN replaces only the deep linking.) */
  attribution: boolean;
  /** What the vendor's links look like, with sources and dates. */
  links: string[];
  name: string;
  /** Sourced context worth knowing before the switch. */
  notes: string[];
  /** Package names to remove, where docs/research names them. */
  packages: Partial<Record<Platform, string>>;
  /** Strings to grep for when inventorying the current integration. */
  search: string[];
}

export const VENDORS: Record<Source, VendorFacts> = {
  adjust: {
    attribution: true,
    links: [
      "Adjust links (`adj.st` or a branded domain) are created in Adjust first. On DeepLinkNow, put the path and query straight on your link domain: `https://<alias>.deeplinknow.com/<path>?<query>`, with no link creation; the app receives `path` and `queryParams`.",
      "Links on Adjust's domains keep resolving through Adjust. Re-issue the links you control.",
    ],
    name: "Adjust",
    notes: [
      "`||adj.st^` is on AdGuard Tracking Protection (checked 2026-10-19), so the link domain itself is blocked for those users. Run `check_domain adj.st` (or your branded domain) to see it.",
      "Adjust documents that deferred deep linking may be limited for users who opt out of ATT, and its LinkMe clipboard flow works in Safari only (help.adjust.com, checked 2026-10-20). DeepLinkNow needs no ATT prompt.",
    ],
    packages: {},
    search: ["adjust", "adj.st"],
  },
  appsflyer: {
    attribution: true,
    links: [
      "OneLink links (`onelink.me` or a branded domain) are created in AppsFlyer first. On DeepLinkNow, put the path and query straight on your link domain: `https://<alias>.deeplinknow.com/<path>?<query>`, with no link creation. Values you passed as OneLink parameters go in the query string; the app receives them in `queryParams`.",
      "Links on AppsFlyer's domains keep resolving through AppsFlyer. Re-issue the links you control.",
    ],
    name: "AppsFlyer OneLink",
    notes: [
      "AppsFlyer's free Zero plan no longer includes deferred deep linking since its 2026 update; branded domains start on a custom-priced tier (appsflyer.com/pricing/deep-linking, checked 2026-10-20).",
      "As of 2026-10-19, AdGuard Tracking Protection has more than 50 AppsFlyer and OneLink rules (e.g. `||onelink.me^$3p`). Run `check_domain` on your current link domain to compare.",
    ],
    packages: {
      expo: "react-native-appsflyer",
      "react-native": "react-native-appsflyer",
    },
    search: ["appsflyer", "onelink"],
  },
  branch: {
    attribution: true,
    links: [
      'Branch links live on `app.link`, `bnc.lt` or a custom domain. Custom-domain long links need `/a/key_live_…`, and path routing through `$deeplink_path` "requires custom logic" (Branch help center, checked 2026-10-19).',
      "On DeepLinkNow, put the path and query straight on your link domain: `https://<alias>.deeplinknow.com/<path>?<query>`. Nothing has to be created first; the app receives `path` and `queryParams`. Data you stored in Branch link data goes in the query string.",
      "Links on Branch's domains, or on a domain that still points to Branch, keep resolving through Branch, not DeepLinkNow. Re-issue the links you control (emails, QR codes, your site). A custom domain can be moved to DeepLinkNow (paid plans); once it points to DeepLinkNow, old paths on it reach your app as plain paths, because any path works.",
    ],
    name: "Branch",
    notes: [
      "As of 2026-10-19, EasyPrivacy lists about 4,195 and AdGuard's CNAME list about 6,040 Branch customer link domains, and `||branch.io^$third-party` rules exist. Run `check_domain` on your current link domain to see whether it is listed.",
    ],
    packages: {
      expo: "react-native-branch",
      "react-native": "react-native-branch",
    },
    search: ["branch", "app.link", "bnc.lt", "$deeplink_path"],
  },
  "firebase-dynamic-links": {
    attribution: false,
    links: [
      "Firebase Dynamic Links shut down on 2025-08-25: every `page.link` URL returns 404 and the `.page.link` domains are gone. Nobody can bring those URLs back.",
      "**Long links you build in code** (`https://yourapp.page.link/?link=…&apn=…&ibi=…`) work on your DeepLinkNow domain with only the host changed: `https://<alias>.deeplinknow.com/?link=…`. The app gets the Firebase-style `link` parameter back, decoded, in `queryParams.link`. All long links on `/` count as one link against the plan's limit, because it counts distinct paths.",
      "`apn`, `ibi`, `isi` and `efr` aren't needed (harmless to leave in). `afl`, `ifl` and `ofl` fallback URLs aren't followed: phones go to the store, desktop gets a QR code. `st`, `sd` and `si` aren't read: set the social preview in the dashboard (paid plans).",
      '**Short links** (`yourapp.page.link/abc`) have no equivalent: use a path instead, e.g. `https://<alias>.deeplinknow.com/invite/8Fk2`, which the app receives as `path: "/invite/8Fk2"`.',
    ],
    name: "Firebase Dynamic Links",
    notes: [
      "Firebase Auth email-link sign-in used Dynamic Links; DeepLinkNow doesn't handle sign-in links (Firebase has its own replacement for that flow).",
      "Firebase reported clicks into Google Analytics. DeepLinkNow shows click and install counts and hands the app the link; forward it to your own analytics.",
    ],
    packages: {
      expo: "@react-native-firebase/dynamic-links",
      flutter: "firebase_dynamic_links",
      "react-native": "@react-native-firebase/dynamic-links",
    },
    search: [
      "page.link",
      "dynamic-links",
      "dynamic_links",
      "dynamicLinks",
      "DynamicLinks",
    ],
  },
};

function diff(source: Source, platform: Platform): string {
  const v = VENDORS[source];
  const dln = DLN_CODE[platform];
  const pkg = v.packages[platform];
  const removePkg =
    platform === "flutter"
      ? pkg
        ? `# pubspec.yaml\n-  ${pkg}: …`
        : `# pubspec.yaml: remove the ${v.name} Flutter package`
      : pkg
        ? `npm uninstall ${pkg}${platform === "react-native" ? "\ncd ios && pod install" : ""}`
        : `Remove the ${v.name} SDK dependency (${platform === "ios" ? "Swift Package Manager or Podfile" : platform === "android" ? "build.gradle" : "package.json"}).`;

  const before =
    source === "firebase-dynamic-links" &&
    (platform === "react-native" || platform === "expo")
      ? `- const initial = await dynamicLinks().getInitialLink();
- if (initial) handle(initial.url);
- dynamicLinks().onLink((link) => handle(link.url));`
      : `- // ${v.name}: SDK initialization, its deep link / deferred deep link listener,
- // and any code that builds ${v.name} links (find them with the search in step 1).`;

  const after = dln.code
    .split("\n")
    .map((l) => `+ ${l}`)
    .join("\n");

  return [
    "```sh",
    removePkg,
    "```",
    "",
    "```diff",
    before,
    after,
    "```",
    "",
    `(${dln.lang}; \`router\` stands for your app's navigation.)`,
    source === "firebase-dynamic-links"
      ? "If you keep FDL-style long links (host swap), read the original link from `queryParams.link` instead of routing on `path`. The Firebase migration guide has this code for React Native, iOS and Android."
      : "",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export function migrationPlan(
  source: Source,
  platform: Platform,
  firebaseGuide?: string
): string {
  const v = VENDORS[source];
  const grep = v.search.map((s) => s.replace(/[.$]/g, "\\$&")).join("|");
  const sections = [
    `# Migrate from ${v.name} to DeepLinkNow (${PLATFORM_LABEL[platform]})`,
    "",
    "DeepLinkNow does deep linking only: Universal Links / App Links on your domain, and deferred deep links that survive an install. No attribution, ad tracking or advertising IDs.",
    v.attribution
      ? `**If the app uses ${v.name} for attribution or ad measurement, keep it for that.** DeepLinkNow replaces only the deep linking. Move the deep links, and remove ${v.name} entirely only if deep linking was all you used it for.`
      : "",
    "",
    "## 1. Find the current integration",
    "",
    "```sh",
    `git grep -n -i -E '${grep}'`,
    "```",
    "",
    "List every place that initializes the SDK, listens for (deferred) deep links, or builds links. Each one gets the replacement in step 4.",
    "",
    "## 2. Set up DeepLinkNow",
    "",
    "1. Create an app at https://deeplinknow.com/dashboard. Its link domain is `<alias>.deeplinknow.com` (a custom domain is available on paid plans).",
    "2. In the app's settings, enter the iOS Team ID and Bundle ID and the Android package name and SHA-256 fingerprints, so DeepLinkNow serves the `.well-known` files.",
    "3. Install the SDK:",
    "",
    INSTALL[platform],
    "",
    "Use the **public** key (`dln_pub_…`) in the app, never the private one.",
    "",
    "## 3. Map your links",
    "",
    ...v.links.map((l) => `- ${l}`),
    "",
    "## 4. Replace the code",
    "",
    diff(source, platform),
    "",
    "## 5. Verify",
    "",
    "- Run `check_domain` on `<alias>.deeplinknow.com` (and your custom domain): AASA, assetlinks and the ad-block lists.",
    "- Test a deferred link: uninstall the app, tap `https://<alias>.deeplinknow.com/<some/path>?x=1`, install, open: the app should land on that path. On iOS test both Allow and Don't Allow on the paste prompt (Don't Allow falls back to fingerprint matching); on Android test an install through the link page's Play Store button (Install Referrer) and one without it (fingerprint). `resetDeferredDeepLink()` repeats the test without reinstalling.",
    "- Decide your threshold for fingerprint results (`explain_match_result` explains the scores).",
    "",
    "## Good to know",
    "",
    ...v.notes.map((n) => `- ${n}`),
    "- DeepLinkNow keeps click records at most 30 days, and a deferred link can be claimed for 1 hour after the tap.",
  ];
  if (firebaseGuide) {
    sections.push("", "---", "", firebaseGuide);
  }
  return sections
    .filter((l, i, all) => !(l === "" && all[i - 1] === ""))
    .join("\n");
}

export async function migrateFrom(
  args: { source: Source; platform: Platform },
  deps: Pick<Deps, "fetch" | "now">
) {
  let guide: string | undefined;
  let guideSource: string | undefined;
  if (args.source === "firebase-dynamic-links") {
    const doc = await getDoc("firebase-migration", deps);
    guide = `${sourceLine(doc)}\n\n${doc.text.trim()}`;
    guideSource = doc.source;
  }
  return ok(migrationPlan(args.source, args.platform, guide), {
    platform: args.platform,
    source: args.source,
    ...(guideSource ? { guideSource } : {}),
  });
}
