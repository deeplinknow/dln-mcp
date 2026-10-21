/**
 * check_domain (MCP-10..17): the AASA, assetlinks and ad-block checks from
 * deeplinknow.com/tools, run locally on the user's machine with the same
 * rules (web/utils/tools/*).
 */
import { z } from "zod";
import { type AasaReport, checkAasa } from "../lib/aasa.js";
import { type AssetlinksReport, checkAssetlinks } from "../lib/assetlinks.js";
import {
  type AdblockReport,
  type BlockImpact,
  checkAdblock,
} from "../lib/blocklists.js";
import type { Check } from "../lib/checks.js";
import type { Deps } from "../lib/deps.js";
import { normalizeDomain } from "../lib/domain.js";
import { fail, ok } from "../lib/result.js";

export const CHECKS = ["aasa", "assetlinks", "adblock"] as const;
type CheckName = (typeof CHECKS)[number];

export const checkDomainInput = {
  checks: z
    .array(z.enum(CHECKS))
    .min(1)
    .optional()
    .describe(
      "Which checks to run (default: all three). aasa = iOS Universal Links file plus Apple's CDN copy; assetlinks = Android App Links file plus Google's Digital Asset Links verdict; adblock = the domain and its CNAME chain against EasyPrivacy and AdGuard lists (the first run downloads about 22 MB of lists, then reuses them for a day)."
    ),
  domain: z
    .string()
    .min(1)
    .max(2048)
    .describe(
      "The link domain to check: a hostname (go.example.com, myapp.deeplinknow.com) or any URL on it. Only the hostname is used."
    ),
};

/** MCP-16: a result for a host is reused for 5 minutes (TOOL-03). */
const RESULT_TTL_MS = 5 * 60 * 1000;
type Report = AasaReport | AssetlinksReport | AdblockReport;
const results = new Map<string, { at: number; report: Report }>();

/** For tests. */
export function resetDomainCache() {
  results.clear();
}

async function cached<T extends Report>(
  key: string,
  now: number,
  run: () => Promise<T>
): Promise<T> {
  const hit = results.get(key);
  if (hit && now - hit.at < RESULT_TTL_MS) {
    return hit.report as T;
  }
  const report = await run();
  results.set(key, { at: now, report });
  return report;
}

const LABEL: Record<Check["status"], string> = {
  fail: "FAIL",
  info: "INFO",
  pass: "PASS",
  warn: "WARN",
};

const checkLines = (checks: Check[]) =>
  checks.map((c) => `- [${LABEL[c.status]}] ${c.title}: ${c.detail}`);

function aasaSection(r: AasaReport): string[] {
  return [
    `## iOS Universal Links (apple-app-site-association): ${LABEL[r.overall]}`,
    `File: ${r.url}`,
    ...checkLines(r.checks),
    r.appIds.length > 0 ? `App IDs: ${r.appIds.join(", ")}` : "",
  ].filter(Boolean);
}

function assetlinksSection(r: AssetlinksReport): string[] {
  return [
    `## Android App Links (assetlinks.json): ${LABEL[r.overall]}`,
    `File: ${r.url}`,
    ...checkLines(r.checks),
    r.packages.length > 0 ? `Packages: ${r.packages.join(", ")}` : "",
  ].filter(Boolean);
}

const IMPACT: Record<BlockImpact, string> = {
  dns: "a domain list that DNS blockers (AdGuard Home, Pi-hole, NextDNS) load: the domain stops resolving",
  page: "blocks the page itself in uBlock Origin and AdGuard, so a tap on the link fails",
  requests:
    "limited to scripts, images or third-party requests: breaks a vendor's SDK or tracking calls, not the tap itself",
};

function adblockSection(r: AdblockReport): string[] {
  const out = [
    `## Ad-block lists: ${r.hits.length > 0 ? "LISTED" : "NOT LISTED"}`,
    `Names checked (the host, its parents and its CNAME chain): ${r.chain.join(" → ")}`,
    `Lists (loaded ${r.loadedAt}): ${r.lists
      .map((l) =>
        l.error
          ? `${l.name}: UNAVAILABLE (${l.error})`
          : `${l.name} (${l.entries} domains)`
      )
      .join("; ")}`,
  ];
  for (const hit of r.hits) {
    out.push(
      `- ${hit.listName}: \`${hit.rule}\` matches ${hit.listed} (via ${hit.via}). Impact: ${hit.impact}, ${IMPACT[hit.impact]}.`
    );
  }
  const unavailable = r.lists.filter((l) => l.error).length;
  if (r.hits.length === 0) {
    out.push(
      unavailable > 0
        ? "- No matching rule in the lists that loaded. The unavailable lists above weren't checked."
        : "- No matching rule in any of the checked lists today."
    );
  }
  out.push(
    '"Listed" means a matching rule exists in that list today; it doesn\'t mean every user\'s blocker blocks the link, and "not listed" doesn\'t promise no blocker ever will.'
  );
  return out;
}

const DLN_HINT =
  "This is a DeepLinkNow domain: both files are generated from the app's settings in the dashboard (iOS Team ID and Bundle ID; Android package name and SHA-256 fingerprints). A 404 means the alias is unknown or that platform's settings are incomplete.";

export async function checkDomain(
  args: { domain: string; checks?: CheckName[] },
  deps: Deps
) {
  const input = normalizeDomain(args.domain);
  if (!input.ok) {
    return fail(input.error);
  }
  const { host } = input;
  const wanted = new Set<CheckName>(args.checks ?? CHECKS);
  const now = deps.now().getTime();

  const [aasa, assetlinks, adblock] = await Promise.all([
    wanted.has("aasa")
      ? cached(`aasa:${host}`, now, () => checkAasa(host, deps))
      : null,
    wanted.has("assetlinks")
      ? cached(`assetlinks:${host}`, now, () => checkAssetlinks(host, deps))
      : null,
    wanted.has("adblock")
      ? cached(`adblock:${host}`, now, () => checkAdblock(host, deps))
      : null,
  ]);

  const lines = [`# Deep link domain check: ${host}`];
  if (host.endsWith(".deeplinknow.com")) {
    lines.push("", DLN_HINT);
  }
  if (aasa) {
    lines.push("", ...aasaSection(aasa));
  }
  if (assetlinks) {
    lines.push("", ...assetlinksSection(assetlinks));
  }
  if (adblock) {
    lines.push("", ...adblockSection(adblock));
  }
  lines.push(
    "",
    "Same checks as https://deeplinknow.com/tools, run from this machine."
  );

  return ok(lines.join("\n"), {
    host,
    ...(aasa ? { aasa } : {}),
    ...(assetlinks ? { assetlinks } : {}),
    ...(adblock ? { adblock } : {}),
  });
}
