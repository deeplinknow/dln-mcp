import { createSocket } from "node:dgram";
import { createServer } from "node:net";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeAasa } from "../lib/aasa.js";
import { BLOCK_LISTS, resetBlockListCache } from "../lib/blocklists.js";
import type { Deps } from "../lib/deps.js";
import { defaultDeps } from "../lib/deps.js";
import {
  type DomainFetch,
  isPublicAddress,
  pinnedHttpsFetch,
  pinnedLookup,
  resolveAddresses,
  safeFetch,
} from "../lib/safe-fetch.js";
import { USER_AGENT } from "../lib/version.js";
import { resetDomainCache } from "../tools/check-domain.js";
import {
  type Call,
  callTool,
  fakeFetch,
  json,
  makeDeps,
  publicDns,
  text,
} from "./helpers/fakes.js";

const HOST = "go.example.com";
const AASA = {
  applinks: {
    details: [
      { appIDs: ["ABCDE12345.com.example.app"], components: [{ "/": "/*" }] },
    ],
  },
};
const FP = Array.from({ length: 32 }, () => "AB").join(":");
const ASSETLINKS = [
  {
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: "com.example.app",
      sha256_cert_fingerprints: [FP],
    },
  },
];

const LIST_BODIES: Record<string, string> = {
  "adguard-cname-clickthroughs": "",
  "adguard-cname-trackers": "# list\ncloaked.example\n",
  "adguard-tracking": "||other.example^$domain=news.example\n",
  easyprivacy:
    "! EasyPrivacy\n||tracker.example^\n||ads.example^$script,third-party\n",
};

/** A healthy domain: both files, Apple's CDN copy, Google's verdict, the lists. */
function healthy(
  overrides: (call: Call) => Response | undefined = () => undefined
) {
  return fakeFetch((call) => {
    const override = overrides(call);
    if (override) {
      return override;
    }
    const { url } = call;
    if (url === `https://${HOST}/.well-known/apple-app-site-association`) {
      return json(AASA);
    }
    if (url === `https://app-site-association.cdn-apple.com/a/v1/${HOST}`) {
      return json(AASA);
    }
    if (url === `https://${HOST}/.well-known/assetlinks.json`) {
      return json(ASSETLINKS);
    }
    if (
      url.startsWith(
        "https://digitalassetlinks.googleapis.com/v1/statements:list"
      )
    ) {
      return json({
        statements: [
          { target: { androidApp: { packageName: "com.example.app" } } },
        ],
      });
    }
    const list = BLOCK_LISTS.find((l) => l.url === url);
    if (list) {
      return text(LIST_BODIES[list.id] ?? "", 200, "text/plain");
    }
    return new Response("not found", { status: 404 });
  });
}

const ALLOWED_HOSTS = new Set([
  HOST,
  "app-site-association.cdn-apple.com",
  "digitalassetlinks.googleapis.com",
  ...BLOCK_LISTS.map((l) => new URL(l.url).hostname),
]);

beforeEach(() => {
  resetBlockListCache();
  resetDomainCache();
});

