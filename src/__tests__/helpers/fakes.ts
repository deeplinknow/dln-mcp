import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Deps } from "../../lib/deps.js";
import { createServer } from "../../server.js";

export interface Call {
  body?: string;
  headers: Record<string, string>;
  init?: RequestInit;
  method: string;
  url: string;
}

type Handler = (call: Call) => Response | Promise<Response>;

/** A fetch that answers from a routing function and records every call. */
export function fakeFetch(route: Handler) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const call: Call = {
      body: typeof init?.body === "string" ? init.body : undefined,
      headers,
      init,
      method: init?.method ?? "GET",
      url,
    };
    calls.push(call);
    return route(call);
  }) as typeof fetch;
  return { calls, fetch: fn };
}

export const offline: Handler = () => {
  throw new TypeError("fetch failed");
};

export function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", ...headers },
    status,
  });
}

export function text(
  body: string,
  status = 200,
  contentType = "text/markdown; charset=utf-8"
): Response {
  return new Response(body, {
    headers: { "content-type": contentType },
    status,
  });
}

export const publicDns: Deps["lookup"] = async () => [
  { address: "93.184.216.34", family: 4 },
];

/**
 * Test deps. Unless a test sets `domainFetch`, check_domain's requests to the
 * user's domain go through the same fake `fetch` as everything else, so one
 * routing function answers them all.
 */
export function makeDeps(overrides: Partial<Deps> = {}): Deps {
  const deps: Deps = {
    env: {},
    fetch: fakeFetch(offline).fetch,
    lookup: publicDns,
    now: () => new Date("2026-10-21T00:00:00Z"),
    resolveCname: async () => {
      throw Object.assign(new Error("ENODATA"), { code: "ENODATA" });
    },
    ...overrides,
  };
  return {
    ...deps,
    domainFetch:
      overrides.domainFetch ?? ((url, init) => deps.fetch(url, init)),
  };
}

export async function connect(deps: Deps) {
  const server = createServer(deps);
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

export async function callTool(
  deps: Deps,
  name: string,
  args: Record<string, unknown>
): Promise<CallToolResult & { text: string }> {
  const client = await connect(deps);
  const result = (await client.callTool({
    arguments: args,
    name,
  })) as CallToolResult;
  const textOut = result.content
    .map((c) => (c.type === "text" ? c.text : ""))
    .join("\n");
  await client.close();
  return { ...result, text: textOut };
}
