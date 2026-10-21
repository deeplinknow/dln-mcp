/**
 * The DeepLinkNow management API (docs/api/management-endpoints.md), called
 * with the private key from DEEPLINKNOW_API_KEY (MCP-60..66). The key goes
 * only in the x-api-key header to the API host, and never appears in a tool
 * result, an error or a log line (MCP-62).
 */
import type { Deps } from "./deps.js";
import { USER_AGENT } from "./version.js";

export const DEFAULT_API_BASE = "https://deeplinknow.com";
export const PRICING_URL = "https://deeplinknow.com/pricing";
const TIMEOUT_MS = 15_000;

export const NO_KEY_MESSAGE = `No DeepLinkNow API key is configured.

The link tools (list_links, create_link) call the DeepLinkNow management API, which needs your app's private key (dln_priv_…) in the DEEPLINKNOW_API_KEY environment variable of this MCP server. Find it on the app's API Keys page at https://deeplinknow.com/dashboard (it is shown once; regenerate it there if you've lost it).

The management API is included on paid plans (Startup and up): ${PRICING_URL}

You don't need it to deep link: any path on your link domain already works without creating links, and the other tools (get_setup_guide, search_docs, check_domain, explain_match_result, migrate_from) need no key.`;

export const PUBLIC_KEY_MESSAGE = `DEEPLINKNOW_API_KEY holds a public key (dln_pub_…). The management API only accepts the app's private key (dln_priv_…), from the app's API Keys page at https://deeplinknow.com/dashboard. The public key is the one that goes in your app; the private key stays on your machine or server.`;

export const PAID_PLAN_MESSAGE = `Your DeepLinkNow plan doesn't include the management API. It's included on paid plans (Startup and up): ${PRICING_URL}

Upgrade in the dashboard under Settings → Plan. Until then, links don't need to be created: any path on your link domain already works as a deep link.`;

export type ApiResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; message: string; status: number | null };

/** Removes the key from any text before it can reach a tool result (MCP-62). */
export function redact(text: string, key: string | undefined): string {
  if (!key || key.length < 4) {
    return text;
  }
  return text.split(key).join("[redacted]");
}

/**
 * MCP-62: the same redaction applied to every string inside a value, for a
 * tool's structuredContent (rows straight from the API). Object keys are
 * redacted too. Returns a copy; the input is not changed.
 */
export function redactDeep<T>(value: T, key: string | undefined): T {
  if (!key || key.length < 4) {
    return value;
  }
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      return redact(v, key);
    }
    if (Array.isArray(v)) {
      return v.map(walk);
    }
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v).map(([k, inner]) => [redact(k, key), walk(inner)])
      );
    }
    return v;
  };
  return walk(value) as T;
}

/** MCP-61: the API base must be https (http only for localhost). */
export function apiBase(env: Deps["env"]): string | { error: string } {
  const raw = env.apiBaseUrl ?? DEFAULT_API_BASE;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { error: "DEEPLINKNOW_API_URL isn't a valid URL." };
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    return {
      error:
        "DEEPLINKNOW_API_URL must use https (http is allowed only for localhost).",
    };
  }
  return url.origin;
}

/** Why the configured key can't be used, or null when it can (MCP-60). */
export function keyProblem(key: string | undefined): string | null {
  if (!key) {
    return NO_KEY_MESSAGE;
  }
  if (key.startsWith("dln_pub_")) {
    return PUBLIC_KEY_MESSAGE;
  }
  return null;
}

function errorText(body: unknown): string | null {
  if (body && typeof body === "object" && "error" in body) {
    const { error } = body as { error: unknown };
    return typeof error === "string" ? error : null;
  }
  return null;
}

function details(body: unknown): string {
  if (body && typeof body === "object" && "details" in body) {
    const list = (body as { details: unknown }).details;
    if (Array.isArray(list)) {
      const parts = list
        .map((d) => {
          if (!d || typeof d !== "object") {
            return null;
          }
          const { path, message } = d as { path?: unknown; message?: unknown };
          const where =
            Array.isArray(path) && path.length > 0 ? `${path.join(".")}: ` : "";
          return typeof message === "string" ? `${where}${message}` : null;
        })
        .filter(Boolean);
      if (parts.length > 0) {
        return ` (${parts.join("; ")})`;
      }
    }
  }
  return "";
}

/** MCP-63, MCP-64: a readable message for each failure the API documents. */
export function describeFailure(
  status: number,
  body: unknown,
  retryAfter: string | null
): string {
  const server = errorText(body)?.replace(/\.$/, "") ?? null;
  if (status === 403 && server && /paid plan/i.test(server)) {
    return PAID_PLAN_MESSAGE;
  }
  if (status === 429 && server?.startsWith("Total deeplink limit")) {
    return `Your plan's link limit is reached: ${server}. Higher plans allow more links: ${PRICING_URL}`;
  }
  if (status === 401) {
    return `DeepLinkNow rejected the API key: ${server ?? "unauthorized"}. Check that DEEPLINKNOW_API_KEY is the app's current private key (dln_priv_…) from https://deeplinknow.com/dashboard.`;
  }
  if (status === 403) {
    return `DeepLinkNow refused the request: ${server ?? "forbidden"}.`;
  }
  if (status === 429) {
    const wait = retryAfter ? ` Retry after ${retryAfter} seconds.` : "";
    return `DeepLinkNow rate limit: ${server ?? "too many requests"}.${wait}`;
  }
  if (status >= 500) {
    return `DeepLinkNow returned an error (${status}). Try again shortly.`;
  }
  return `DeepLinkNow returned ${status}: ${server ?? "request failed"}${details(body)}.`;
}

export async function apiRequest<T>(
  deps: Pick<Deps, "env" | "fetch">,
  method: "GET" | "POST",
  path: string,
  options: {
    query?: Record<string, string | number | undefined>;
    body?: unknown;
  } = {}
): Promise<ApiResult<T>> {
  const key = deps.env.apiKey;
  const problem = keyProblem(key);
  if (problem) {
    return { message: problem, ok: false, status: null };
  }
  const base = apiBase(deps.env);
  if (typeof base !== "string") {
    return { message: base.error, ok: false, status: null };
  }
  const url = new URL(path, base);
  for (const [name, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(name, String(value));
    }
  }
  const headers: Record<string, string> = {
    accept: "application/json",
    "user-agent": USER_AGENT,
    "x-api-key": key as string,
  };
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }

  let res: Response;
  try {
    res = await deps.fetch(url, {
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      headers,
      method,
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = (error as Error).name === "TimeoutError";
    return {
      message: timedOut
        ? `The DeepLinkNow API at ${url.origin} didn't answer within ${TIMEOUT_MS / 1000} seconds.`
        : `Couldn't reach the DeepLinkNow API at ${url.origin}. Check your network connection.`,
      ok: false,
      status: null,
    };
  }

  let body: unknown = null;
  const text = await res.text().catch(() => "");
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    return {
      message: redact(
        describeFailure(res.status, body, res.headers.get("retry-after")),
        key
      ),
      ok: false,
      status: res.status,
    };
  }
  if (body === null) {
    return {
      message: "DeepLinkNow returned a response this tool couldn't read.",
      ok: false,
      status: res.status,
    };
  }
  return { data: body as T, ok: true, status: res.status };
}
