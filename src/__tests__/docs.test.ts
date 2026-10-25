import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import {
  DOC_PAGES,
  type DocSlug,
  readBundled,
  resetDocCache,
  SNAPSHOT_DATE,
} from "../lib/docs.js";
import { search, splitSections } from "../lib/search.js";
import { expoOnly } from "../tools/setup-guide.js";
import {
  callTool,
  fakeFetch,
  makeDeps,
  offline,
  text,
} from "./helpers/fakes.js";

beforeEach(() => resetDocCache());

const LIVE_IOS =
  "# DeepLinkNow iOS SDK\n\nLIVE COPY\n\n## Installation\n\nSPM.";

describe("get_setup_guide", () => {
  it("MCP-20: fetches the platform's live .md docs twin and adds the before-you-start steps", async () => {
    const { fetch, calls } = fakeFetch((call) =>
      call.url === "https://deeplinknow.com/docs/ios.md"
        ? text(LIVE_IOS)
        : offline(call)
    );
    const res = await callTool(makeDeps({ fetch }), "get_setup_guide", {
      platform: "ios",
    });
    expect(res.isError).toBeFalsy();
    expect(res.text).toContain("# DeepLinkNow setup: iOS (Swift)");
    expect(res.text).toContain(
      "Source: https://deeplinknow.com/docs/ios.md (fetched live)"
    );
    expect(res.text).toContain("LIVE COPY");
    expect(res.text).toContain("**public** key (`dln_pub_…`)");
    expect(res.text).toContain("must never ship in an app");
    expect(res.text).toContain("run the `check_domain` tool");
    expect(res.structuredContent).toEqual({
      platform: "ios",
      source: "live",
      url: "https://deeplinknow.com/docs/ios.md",
    });
    expect(calls).toHaveLength(1);
  });

  it("MCP-20: maps each platform to its page, Expo to the React Native page without the bare install section", async () => {
    const expected: Record<string, string> = {
      android: "/docs/android.md",
      expo: "/docs/react-native.md",
      flutter: "/docs/flutter.md",
      ios: "/docs/ios.md",
      "react-native": "/docs/react-native.md",
    };
    for (const [platform, path] of Object.entries(expected)) {
      resetDocCache();
      const { fetch, calls } = fakeFetch(offline);
      const res = await callTool(makeDeps({ fetch }), "get_setup_guide", {
        platform,
      });
      expect(calls[0]?.url, platform).toBe(`https://deeplinknow.com${path}`);
      expect(res.isError, platform).toBeFalsy();
    }
    const rn = await readBundled("react-native");
    const expo = expoOnly(rn);
    expect(expo).toContain("### Expo");
    expect(expo).toContain("npx expo install @deeplinknow/react-native");
    expect(expo).not.toContain("### Bare React Native");
    expect(expo).toContain("## Getting started");
  });

  it("MCP-21: falls back to the bundled snapshot, and says so, when the live page is missing, HTML or unreachable", async () => {
    const answers = [
      () =>
        new Response("<!doctype html><title>404</title>", {
          headers: { "content-type": "text/html" },
          status: 404,
        }),
      () => text("<!doctype html><p>soft 404</p>", 200, "text/html"),
      () => text("<html>not markdown</html>", 200, "text/markdown"),
      offline,
    ];
    for (const answer of answers) {
      resetDocCache();
      const { fetch } = fakeFetch(answer);
      const res = await callTool(makeDeps({ fetch }), "get_setup_guide", {
        platform: "android",
      });
      expect(res.isError).toBeFalsy();
      expect(res.text).toContain(
        `bundled copy of https://deeplinknow.com/docs/android.md from ${SNAPSHOT_DATE}`
      );
      expect(res.text).toContain("# DeepLinkNow Android SDK");
      expect(res.structuredContent).toMatchObject({ source: "bundled" });
    }
  });

  it("MCP-22: keeps a live page for an hour", async () => {
    const { fetch, calls } = fakeFetch(() => text(LIVE_IOS));
    let now = new Date("2026-10-21T00:00:00Z");
    const deps = makeDeps({ fetch, now: () => now });
    await callTool(deps, "get_setup_guide", { platform: "ios" });
    now = new Date("2026-10-21T00:59:00Z");
    await callTool(deps, "get_setup_guide", { platform: "ios" });
    expect(calls).toHaveLength(1);
    now = new Date("2026-10-21T01:01:00Z");
    await callTool(deps, "get_setup_guide", { platform: "ios" });
    expect(calls).toHaveLength(2);
  });

  it("MCP-23: fetches docs only from https://deeplinknow.com and never sends the API key there", async () => {
    const { fetch, calls } = fakeFetch(() => text(LIVE_IOS));
    const deps = makeDeps({
      env: { apiKey: "dln_priv_abcdefabcdefabcdefabcdefabcdefab" },
      fetch,
    });
    await callTool(deps, "get_setup_guide", { platform: "flutter" });
    await callTool(deps, "search_docs", { query: "minConfidence" });
    await callTool(deps, "migrate_from", {
      platform: "ios",
      source: "firebase-dynamic-links",
    });
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const call of calls) {
      expect(new URL(call.url).origin).toBe("https://deeplinknow.com");
      expect(call.headers["x-api-key"]).toBeUndefined();
    }
  });

  it("MCP-27: bundles a snapshot of every docs page it can serve", async () => {
    for (const slug of Object.keys(DOC_PAGES) as DocSlug[]) {
      const body = await readBundled(slug);
      expect(body.length, slug).toBeGreaterThan(1000);
      expect(body.trimStart().startsWith("<"), slug).toBe(false);
    }
    const pkg = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8")
    ) as { files: string[] };
    expect(pkg.files).toContain("content");
  });
});

