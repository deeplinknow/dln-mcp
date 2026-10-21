/**
 * Everything the tools touch outside the process, injected so tests can
 * replace the network and DNS (MCP-40).
 */
import { resolveCname } from "node:dns/promises";
import { type DomainFetch, resolveAddresses } from "./safe-fetch.js";

export type LookupFn = (
  hostname: string,
  options: { all: true; verbatim: boolean }
) => Promise<{ address: string; family: number }[]>;

export interface Deps {
  /**
   * The request check_domain makes to the user's domain (MCP-11). Omitted in
   * production: safeFetch then uses its pinned node:https request, so the
   * connection goes to the address it checked. Tests set it.
   */
  domainFetch?: DomainFetch;
  /** Process environment the server reads its settings from. */
  env: {
    apiBaseUrl?: string;
    apiKey?: string;
  };
  fetch: typeof fetch;
  lookup: LookupFn;
  now: () => Date;
  resolveCname: (name: string) => Promise<string[]>;
}

export function envFrom(source: NodeJS.ProcessEnv): Deps["env"] {
  const apiKey = source.DEEPLINKNOW_API_KEY?.trim() || undefined;
  const apiBaseUrl = source.DEEPLINKNOW_API_URL?.trim() || undefined;
  return { apiBaseUrl, apiKey };
}

export function defaultDeps(source: NodeJS.ProcessEnv = process.env): Deps {
  return {
    env: envFrom(source),
    fetch: (input, init) => fetch(input, init),
    // A resolver with a timeout and one try, not dns.lookup (MCP-11).
    lookup: (hostname) => resolveAddresses(hostname),
    now: () => new Date(),
    resolveCname: (name) => resolveCname(name),
  };
}