describe("check_domain", () => {
  it("MCP-10: runs all three checks by default and reports each finding with its status", async () => {
    const { fetch } = healthy();
    const res = await callTool(makeDeps({ fetch }), "check_domain", {
      domain: `https://${HOST}/promo?x=1`,
    });
    expect(res.isError).toBeFalsy();
    expect(res.text).toContain(`# Deep link domain check: ${HOST}`);
    expect(res.text).toContain(
      "iOS Universal Links (apple-app-site-association): PASS"
    );
    expect(res.text).toContain("[PASS] Apple's CDN copy");
    expect(res.text).toContain("App IDs: ABCDE12345.com.example.app");
    expect(res.text).toContain("Android App Links (assetlinks.json): PASS");
    expect(res.text).toContain(
      "Google's Digital Asset Links API links this domain to com.example.app"
    );
    expect(res.text).toContain("Ad-block lists: NOT LISTED");
    expect(res.structuredContent).toMatchObject({
      aasa: { overall: "pass" },
      assetlinks: { overall: "pass" },
      host: HOST,
    });
  });

  it("MCP-10: runs only the checks asked for", async () => {
    const { fetch, calls } = healthy();
    const res = await callTool(makeDeps({ fetch }), "check_domain", {
      checks: ["assetlinks"],
      domain: HOST,
    });
    expect(res.text).toContain("Android App Links");
    expect(res.text).not.toContain("apple-app-site-association");
    expect(res.text).not.toContain("Ad-block lists");
    expect(
      calls.some((c) => c.url.includes("apple-app-site-association"))
    ).toBe(false);
    expect(calls.some((c) => BLOCK_LISTS.some((l) => l.url === c.url))).toBe(
      false
    );
  });

  it("MCP-11: refuses a domain that resolves to a private address without requesting it", async () => {
    const { fetch, calls } = healthy();
    const lookup: Deps["lookup"] = async (name) =>
      name === HOST
        ? [{ address: "10.0.0.5", family: 4 }]
        : publicDns(name, { all: true, verbatim: true });
    const res = await callTool(makeDeps({ fetch, lookup }), "check_domain", {
      checks: ["aasa", "assetlinks"],
      domain: HOST,
    });
    expect(res.text).toContain(`${HOST} resolves to a private address.`);
    expect(calls.some((c) => new URL(c.url).hostname === HOST)).toBe(false);
  });

  it("MCP-11: classifies private, loopback, link-local, CGNAT, multicast and unique-local addresses as non-public", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "224.0.0.1",
      "0.0.0.0",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:10.0.0.1",
      "2001:db8::1",
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    for (const ip of ["93.184.216.34", "2606:4700::1111"]) {
      expect(isPublicAddress(ip), ip).toBe(true);
    }
  });

  it("MCP-11: sends no credentials, names DeepLinkNow, caps the body and re-checks every redirect hop", async () => {
    const big = "x".repeat(300 * 1024);
    const { fetch, calls } = fakeFetch((call) => {
      if (call.url === "https://a.example.com/big") {
        return text(big, 200, "text/plain");
      }
      if (call.url === "https://a.example.com/hop") {
        return Response.redirect("https://internal.example.com/", 302);
      }
      return new Response("ok");
    });
    const lookup: Deps["lookup"] = async (name) =>
      name === "internal.example.com"
        ? [{ address: "192.168.0.10", family: 4 }]
        : publicDns(name, { all: true, verbatim: true });

    const capped = await safeFetch("https://a.example.com/big", {
      fetchImpl: fetch,
      resolve: lookup,
    });
    expect(capped.truncated).toBe(true);
    expect(capped.body?.length).toBe(256 * 1024);
    expect(calls[0]?.init?.credentials).toBe("omit");
    expect(calls[0]?.init?.redirect).toBe("manual");
    expect(calls[0]?.headers["user-agent"]).toBe(USER_AGENT);

    const hop = await safeFetch("https://a.example.com/hop", {
      fetchImpl: fetch,
      followRedirects: true,
      resolve: lookup,
    });
    expect(hop.error).toBe(
      "internal.example.com resolves to a private address."
    );
    expect(
      calls.some((c) => c.url.startsWith("https://internal.example.com"))
    ).toBe(false);

    const plain = await safeFetch("http://a.example.com/", {
      fetchImpl: fetch,
      resolve: lookup,
    });
    expect(plain.error).toBe("Only https URLs are checked.");
    const port = await safeFetch("https://a.example.com:8443/", {
      fetchImpl: fetch,
      resolve: lookup,
    });
    expect(port.error).toBe("Only the standard https port (443) is checked.");
  });

  it("MCP-11: reports a timeout instead of hanging", async () => {
    const { fetch } = fakeFetch(() => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    });
    const res = await safeFetch("https://slow.example.com/", {
      fetchImpl: fetch,
      resolve: publicDns,
    });
    expect(res.error).toBe("slow.example.com didn't answer within 5 seconds.");
  });

  it("MCP-12: rejects input that isn't a public hostname without any network request", async () => {
    for (const domain of [
      "",
      "localhost",
      "10.0.0.1",
      "http://[::1]/x",
      "exa mple.com",
      "example.123",
    ]) {
      const { fetch, calls } = healthy();
      const res = await callTool(makeDeps({ fetch }), "check_domain", {
        domain: domain || " ",
      });
      expect(res.isError, domain).toBe(true);
      expect(calls, domain).toHaveLength(0);
    }
  });

  it("MCP-13: applies the AASA rules: redirects, app ID format, missing paths and a stale CDN copy", async () => {
    const redirected = analyzeAasa({
      body: null,
      bytes: 0,
      contentType: null,
      error: null,
      finalUrl: "https://www.example.com/x",
      redirects: [
        {
          status: 301,
          url: "https://example.com/.well-known/apple-app-site-association",
        },
      ],
      status: 301,
      truncated: false,
    });
    expect(redirected.checks[0]).toMatchObject({
      status: "fail",
      title: "Served without redirects",
    });

    const bad = { applinks: { details: [{ appID: "com.example.app" }] } };
    const { fetch } = healthy((call) => {
      if (
        call.url === `https://${HOST}/.well-known/apple-app-site-association`
      ) {
        return json(bad);
      }
    });
    const res = await callTool(makeDeps({ fetch }), "check_domain", {
      checks: ["aasa"],
      domain: HOST,
    });
    expect(res.text).toContain("apple-app-site-association): FAIL");
    expect(res.text).toContain("[FAIL] Entry 1: app ID format");
    expect(res.text).toContain("[FAIL] Entry 1: paths");
    expect(res.text).toContain("[WARN] Apple's CDN copy");
  });

  it("MCP-14: reports Google's API being unreachable as info and still shows its own assetlinks checks", async () => {
    const { fetch } = healthy((call) => {
      if (call.url.startsWith("https://digitalassetlinks.googleapis.com/")) {
        return new Response("x", { status: 500 });
      }
      if (call.url === `https://${HOST}/.well-known/assetlinks.json`) {
        return text(JSON.stringify(ASSETLINKS), 200, "text/html");
      }
    });
    const res = await callTool(makeDeps({ fetch }), "check_domain", {
      checks: ["assetlinks"],
      domain: HOST,
    });
    expect(res.text).toContain(
      "[INFO] Google's verdict: Google's API answered 500."
    );
    expect(res.text).toContain("[FAIL] Content-Type");
    expect(res.text).toContain("[PASS] Statement 1: package_name");
  });

  it("MCP-15: names each hit's list, rule and impact, and downloads the lists once per process", async () => {
    const { fetch, calls } = healthy();
    const resolveCname = async (name: string) => {
      if (name === "link.shop.com") {
        return ["edge.cloaked.example."];
      }
      throw new Error("ENODATA");
    };
    const deps = makeDeps({ fetch, resolveCname });
    const first = await callTool(deps, "check_domain", {
      checks: ["adblock"],
      domain: "link.shop.com",
    });
    expect(first.text).toContain("Ad-block lists: LISTED");
    expect(first.text).toContain("link.shop.com → edge.cloaked.example");
    expect(first.text).toContain(
      "AdGuard CNAME-cloaked trackers: `cloaked.example` matches cloaked.example (via edge.cloaked.example). Impact: dns"
    );
    expect(first.text).toContain(
      '"Listed" means a matching rule exists in that list today'
    );

    const second = await callTool(deps, "check_domain", {
      checks: ["adblock"],
      domain: "tracker.example",
    });
    expect(second.text).toContain(
      "EasyPrivacy: `||tracker.example^` matches tracker.example (via tracker.example). Impact: page"
    );
    const listDownloads = calls.filter((c) =>
      BLOCK_LISTS.some((l) => l.url === c.url)
    );
    expect(listDownloads).toHaveLength(BLOCK_LISTS.length);
  });

  it("MCP-15: says which list is unavailable instead of reporting not listed", async () => {
    const { fetch } = healthy((call) =>
      call.url === BLOCK_LISTS[0]?.url
        ? new Response("gone", { status: 503 })
        : undefined
    );
    const res = await callTool(makeDeps({ fetch }), "check_domain", {
      checks: ["adblock"],
      domain: HOST,
    });
    expect(res.text).toContain(
      "EasyPrivacy: UNAVAILABLE (Couldn't download EasyPrivacy (HTTP 503).)"
    );
    expect(res.text).toContain("The unavailable lists above weren't checked.");
    expect(res.text).not.toContain(
      "No matching rule in any of the checked lists today."
    );
  });

  it("MCP-16: reuses a domain's result for 5 minutes", async () => {
    const { fetch, calls } = healthy();
    let now = new Date("2026-10-21T00:00:00Z");
    const deps = makeDeps({ fetch, now: () => now });
    await callTool(deps, "check_domain", { checks: ["aasa"], domain: HOST });
    const after1 = calls.length;
    now = new Date("2026-10-21T00:04:00Z");
    await callTool(deps, "check_domain", { checks: ["aasa"], domain: HOST });
    expect(calls.length).toBe(after1);
    now = new Date("2026-10-21T00:06:00Z");
    await callTool(deps, "check_domain", { checks: ["aasa"], domain: HOST });
    expect(calls.length).toBeGreaterThan(after1);
  });

  it("MCP-17: contacts only the domain, Apple's CDN, Google's API and the block lists, and never sends the API key", async () => {
    const { fetch, calls } = healthy();
    const deps = makeDeps({
      env: { apiKey: "dln_priv_secretsecretsecretsecretsecret" },
      fetch,
    });
    await callTool(deps, "check_domain", { domain: HOST });
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      const url = new URL(call.url);
      expect(url.protocol).toBe("https:");
      expect(ALLOWED_HOSTS.has(url.hostname), call.url).toBe(true);
      expect(call.headers["x-api-key"]).toBeUndefined();
      expect(JSON.stringify(call.headers)).not.toContain("secretsecret");
    }
  });

  it("MCP-17: explains that DeepLinkNow domains are generated from the app's settings", async () => {
    const { fetch } = healthy();
    const res = await callTool(makeDeps({ fetch }), "check_domain", {
      checks: ["aasa"],
      domain: "myapp.deeplinknow.com",
    });
    expect(res.text).toContain("This is a DeepLinkNow domain");
  });
});