describe("search_docs", () => {
  it("MCP-24: returns the best-matching sections of llms-full.txt with their page URLs", async () => {
    const res = await callTool(makeDeps(), "search_docs", {
      max_results: 3,
      query: "minConfidence threshold",
    });
    expect(res.isError).toBeFalsy();
    expect(res.text).toContain('# DeepLinkNow docs: "minConfidence threshold"');
    expect(res.text).toContain(
      "bundled copy of https://deeplinknow.com/llms-full.txt"
    );
    const { results } = res.structuredContent as {
      results: { url: string; heading: string }[];
    };
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(3);
    for (const r of results) {
      expect(r.url).toMatch(/^https:\/\/deeplinknow\.com\//);
    }
    expect(res.text).toMatch(/minConfidence/);
  });

  it("MCP-24: splits sections at headings, keeps each page's Source URL and ignores headings inside code fences", () => {
    const md = [
      "Source: https://deeplinknow.com/docs/ios",
      "# iOS",
      "intro",
      "## Paste prompt",
      "The paste prompt appears on iOS 16+.",
      "```sh",
      "# not a heading",
      "```",
      "Source: https://deeplinknow.com/pricing",
      "# Pricing",
      "## Plans",
      "Startup includes the management API.",
    ].join("\n");
    const sections = splitSections(md);
    const paste = sections.find((s) => s.heading === "Paste prompt");
    expect(paste?.url).toBe("https://deeplinknow.com/docs/ios");
    expect(paste?.text).toContain("# not a heading");
    const plans = sections.find((s) => s.heading === "Plans");
    expect(plans?.url).toBe("https://deeplinknow.com/pricing");
    expect(search(sections, "paste prompt", 5)[0]?.heading).toBe(
      "Paste prompt"
    );
    expect(search(sections, "management api", 5)[0]?.heading).toBe("Plans");
    expect(search(sections, "the a of", 5)).toEqual([]);
  });

  it("MCP-24: answers a query with no match with a pointer to llms.txt, not an error", async () => {
    const res = await callTool(makeDeps(), "search_docs", {
      query: "zzqxv kumquat",
    });
    expect(res.isError).toBeFalsy();
    expect(res.text).toContain(
      'No DeepLinkNow docs section matches "zzqxv kumquat"'
    );
    expect(res.text).toContain("https://deeplinknow.com/llms.txt");
  });
});
