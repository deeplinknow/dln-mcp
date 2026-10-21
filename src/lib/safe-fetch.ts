/**
 * MCP-11 (TOOL-01 rules): the one way check_domain fetches a user-supplied
 * domain. https on 443 to public addresses only, redirects followed by hand
 * (each hop re-checked), each request pinned to the address that was
 * checked (no DNS rebinding), a DNS timeout, a 5-second timeout and a 256 KB
 * body cap. Never throws: failures come back as `error`. Ported from
 * web/utils/tools/safe-fetch.ts (TOOL-01, TOOL-14).
 */
import type { LookupAddress } from "node:dns";
import { Resolver } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";
import type { LookupFn } from "./deps.js";
import { USER_AGENT } from "./version.js";

const TIMEOUT_MS = 5000;
const MAX_BYTES = 256 * 1024;
const MAX_REDIRECTS = 3;

export interface FetchHop {
  status: number;
  url: string;
}

export interface SafeFetchResult {
  /** The body as text, cut at MAX_BYTES (`truncated` says so). */
  body: string | null;
  bytes: number;
  contentType: string | null;
  error: string | null;
  /** The final response's URL (after any redirects followed). */
  finalUrl: string;
  /** Redirect hops before the final response, in order. */
  redirects: FetchHop[];
  status: number | null;
  truncated: boolean;
}

/** Parses an IPv6 address (with an optional dotted IPv4 tail) to 8 hextets. */
function ipv6Hextets(address: string): number[] | null {
  let v = address.toLowerCase().split("%")[0] ?? "";
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number) as [
      number,
      number,
      number,
      number,
    ];
    v = `${v.slice(0, dotted.index)}${(a * 256 + b).toString(16)}:${(c * 256 + d).toString(16)}`;
  }
  const halves = v.split("::");
  if (halves.length > 2) {
    return null;
  }
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) {
    return null;
  }
  const parts = [...head, ...new Array<string>(fill).fill("0"), ...tail];
  const out = parts.map((h) => Number.parseInt(h, 16));
  return out.length === 8 && out.every((n) => n >= 0 && n <= 0xff_ff)
    ? out
    : null;
}

/**
 * Private, loopback, link-local, CGNAT, documentation (TEST-NET), multicast
 * and reserved ranges, plus IPv6 forms that embed or tunnel to an IPv4
 * address (MCP-11, the web app's TOOL-01/TOOL-14 list).
 */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a = 0, b = 0, c = 0] = address.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) {
      return false;
    }
    if (a === 100 && b >= 64 && b <= 127) {
      return false; // CGNAT
    }
    if (a === 169 && b === 254) {
      return false; // link-local
    }
    if (a === 172 && b >= 16 && b <= 31) {
      return false;
    }
    if (a === 192 && b === 168) {
      return false;
    }
    if (a === 192 && b === 0) {
      return false; // IETF protocol assignments, TEST-NET-1
    }
    if (a === 198 && (b === 18 || b === 19)) {
      return false; // benchmarking
    }
    if (a === 198 && b === 51 && c === 100) {
      return false; // TEST-NET-2
    }
    if (a === 203 && b === 0 && c === 113) {
      return false; // TEST-NET-3
    }
    if (a >= 224) {
      return false; // multicast and reserved
    }
    return true;
  }
  if (family === 6) {
    const h = ipv6Hextets(address);
    if (!h) {
      return false;
    }
    const [h0 = 0, h1 = 0, h2 = 0, h3 = 0, h4 = 0, h5 = 0] = h;
    // ::/96 (unspecified, loopback, IPv4-compatible) and ::ffff:0:0/96
    // (IPv4-mapped): never connect through them.
    if (
      h0 === 0 &&
      h1 === 0 &&
      h2 === 0 &&
      h3 === 0 &&
      h4 === 0 &&
      (h5 === 0 || h5 === 0xff_ff)
    ) {
      return false;
    }
    if (h0 === 0x01_00 && h1 === 0 && h2 === 0 && h3 === 0) {
      return false; // discard-only 100::/64
    }
    if (h0 === 0x20_01 && h1 === 0) {
      return false; // Teredo 2001::/32
    }
    if (h0 === 0x20_01 && h1 === 0x0d_b8) {
      return false; // documentation 2001:db8::/32
    }
    if (h0 === 0x20_02) {
      return false; // 6to4 2002::/16 embeds any IPv4
    }
    if (h0 === 0x00_64 && h1 === 0xff_9b) {
      return false; // NAT64 64:ff9b::/96 and 64:ff9b:1::/48
    }
    if (h0 >= 0xfc_00 && h0 <= 0xfd_ff) {
      return false; // unique local fc00::/7
    }
    if (h0 >= 0xfe_80 && h0 <= 0xfe_bf) {
      return false; // link-local fe80::/10
    }
    if (h0 >= 0xfe_c0 && h0 <= 0xfe_ff) {
      return false; // site-local fec0::/10 (deprecated)
    }
    if (h0 >= 0xff_00) {
      return false; // multicast ff00::/8
    }
    return true;
  }
  return false;
}

