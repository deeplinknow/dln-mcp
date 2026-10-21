import { beforeEach, describe, expect, it } from "vitest";
import { resetDocCache } from "../lib/docs.js";
import { DLN_CODE, PLATFORMS } from "../lib/platforms.js";
import { migrationPlan, SOURCES, VENDORS } from "../tools/migrate.js";
import { callTool, makeDeps } from "./helpers/fakes.js";

beforeEach(() => resetDocCache());

describe("migrate_from", () => {
  it("MCP-50: returns a plan with find, set up, map, replace and verify steps for every source and platform", () => {
    for (const source of SOURCES) {
      for (const platform of PLATFORMS) {
        const plan = migrationPlan(source, platform);
        for (const heading of [
          "## 1. Find the current integration",
          "## 2. Set up DeepLinkNow",
          "## 3. Map your links",
          "## 4. Replace the code",
          "## 5. Verify",
        ]) {
          expect(plan, `${source}/${platform}`).toContain(heading);
        }
        expect(plan).toContain("git grep -n -i -E");
        expect(plan).toContain("```diff");
      }
    }
  });

  it("MCP-51: the diff uses the DeepLinkNow 1.2 SDK calls and only ever the public key", () => {
    const calls: Record<string, string[]> = {
      android: [
        "DLN.init(this,",
        "DLN.checkDeferredDeepLink()",
        "DLN.parseDeepLink(url)",
      ],
      expo: [
        "DeepLinkNow.initialize(",
        "DeepLinkNow.checkDeferredDeepLink()",
        "DeepLinkNow.parseDeepLink(url)",
      ],
      flutter: [
        "DeepLinkNowChannel.initialize(",
        "DeepLinkNowChannel.checkDeferredDeepLink()",
      ],
      ios: [
        "DeepLinkNow.initialize(config: DLNConfig(apiKey:",
        "DeepLinkNow.checkDeferredDeepLink()",
        "DeepLinkNow.parseLink(url)",
      ],
      "react-native": [
        "DeepLinkNow.initialize(",
        "DeepLinkNow.checkDeferredDeepLink()",
        "DeepLinkNow.parseDeepLink(url)",
      ],
    };
    for (const platform of PLATFORMS) {
      const plan = migrationPlan("branch", platform);
      for (const call of calls[platform] ?? []) {
        expect(plan, platform).toContain(call);
      }
      expect(DLN_CODE[platform].code).toContain("dln_pub_");
      expect(plan).not.toMatch(/dln_priv_[a-z0-9]/i);
      expect(plan).toContain(
        "Use the **public** key (`dln_pub_…`) in the app, never the private one."
      );
    }
    expect(migrationPlan("adjust", "expo")).toContain(
      '["@deeplinknow/react-native", { "domains": ["<alias>.deeplinknow.com"] }]'
    );
  });

  it("MCP-52: Firebase plans keep long links by swapping the host and include the Firebase migration guide", async () => {
    const res = await callTool(makeDeps(), "migrate_from", {
      platform: "react-native",
      source: "firebase-dynamic-links",
    });
    expect(res.isError).toBeFalsy();
    expect(res.text).toContain("shut down on 2025-08-25");
    expect(res.text).toContain("`https://<alias>.deeplinknow.com/?link=…`");
    expect(res.text).toContain("queryParams.link");
    expect(res.text).toContain(
      "npm uninstall @react-native-firebase/dynamic-links"
    );
    expect(res.text).toContain(
      "- dynamicLinks().onLink((link) => handle(link.url));"
    );
    expect(res.text).toContain("# Migrating from Firebase Dynamic Links");
    expect(res.structuredContent).toMatchObject({ guideSource: "bundled" });
    expect(migrationPlan("firebase-dynamic-links", "flutter")).toContain(
      "-  firebase_dynamic_links: …"
    );
  });

  it("MCP-53: attribution vendors are kept for attribution; only the deep linking moves", () => {
    for (const source of ["branch", "appsflyer", "adjust"] as const) {
      const plan = migrationPlan(source, "ios");
      expect(plan).toContain(
        `**If the app uses ${VENDORS[source].name} for attribution or ad measurement, keep it for that.**`
      );
    }
    expect(migrationPlan("firebase-dynamic-links", "ios")).not.toContain(
      "attribution or ad measurement, keep it"
    );
    for (const source of SOURCES) {
      expect(migrationPlan(source, "android")).toContain(
        "No attribution, ad tracking or advertising IDs."
      );
    }
  });

  it("MCP-54: every claim about another vendor is dated or names its source", () => {
    for (const source of ["branch", "appsflyer", "adjust"] as const) {
      for (const note of VENDORS[source].notes) {
        expect(note, source).toMatch(/20\d\d-\d\d-\d\d/);
      }
    }
    expect(VENDORS.branch.links[0]).toMatch(/checked 2026-10-19/);
  });

  it("MCP-55: names a package to remove only where the research names it, and is generic otherwise", () => {
    expect(migrationPlan("branch", "react-native")).toContain(
      "npm uninstall react-native-branch"
    );
    expect(migrationPlan("appsflyer", "expo")).toContain(
      "npm uninstall react-native-appsflyer"
    );
    const adjust = migrationPlan("adjust", "react-native");
    expect(adjust).toContain(
      "Remove the Adjust SDK dependency (package.json)."
    );
    expect(migrationPlan("branch", "ios")).toContain(
      "Remove the Branch SDK dependency (Swift Package Manager or Podfile)."
    );
    expect(migrationPlan("branch", "ios")).toContain(
      "- // Branch: SDK initialization, its deep link / deferred deep link listener,"
    );
  });
});
