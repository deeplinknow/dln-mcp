/**
 * Is a link domain on the block lists that ad blockers and privacy tools
 * ship? Ported from web/utils/tools/blocklists.ts (MCP-15, the TOOL-04,
 * TOOL-09 and TOOL-10 rules). The lists (about 22 MB together) are downloaded
 * at most once a day per server process and kept in memory as domain → rule
 * maps; nothing is fetched per check.
 */
import type { Deps } from "./deps.js";
import { selfAndParents } from "./domain.js";
import { USER_AGENT } from "./version.js";

export interface BlockList {
  /** "abp": Adblock Plus syntax (`||domain^`); "domains": one domain per line. */
  format: "abp" | "domains";
  id: string;
  name: string;
  url: string;
}

export const BLOCK_LISTS: BlockList[] = [
  {
    format: "abp",
    id: "easyprivacy",
    name: "EasyPrivacy",
    url: "https://easylist.to/easylist/easyprivacy.txt",
  },
  {
    format: "abp",
    id: "adguard-tracking",
    name: "AdGuard Tracking Protection",
    url: "https://filters.adtidy.org/extension/ublock/filters/3.txt",
  },
  {
    format: "domains",
    id: "adguard-cname-trackers",
    name: "AdGuard CNAME-cloaked trackers",
    url: "https://raw.githubusercontent.com/AdguardTeam/cname-trackers/master/data/combined_disguised_trackers_justdomains.txt",
  },
  {
    format: "domains",
    id: "adguard-cname-clickthroughs",
    name: "AdGuard CNAME-cloaked clickthroughs (link domains)",
    url: "https://raw.githubusercontent.com/AdguardTeam/cname-trackers/master/data/combined_disguised_clickthroughs_justdomains.txt",
  },
];

const ABP_DOMAIN_RULE = /^\|\|([a-z0-9][a-z0-9.-]*[a-z0-9])\^(?:\$(.*))?$/i;

/**
 * Domain-anchored blocking rules from an ABP list: `||domain^` with or
 * without options. Exceptions (`@@`), cosmetic rules and path rules are
 * skipped: they don't block a whole domain.
 */
export function parseAbpDomains(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split("\n")) {
    const rule = line.trim();
    if (!rule.startsWith("||")) {
      continue;
    }
    const match = ABP_DOMAIN_RULE.exec(rule);
    if (!match) {
      continue;
    }
    // `$domain=` rules only apply on other sites' pages: not the link itself.
    if (match[2] && /(^|,)domain=/.test(match[2])) {
      continue;
    }
    const domain = (match[1] ?? "").toLowerCase();
    if (!out.has(domain)) {
      out.set(domain, rule);
    }
  }
  return out;
}

export function parseDomainList(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split("\n")) {
    const domain = line.trim().toLowerCase();
    if (!domain || domain.startsWith("#") || domain.startsWith("!")) {
      continue;
    }
    if (/^[a-z0-9][a-z0-9.-]*\.[a-z0-9-]+$/.test(domain)) {
      out.set(domain, domain);
    }
  }
  return out;
}

export interface LoadedList {
  entries: Map<string, string>;
  error: string | null;
  list: BlockList;
}