/** Longest wait for a DNS answer before the domain is reported as not resolving. */
export const DNS_TIMEOUT_MS = 3000;

/**
 * The default DNS lookup for check_domain (MCP-11): A and AAAA records from
 * a resolver with a timeout and a single try, so a slow or silent name server
 * can't hold the tool open (dns.lookup has no timeout). Rejects when neither
 * record type resolves.
 */
export async function resolveAddresses(
  hostname: string,
  options: { servers?: string[]; timeoutMs?: number } = {}
): Promise<{ address: string; family: number }[]> {
  const timeoutMs = options.timeoutMs ?? DNS_TIMEOUT_MS;
  const resolver = new Resolver({ timeout: timeoutMs, tries: 1 });
  if (options.servers) {
    resolver.setServers(options.servers); // tests
  }
  const timer = setTimeout(() => resolver.cancel(), timeoutMs + 500);
  try {
    const [v4, v6] = await Promise.allSettled([
      resolver.resolve4(hostname),
      resolver.resolve6(hostname),
    ]);
    const addresses = [
      ...(v4.status === "fulfilled" ? v4.value : []).map((address) => ({
        address,
        family: 4,
      })),
      ...(v6.status === "fulfilled" ? v6.value : []).map((address) => ({
        address,
        family: 6,
      })),
    ];
    if (addresses.length === 0) {
      const reason =
        v4.status === "rejected"
          ? v4.reason
          : v6.status === "rejected"
            ? v6.reason
            : undefined;
      throw reason ?? new Error(`${hostname} has no A or AAAA records.`);
    }
    return addresses;
  } finally {
    clearTimeout(timer);
  }
}

/** The address a request is pinned to (MCP-11). */
export interface PinnedAddress {
  address: string;
  family: number;
}

/**
 * Throws a readable message if `url` isn't safe to request. Returns the
 * checked address the request must connect to, so a second DNS answer
 * (DNS rebinding) can't send it somewhere else (MCP-11).
 */
export async function assertFetchable(
  url: URL,
  resolve: LookupFn
): Promise<PinnedAddress> {
  if (url.protocol !== "https:") {
    throw new Error("Only https URLs are checked.");
  }
  if (url.port && url.port !== "443") {
    throw new Error("Only the standard https port (443) is checked.");
  }
  if (isIP(url.hostname.replace(/^\[|\]$/g, ""))) {
    throw new Error("IP addresses aren't checked, only domain names.");
  }
  let addresses: { address: string; family?: number }[];
  try {
    addresses = await resolve(url.hostname, { all: true, verbatim: true });
  } catch (error) {
    throw new Error(`${url.hostname} doesn't resolve in DNS.`, {
      cause: error,
    });
  }
  const [first] = addresses;
  if (!first) {
    throw new Error(`${url.hostname} doesn't resolve in DNS.`);
  }
  if (!addresses.every((a) => isPublicAddress(a.address))) {
    throw new Error(`${url.hostname} resolves to a private address.`);
  }
  return {
    address: first.address,
    family: first.family || isIP(first.address),
  };
}

/**
 * A DNS lookup that ignores the hostname and answers with the address
 * assertFetchable already checked. TLS still verifies the certificate
 * against the hostname (SNI and the Host header keep it).
 */
export function pinnedLookup(pinned: PinnedAddress): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      const all: LookupAddress[] = [
        { address: pinned.address, family: pinned.family },
      ];
      callback(null, all);
      return;
    }
    callback(null, pinned.address, pinned.family);
  };
}

/** The request safeFetch makes; it gets the checked address to connect to. */
export type DomainFetch = (
  url: URL,
  init: RequestInit,
  pinned: PinnedAddress
) => Promise<Response>;

const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