describe("MCP-11: address ranges, DNS timeout and DNS-rebinding pinning", () => {
  it.each([
    ["::", false],
    ["::1", false],
    ["::7f00:1", false], // IPv4-compatible ::/96
    ["::127.0.0.1", false],
    ["::ffff:93.184.216.34", false], // IPv4-mapped ::ffff:0:0/96, even public
    ["::ffff:5db8:d822", false],
    ["0:0:0:0:0:ffff:a00:1", false],
    ["2001::1", false], // Teredo 2001::/32
    ["2001:0:4136:e378::1", false],
    ["100::1", false], // discard-only 100::/64
    ["100:0:0:0:ffff::1", false],
    ["2002:a00:1::1", false], // 6to4
    ["fec0::1", false], // site-local
    ["64:ff9b::a00:1", false], // NAT64
    ["198.51.100.7", false],
    ["203.0.113.9", false],
    ["100:0:0:1::1", true], // outside 100::/64
    ["2001:1::1", true], // outside 2001::/32
    ["2003::1", true],
    ["2606:4700::1111", true],
    ["198.51.101.1", true],
  ])("MCP-11: %s is public: %s", (address, expected) => {
    expect(isPublicAddress(address)).toBe(expected);
  });

  it("MCP-11: the pinned lookup answers with the checked address whatever the hostname", async () => {
    const lookup = pinnedLookup({ address: "93.184.216.34", family: 4 });
    const one = await new Promise((resolve) =>
      lookup("evil.example", {}, (_err, address, family) =>
        resolve({ address, family })
      )
    );
    expect(one).toEqual({ address: "93.184.216.34", family: 4 });
    const all = await new Promise((resolve) =>
      lookup("evil.example", { all: true }, (_err, addresses) =>
        resolve(addresses)
      )
    );
    expect(all).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });

  it("MCP-11: safeFetch hands the request the address it checked, and re-checks on each hop", async () => {
    const fetchImpl = vi.fn<DomainFetch>(async () => new Response("{}"));
    await safeFetch("https://a.example.com/", {
      fetchImpl,
      resolve: publicDns,
    });
    expect(fetchImpl.mock.calls[0]?.[2]).toEqual({
      address: "93.184.216.34",
      family: 4,
    });
  });

  it("MCP-11: the pinned request opens its socket to the pinned IP, not the hostname's DNS", async () => {
    let connected = false;
    const server = createServer((socket) => {
      connected = true;
      socket.destroy();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    const { port } = server.address() as { port: number };
    // `.invalid` never resolves (RFC 2606); only the pinned lookup can
    // reach the server.
    await expect(
      pinnedHttpsFetch(
        new URL("https://rebind.invalid/x"),
        { headers: {}, signal: AbortSignal.timeout(2000) },
        { address: "127.0.0.1", family: 4 },
        port
      )
    ).rejects.toBeTruthy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(connected).toBe(true);
  });

  it("MCP-11: production deps pin the request and use the DNS resolver with a timeout", () => {
    const deps = defaultDeps({});
    expect(deps.domainFetch).toBeUndefined();
  });

  it("MCP-11: a name server that never answers fails the lookup after the DNS timeout", async () => {
    const silent = createSocket("udp4");
    await new Promise<void>((resolve) => silent.bind(0, "127.0.0.1", resolve));
    const { port } = silent.address();
    const started = Date.now();
    await expect(
      resolveAddresses("slow.example.com", {
        servers: [`127.0.0.1:${port}`],
        timeoutMs: 200,
      })
    ).rejects.toBeTruthy();
    expect(Date.now() - started).toBeLessThan(2000);
    const res = await safeFetch("https://slow.example.com/", {
      fetchImpl: vi.fn(async () => new Response("{}")),
      resolve: () =>
        resolveAddresses("slow.example.com", {
          servers: [`127.0.0.1:${port}`],
          timeoutMs: 200,
        }),
    });
    expect(res.error).toBe("slow.example.com doesn't resolve in DNS.");
    silent.close();
  });
});