interface Cache {
  lists: LoadedList[];
  loadedAt: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;
let cache: Cache | null = null;
let loading: Promise<Cache> | null = null;

async function loadOne(
  list: BlockList,
  fetchImpl: typeof fetch
): Promise<LoadedList> {
  try {
    const res = await fetchImpl(list.url, {
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const text = await res.text();
    const entries =
      list.format === "abp" ? parseAbpDomains(text) : parseDomainList(text);
    return { entries, error: null, list };
  } catch (error) {
    return {
      entries: new Map(),
      error: `Couldn't download ${list.name} (${(error as Error).message}).`,
      list,
    };
  }
}

/** The lists, downloaded at most once a day per process. */
export function getBlockLists(
  fetchImpl: typeof fetch,
  now: Date
): Promise<Cache> {
  if (cache && now.getTime() - cache.loadedAt.getTime() < DAY_MS) {
    // A list that failed is retried after an hour rather than a day.
    const stale =
      cache.lists.some((l) => l.error) &&
      now.getTime() - cache.loadedAt.getTime() > 60 * 60 * 1000;
    if (!stale) {
      return Promise.resolve(cache);
    }
  }
  if (!loading) {
    loading = Promise.all(BLOCK_LISTS.map((l) => loadOne(l, fetchImpl)))
      .then((lists) => {
        cache = { lists, loadedAt: now };
        return cache;
      })
      .finally(() => {
        loading = null;
      });
  }
  return loading;
}

/** For tests. */
export function resetBlockListCache() {
  cache = null;
  loading = null;
}

/** The host and its CNAME targets, in order, up to 5 hops. */
export async function cnameChain(
  host: string,
  resolve: (name: string) => Promise<string[]>
): Promise<string[]> {
  const chain = [host];
  let current = host;
  for (let i = 0; i < 5; i += 1) {
    let targets: string[];
    try {
      targets = await resolve(current);
    } catch {
      break; // No CNAME (or no answer): the chain ends here.
    }
    const next = targets[0]?.toLowerCase().replace(/\.$/, "");
    if (!next || chain.includes(next)) {
      break;
    }
    chain.push(next);
    current = next;
  }
  return chain;
}

/**
 * What a matching rule does to someone tapping a link on that domain:
 * - "page": no type options (or $document/$all), so uBlock Origin and
 *   AdGuard block the page itself;
 * - "requests": limited to scripts, images or third-party requests, so it
 *   breaks a vendor's SDK or web tracking calls but not the tap itself;
 * - "dns": a domain list DNS blockers (AdGuard Home, Pi-hole, NextDNS) load,
 *   which stops the domain resolving at all.
 */
export type BlockImpact = "page" | "requests" | "dns";

export function impactOf(list: BlockList, rule: string): BlockImpact {
  if (list.format === "domains") {
    return "dns";
  }
  const [, options] = rule.split("$");
  if (!options) {
    return "page";
  }
  return /(^|,)(document|doc|all)(,|$)/.test(options) ? "page" : "requests";
}

export interface BlockHit {
  impact: BlockImpact;
  /** The domain in the list that matched (the host or a parent). */
  listed: string;
  listId: string;
  listName: string;
  rule: string;
  /** The name in the CNAME chain it matched for. */
  via: string;
}

export interface AdblockReport {
  chain: string[];
  hits: BlockHit[];
  host: string;
  lists: { id: string; name: string; entries: number; error: string | null }[];
  loadedAt: string;
}

/** Pure: match a chain against loaded lists (TOOL-09). */
export function matchChain(chain: string[], lists: LoadedList[]): BlockHit[] {
  const hits: BlockHit[] = [];
  for (const via of chain) {
    for (const candidate of selfAndParents(via)) {
      for (const loaded of lists) {
        const rule = loaded.entries.get(candidate);
        if (rule) {
          hits.push({
            impact: impactOf(loaded.list, rule),
            listed: candidate,
            listId: loaded.list.id,
            listName: loaded.list.name,
            rule,
            via,
          });
        }
      }
    }
  }
  return hits;
}

export async function checkAdblock(
  host: string,
  deps: Pick<Deps, "fetch" | "resolveCname" | "now">
): Promise<AdblockReport> {
  const [lists, chain] = await Promise.all([
    getBlockLists(deps.fetch, deps.now()),
    cnameChain(host, deps.resolveCname),
  ]);
  return {
    chain,
    hits: matchChain(chain, lists.lists),
    host,
    lists: lists.lists.map((l) => ({
      entries: l.entries.size,
      error: l.error,
      id: l.list.id,
      name: l.list.name,
    })),
    loadedAt: lists.loadedAt.toISOString(),
  };
}