/**
 * An https GET that connects only to `pinned` (node:https with a fixed
 * lookup and no pooled sockets). Global fetch can't pin the address without
 * undici's Agent, which isn't a dependency. `port` is for tests; safeFetch
 * only ever requests port 443.
 */
export function pinnedHttpsFetch(
  url: URL,
  init: RequestInit,
  pinned: PinnedAddress,
  port = 443
): Promise<Response> {
  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((value, name) => {
    headers[name] = value;
  });
  const signal = init.signal ?? undefined;
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        agent: false,
        headers,
        hostname: url.hostname,
        lookup: pinnedLookup(pinned),
        method: "GET",
        path: `${url.pathname}${url.search}`,
        port,
        protocol: "https:",
        servername: url.hostname,
        signal,
      },
      (res) => {
        const out = new Headers();
        for (const [name, value] of Object.entries(res.headers)) {
          if (value === undefined) {
            continue;
          }
          for (const v of Array.isArray(value) ? value : [value]) {
            out.append(name, v);
          }
        }
        const status = res.statusCode ?? 0;
        if (status < 200 || status > 599 || NULL_BODY_STATUSES.has(status)) {
          res.destroy();
          resolve(new Response(null, { headers: out, status: 204 }));
          return;
        }
        const body = Readable.toWeb(res) as ReadableStream<Uint8Array>;
        resolve(new Response(body, { headers: out, status }));
      }
    );
    req.on("error", (error) => {
      // Keep AbortSignal.timeout's TimeoutError visible to the caller.
      reject(signal?.aborted ? signal.reason : error);
    });
    req.end();
  });
}

async function readCapped(
  response: Response
): Promise<{ text: string; bytes: number; truncated: boolean }> {
  if (!response.body) {
    return { bytes: 0, text: "", truncated: false };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }
    const { value } = chunk;
    bytes += value.byteLength;
    if (bytes > MAX_BYTES) {
      chunks.push(value.subarray(0, value.byteLength - (bytes - MAX_BYTES)));
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  const text = new TextDecoder().decode(
    Buffer.concat(chunks.map((c) => Buffer.from(c)))
  );
  return { bytes, text, truncated };
}

export interface SafeFetchOptions {
  /**
   * Replaces the pinned https request (tests). It gets the checked address
   * as its third argument. Omitted: pinnedHttpsFetch.
   */
  fetchImpl?: DomainFetch;
  /** Follow redirects (re-checked); otherwise stop at the first 3xx. */
  followRedirects?: boolean;
  resolve: LookupFn;
}

export async function safeFetch(
  input: string,
  options: SafeFetchOptions
): Promise<SafeFetchResult> {
  const redirects: FetchHop[] = [];
  let url = new URL(input);
  const result = (partial: Partial<SafeFetchResult>): SafeFetchResult => ({
    body: null,
    bytes: 0,
    contentType: null,
    error: null,
    finalUrl: url.toString(),
    redirects,
    status: null,
    truncated: false,
    ...partial,
  });

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let pinned: PinnedAddress;
    try {
      pinned = await assertFetchable(url, options.resolve);
    } catch (error) {
      return result({ error: (error as Error).message });
    }
    let response: Response;
    try {
      const init: RequestInit = {
        credentials: "omit",
        headers: {
          accept: "application/json, */*;q=0.5",
          "user-agent": USER_AGENT,
        },
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      };
      response = await (options.fetchImpl ?? pinnedHttpsFetch)(
        url,
        init,
        pinned
      );
    } catch (error) {
      const timedOut = (error as Error).name === "TimeoutError";
      return result({
        error: timedOut
          ? `${url.hostname} didn't answer within ${TIMEOUT_MS / 1000} seconds.`
          : `Couldn't connect to ${url.hostname} over https (check the TLS certificate).`,
      });
    }

    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      redirects.push({ status: response.status, url: url.toString() });
      const next = new URL(location, url);
      await response.body?.cancel();
      if (!options.followRedirects || hop === MAX_REDIRECTS) {
        return result({
          contentType: response.headers.get("content-type"),
          finalUrl: next.toString(),
          status: response.status,
        });
      }
      url = next;
      continue;
    }

    try {
      const { text, bytes, truncated } = await readCapped(response);
      return result({
        body: text,
        bytes,
        contentType: response.headers.get("content-type"),
        status: response.status,
        truncated,
      });
    } catch {
      return result({
        error: "The response was cut off before it finished.",
        status: response.status,
      });
    }
  }
  return result({ error: "Too many redirects." });
}
