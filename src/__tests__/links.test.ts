import { afterEach, describe, expect, it, vi } from "vitest";
import { apiBase } from "../lib/api.js";
import { callTool, fakeFetch, json, makeDeps } from "./helpers/fakes.js";

const KEY = "dln_priv_0123456789abcdefghijklmnopqrstuv";
const PAID_403 =
  "API access requires a paid plan. Upgrade your account at https://deeplinknow.com/dashboard/settings to use the management API.";

const ROW = {
  app_id: "app-1",
  clicks: 12,
  created_at: "2026-10-20T10:00:00.000Z",
  id: "4b8f0e7e-2f6c-4d1a-9a77-6f1d2b3c4d5e",
  shortUrl: "https://myapp.deeplinknow.com/summer-sale",
  target_url: "https://example.com/sale",
  title: "Summer sale",
  url_path: "summer-sale",
};

afterEach(() => vi.restoreAllMocks());

describe("list_links and create_link", () => {
  it("MCP-60: without a key, explains the private key and paid plans and makes no request", async () => {
    for (const name of ["list_links", "create_link"]) {
      const { fetch, calls } = fakeFetch(() => json([]));
      const args =
        name === "create_link" ? { target_url: "https://example.com" } : {};
      const res = await callTool(makeDeps({ fetch }), name, args);
      expect(res.isError).toBe(true);
      expect(res.text).toContain(
        "private key (dln_priv_…) in the DEEPLINKNOW_API_KEY environment variable"
      );
      expect(res.text).toContain(
        "paid plans (Startup and up): https://deeplinknow.com/pricing"
      );
      expect(res.text).toContain("any path on your link domain already works");
      expect(calls).toHaveLength(0);
    }
  });

  it("MCP-60: refuses a public key locally without sending it", async () => {
    const { fetch, calls } = fakeFetch(() => json([]));
    const res = await callTool(
      makeDeps({
        env: { apiKey: "dln_pub_abcdefghijklmnopqrstuvwxyz012345" },
        fetch,
      }),
      "list_links",
      {}
    );
    expect(res.isError).toBe(true);
    expect(res.text).toContain("holds a public key (dln_pub_…)");
    expect(res.text).not.toContain("abcdefghijklmnop");
    expect(calls).toHaveLength(0);
  });

  it("MCP-61: sends the key only in x-api-key to https://deeplinknow.com and never follows redirects", async () => {
    const { fetch, calls } = fakeFetch(() => json([ROW]));
    await callTool(makeDeps({ env: { apiKey: KEY }, fetch }), "list_links", {});
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe("https://deeplinknow.com/api/v1/deeplinks");
    expect(call?.headers["x-api-key"]).toBe(KEY);
    expect(call?.headers.authorization).toBeUndefined();
    expect(call?.url).not.toContain(KEY);
    expect(call?.init?.redirect).toBe("error");

    expect(apiBase({ apiBaseUrl: "http://localhost:3000/" })).toBe(
      "http://localhost:3000"
    );
    expect(apiBase({ apiBaseUrl: "https://staging.example.com" })).toBe(
      "https://staging.example.com"
    );
    expect(apiBase({ apiBaseUrl: "http://evil.example.com" })).toEqual({
      error:
        "DEEPLINKNOW_API_URL must use https (http is allowed only for localhost).",
    });
    const blocked = fakeFetch(() => json([]));
    const res = await callTool(
      makeDeps({
        env: { apiBaseUrl: "http://evil.example.com", apiKey: KEY },
        fetch: blocked.fetch,
      }),
      "list_links",
      {}
    );
    expect(res.isError).toBe(true);
    expect(blocked.calls).toHaveLength(0);
  });

  it("MCP-62: never echoes or logs the key, even when the server repeats it", async () => {
    const out = vi.spyOn(process.stdout, "write");
    const err = vi.spyOn(process.stderr, "write");
    const log = vi.spyOn(console, "log");
    const error = vi.spyOn(console, "error");
    const warn = vi.spyOn(console, "warn");
    const { fetch } = fakeFetch(() =>
      json({ error: `Invalid API key ${KEY}` }, 401)
    );
    const res = await callTool(
      makeDeps({ env: { apiKey: KEY }, fetch }),
      "list_links",
      {}
    );
    expect(res.isError).toBe(true);
    expect(res.text).toContain(
      "DeepLinkNow rejected the API key: Invalid API key [redacted]"
    );
    expect(JSON.stringify(res)).not.toContain(KEY);
    for (const spy of [out, err, log, error, warn]) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(KEY);
    }
    const ok = await callTool(
      makeDeps({
        env: { apiKey: KEY },
        fetch: fakeFetch(() => json([{ ...ROW, title: KEY }])).fetch,
      }),
      "list_links",
      {}
    );
    expect(ok.text).not.toContain(KEY);
    expect(log).not.toHaveBeenCalled();
  });

  it("MCP-62: redacts the key from structuredContent too (list, search and create)", async () => {
    const leaky = {
      ...ROW,
      metadata: { note: `key=${KEY}`, [KEY]: "x" },
      title: KEY,
    };
    const cases: [string, Record<string, unknown>, unknown][] = [
      ["list_links", {}, [leaky]],
      [
        "list_links",
        { query: "sale" },
        {
          data: [leaky],
          pagination: { limit: 20, page: 1, total: 1, totalPages: 1 },
        },
      ],
      ["create_link", { target_url: "https://example.com" }, leaky],
    ];
    for (const [name, args, body] of cases) {
      const res = await callTool(
        makeDeps({
          env: { apiKey: KEY },
          fetch: fakeFetch(() => json(body)).fetch,
        }),
        name,
        args
      );
      expect(res.isError, name).toBeFalsy();
      expect(res.structuredContent, name).toBeDefined();
      expect(JSON.stringify(res), name).not.toContain(KEY);
      expect(JSON.stringify(res.structuredContent), name).toContain(
        "[redacted]"
      );
    }
  });

  it("MCP-63: a free plan gets a clear upgrade message with the pricing link", async () => {
    const { fetch } = fakeFetch(() => json({ error: PAID_403 }, 403));
    const res = await callTool(
      makeDeps({ env: { apiKey: KEY }, fetch }),
      "create_link",
      { target_url: "https://example.com" }
    );
    expect(res.isError).toBe(true);
    expect(res.text).toContain(
      "Your DeepLinkNow plan doesn't include the management API."
    );
    expect(res.text).toContain("https://deeplinknow.com/pricing");
  });

  it("MCP-64: explains 401, other 403s, 429 with Retry-After, 400 details, 5xx and network failures", async () => {
    const cases: [Response | (() => never), RegExp][] = [
      [
        json({ error: "API key has expired" }, 401),
        /rejected the API key: API key has expired\. Check that DEEPLINKNOW_API_KEY/,
      ],
      [
        json({ error: "Account is not active", status: "suspended" }, 403),
        /refused the request: Account is not active\./,
      ],
      [
        json(
          { error: "Rate limit exceeded. Maximum 600 requests per minute." },
          429,
          { "retry-after": "17" }
        ),
        /DeepLinkNow rate limit: Rate limit exceeded\. Maximum 600 requests per minute\. Retry after 17 seconds\./,
      ],
      [
        json(
          {
            details: [{ message: "Invalid url", path: ["targetUrl"] }],
            error: "Invalid request data",
          },
          400
        ),
        /returned 400: Invalid request data \(targetUrl: Invalid url\)/,
      ],
      [
        json({ error: "Custom path already in use" }, 400),
        /Custom path already in use/,
      ],
      [
        json(
          {
            error:
              "Total deeplink limit reached: 50 / 50 distinct link paths. Delete unused links to free up quota.",
          },
          429
        ),
        /^Your plan's link limit is reached: Total deeplink limit reached: 50 \/ 50 distinct link paths\. Delete unused links to free up quota\. Higher plans allow more links: https:\/\/deeplinknow\.com\/pricing$/,
      ],
      [
        json({ error: "Internal server error" }, 500),
        /returned an error \(500\)\. Try again shortly\./,
      ],
      [
        () => {
          throw new TypeError("fetch failed");
        },
        /Couldn't reach the DeepLinkNow API at https:\/\/deeplinknow\.com/,
      ],
    ];
    for (const [answer, message] of cases) {
      const { fetch } = fakeFetch(() =>
        typeof answer === "function" ? answer() : answer.clone()
      );
      const res = await callTool(
        makeDeps({ env: { apiKey: KEY }, fetch }),
        "create_link",
        { target_url: "https://example.com" }
      );
      expect(res.isError).toBe(true);
      expect(res.text).toMatch(message);
    }
  });

  it("MCP-65: lists with GET /deeplinks, or GET /deeplinks/search when there's a query", async () => {
    const plain = fakeFetch(() => json([ROW]));
    const res = await callTool(
      makeDeps({ env: { apiKey: KEY }, fetch: plain.fetch }),
      "list_links",
      {
        campaign_id: "0f8fad5b-d9cb-469f-a165-70867728950e",
        limit: 10,
        offset: 20,
      }
    );
    expect(plain.calls[0]?.url).toBe(
      "https://deeplinknow.com/api/v1/deeplinks?campaign_id=0f8fad5b-d9cb-469f-a165-70867728950e&limit=10&offset=20"
    );
    expect(res.text).toContain(
      'https://myapp.deeplinknow.com/summer-sale · "Summer sale" · target https://example.com/sale · 12 clicks'
    );
    expect(res.structuredContent).toEqual({ links: [ROW] });

    const searched = fakeFetch(() =>
      json({
        data: [ROW],
        pagination: { limit: 5, page: 2, total: 1, totalPages: 1 },
      })
    );
    const found = await callTool(
      makeDeps({ env: { apiKey: KEY }, fetch: searched.fetch }),
      "list_links",
      { limit: 5, page: 2, query: "sale" }
    );
    const searchUrl = new URL(searched.calls[0]?.url ?? "");
    expect(searchUrl.origin + searchUrl.pathname).toBe(
      "https://deeplinknow.com/api/v1/deeplinks/search"
    );
    expect(Object.fromEntries(searchUrl.searchParams)).toEqual({
      limit: "5",
      page: "2",
      query: "sale",
    });
    expect(found.text).toContain('1 link(s) match "sale"');

    const empty = fakeFetch(() => json([]));
    const none = await callTool(
      makeDeps({ env: { apiKey: KEY }, fetch: empty.fetch }),
      "list_links",
      {}
    );
    expect(none.text).toContain(
      "any path on the app's link domain works as a deep link without creating one"
    );

    const both = fakeFetch(() => json([]));
    const clash = await callTool(
      makeDeps({ env: { apiKey: KEY }, fetch: both.fetch }),
      "list_links",
      { query: "x", url_path: "y" }
    );
    expect(clash.isError).toBe(true);
    expect(both.calls).toHaveLength(0);
  });

  it("MCP-66: creates a link with POST /deeplinks and the documented body, omitting absent fields", async () => {
    const { fetch, calls } = fakeFetch(() =>
      json({ ...ROW, urlPath: "summer-sale" })
    );
    const res = await callTool(
      makeDeps({ env: { apiKey: KEY }, fetch }),
      "create_link",
      {
        custom_path: "summer-sale",
        ios_button_text: "Get the app",
        metadata: { source: "email" },
        target_url: "https://example.com/sale",
        title: "Summer sale",
      }
    );
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe("https://deeplinknow.com/api/v1/deeplinks");
    expect(calls[0]?.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      customPath: "summer-sale",
      ios_button_text: "Get the app",
      metadata: { source: "email" },
      targetUrl: "https://example.com/sale",
      title: "Summer sale",
    });
    expect(res.text).toContain(
      "Created https://myapp.deeplinknow.com/summer-sale"
    );
    expect(res.text).toContain('The app receives path "/summer-sale"');

    const invalid = fakeFetch(() => json({}));
    const bad = await callTool(
      makeDeps({ env: { apiKey: KEY }, fetch: invalid.fetch }),
      "create_link",
      { target_url: "not a url" }
    );
    expect(bad.isError).toBe(true);
    expect(invalid.calls).toHaveLength(0);
  });

  it("MCP-67: reports the demo key's canned answer and other unexpected shapes instead of failing", async () => {
    const canned = {
      message: "Test API key default response",
      method: "GET",
      path: "/api/v1/deeplinks",
    };
    for (const [name, args] of [
      ["list_links", {}],
      ["list_links", { query: "x" }],
      ["create_link", { target_url: "https://example.com" }],
    ] as const) {
      const demo = await callTool(
        makeDeps({
          env: { apiKey: "test_api_key" },
          fetch: fakeFetch(() => json(canned)).fetch,
        }),
        name,
        args
      );
      expect(demo.isError, name).toBe(true);
      expect(demo.text).toContain(
        "The demo key test_api_key returns canned responses"
      );
      const odd = await callTool(
        makeDeps({
          env: { apiKey: KEY },
          fetch: fakeFetch(() => json({ surprise: KEY })).fetch,
        }),
        name,
        args
      );
      expect(odd.text).toContain(
        "DeepLinkNow returned a response this tool didn't expect"
      );
      expect(odd.text).not.toContain(KEY);
    }
  });
});
