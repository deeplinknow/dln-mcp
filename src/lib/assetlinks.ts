/**
 * TOOL-07 / TOOL-08: assetlinks.json checks, as Android's verifier reads the
 * file (no redirects, a JSON array of statements), plus Google's Digital
 * Asset Links API verdict. Ported unchanged from web/utils/tools/assetlinks.ts
 * (MCP-14); only the fetch and DNS are injected.
 */
import { type Check, isJsonContentType, worst } from "./checks.js";
import type { Deps } from "./deps.js";
import { type SafeFetchResult, safeFetch } from "./safe-fetch.js";
import { USER_AGENT } from "./version.js";

const HANDLE_ALL_URLS = "delegate_permission/common.handle_all_urls";
/** Java package name: two or more segments, each starting with a letter. */
const PACKAGE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;
/** 32 uppercase hex bytes separated by colons. */
const SHA256 = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

export interface AssetlinksReport {
  checks: Check[];
  file: string | null;
  google: { linked: string[]; error: string | null } | null;
  host: string;
  overall: Check["status"];
  packages: string[];
  url: string;
}

interface Statement {
  relation?: unknown;
  target?: {
    namespace?: unknown;
    package_name?: unknown;
    sha256_cert_fingerprints?: unknown;
  };
}

/** Pure: the checks for a fetched assetlinks.json. */
export function analyzeAssetlinks(res: SafeFetchResult): {
  checks: Check[];
  packages: string[];
  parsed: unknown;
} {
  const checks: Check[] = [];
  const add = (level: Check["status"], title: string, detail: string) =>
    checks.push({ detail, status: level, title });

  if (res.error && res.status === null) {
    add("fail", "Reachable over HTTPS", res.error);
    return { checks, packages: [], parsed: null };
  }
  const status = res.status ?? 0;
  if (res.redirects.length > 0 || (status >= 300 && status < 400)) {
    add(
      "fail",
      "Served without redirects",
      `The file redirects to ${res.finalUrl}. Android's verifier doesn't follow redirects: serve it directly at /.well-known/assetlinks.json on this exact host.`
    );
    return { checks, packages: [], parsed: null };
  }
  if (status !== 200) {
    add(
      "fail",
      "Returns 200",
      `The server answered ${status}. The file must return 200 at /.well-known/assetlinks.json.`
    );
    return { checks, packages: [], parsed: null };
  }
  add("pass", "Reachable over HTTPS", "Returns 200 with no redirects.");
  add(
    isJsonContentType(res.contentType) ? "pass" : "fail",
    "Content-Type",
    isJsonContentType(res.contentType)
      ? `Served as ${res.contentType}.`
      : `Served as ${res.contentType ?? "nothing"}. Android requires Content-Type: application/json.`
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(res.body ?? "");
  } catch (error) {
    add(
      "fail",
      "Valid JSON",
      `It doesn't parse as JSON (${(error as Error).message}).`
    );
    return { checks, packages: [], parsed: null };
  }
  if (!Array.isArray(parsed)) {
    add(
      "fail",
      "Valid JSON",
      "The top level must be a JSON array of statements, [ { ... } ], not an object."
    );
    return { checks, packages: [], parsed };
  }
  add("pass", "Valid JSON", `An array of ${parsed.length} statement(s).`);

  const packages: string[] = [];
  let linking = 0;
  (parsed as Statement[]).forEach((statement, i) => {
    const label = `Statement ${i + 1}`;
    const relations = Array.isArray(statement?.relation)
      ? statement.relation
      : [];
    const target = statement?.target ?? {};
    if (target.namespace !== "android_app") {
      add(
        "info",
        label,
        `Target namespace is ${JSON.stringify(target.namespace)}, not android_app: it doesn't affect App Links.`
      );
      return;
    }
    if (relations.includes(HANDLE_ALL_URLS)) {
      linking += 1;
    } else {
      add(
        "warn",
        `${label}: relation`,
        `Doesn't include "${HANDLE_ALL_URLS}", so it won't verify App Links (it may be for credential sharing).`
      );
    }
    const name = target.package_name;
    if (typeof name !== "string" || !PACKAGE.test(name)) {
      add(
        "fail",
        `${label}: package_name`,
        `${JSON.stringify(name)} isn't a valid Android package name (like com.example.app).`
      );
    } else {
      packages.push(name);
      add("pass", `${label}: package_name`, name);
    }
    const prints = target.sha256_cert_fingerprints;
    if (!Array.isArray(prints) || prints.length === 0) {
      add(
        "fail",
        `${label}: fingerprints`,
        "No sha256_cert_fingerprints. Add your signing certificate's SHA-256 (with Play App Signing, the one shown in Play Console, not your upload key)."
      );
    } else {
      const bad = prints.filter(
        (p) => typeof p !== "string" || !SHA256.test(p)
      );
      add(
        bad.length > 0 ? "fail" : "pass",
        `${label}: fingerprints`,
        bad.length > 0
          ? `${bad.map((b) => JSON.stringify(b)).join(", ")} isn't 32 colon-separated uppercase hex bytes (AA:BB:…).`
          : `${prints.length} SHA-256 fingerprint(s), well formed. Make sure one is Play App Signing's key if you use it.`
      );
    }
  });
  if (linking === 0) {
    add(
      "fail",
      "App Links",
      `No statement grants "${HANDLE_ALL_URLS}" to an android_app, so Android won't verify any app for this domain.`
    );
  }
  return { checks, packages, parsed };
}

async function googleVerdict(
  host: string,
  fetchImpl: typeof fetch
): Promise<{ linked: string[]; error: string | null }> {
  const api = new URL(
    "https://digitalassetlinks.googleapis.com/v1/statements:list"
  );
  api.searchParams.set("source.web.site", `https://${host}`);
  api.searchParams.set("relation", HANDLE_ALL_URLS);
  try {
    const res = await fetchImpl(api, {
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return { error: `Google's API answered ${res.status}.`, linked: [] };
    }
    const data = (await res.json()) as {
      statements?: { target?: { androidApp?: { packageName?: string } } }[];
    };
    const linked = (data.statements ?? [])
      .map((s) => s.target?.androidApp?.packageName)
      .filter((p): p is string => typeof p === "string");
    return { error: null, linked: [...new Set(linked)] };
  } catch {
    return {
      error: "Google's Digital Asset Links API didn't answer.",
      linked: [],
    };
  }
}

export async function checkAssetlinks(
  host: string,
  deps: Pick<Deps, "domainFetch" | "fetch" | "lookup">
): Promise<AssetlinksReport> {
  const url = `https://${host}/.well-known/assetlinks.json`;
  const [res, google] = await Promise.all([
    safeFetch(url, { fetchImpl: deps.domainFetch, resolve: deps.lookup }),
    googleVerdict(host, deps.fetch),
  ]);
  const { checks, packages, parsed } = analyzeAssetlinks(res);
  if (google.error) {
    checks.push({
      detail: google.error,
      status: "info",
      title: "Google's verdict",
    });
  } else if (google.linked.length > 0) {
    checks.push({
      detail: `Google's Digital Asset Links API links this domain to ${google.linked.join(", ")}.`,
      status: "pass",
      title: "Google's verdict",
    });
  } else if (res.status === 200) {
    checks.push({
      detail:
        "Google's Digital Asset Links API returns no linked app for this domain, so verification would fail as things stand.",
      status: "warn",
      title: "Google's verdict",
    });
  }
  return {
    checks,
    file: parsed ? JSON.stringify(parsed, null, 2) : null,
    google,
    host,
    overall: worst(checks),
    packages,
    url,
  };
}
