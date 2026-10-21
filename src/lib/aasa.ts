/**
 * TOOL-05 / TOOL-06: apple-app-site-association checks, as Apple reads the
 * file: no redirects, JSON, at most 128 KB, applinks.details with app IDs
 * and paths or components. Apple's CDN copy is what iOS actually installs.
 */
import { type Check, isJsonContentType, worst } from "./checks.js";
import type { Deps } from "./deps.js";
import { type SafeFetchResult, safeFetch } from "./safe-fetch.js";

const MAX_AASA_BYTES = 128 * 1024;
/** TEAMID.bundle.id: a 10-character team ID, then a reverse-DNS bundle ID. */
const APP_ID = /^[A-Z0-9]{10}\.[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

export interface AasaReport {
  appIds: string[];
  cdn: { status: number | null; matches: boolean | null; error: string | null };
  checks: Check[];
  /** The origin file, pretty-printed when it parsed. */
  file: string | null;
  host: string;
  overall: Check["status"];
  url: string;
}

interface Detail {
  appID?: unknown;
  appIDs?: unknown;
  components?: unknown;
  paths?: unknown;
}

/** Every app ID in an applinks.details entry, both the old and new forms. */
function appIdsOf(detail: Detail): string[] {
  const ids: string[] = [];
  if (typeof detail.appID === "string") {
    ids.push(detail.appID);
  }
  if (Array.isArray(detail.appIDs)) {
    for (const id of detail.appIDs) {
      if (typeof id === "string") {
        ids.push(id);
      }
    }
  }
  return ids;
}

/** Pure: the checks for a fetched origin file. */
export function analyzeAasa(res: SafeFetchResult): {
  checks: Check[];
  appIds: string[];
  parsed: unknown;
} {
  const checks: Check[] = [];
  const fail = (title: string, detail: string) =>
    checks.push({ detail, status: "fail", title });
  const warn = (title: string, detail: string) =>
    checks.push({ detail, status: "warn", title });
  const pass = (title: string, detail: string) =>
    checks.push({ detail, status: "pass", title });

  if (res.error && res.status === null) {
    fail("Reachable over HTTPS", res.error);
    return { appIds: [], checks, parsed: null };
  }
  const status = res.status ?? 0;
  if (res.redirects.length > 0 || (status >= 300 && status < 400)) {
    fail(
      "Served without redirects",
      `The file redirects to ${res.finalUrl}. Apple doesn't follow redirects: serve it directly at /.well-known/apple-app-site-association on this exact host.`
    );
    return { appIds: [], checks, parsed: null };
  }
  if (res.status !== 200) {
    fail(
      "Returns 200",
      `The server answered ${res.status}. The file must return 200 at /.well-known/apple-app-site-association.`
    );
    return { appIds: [], checks, parsed: null };
  }
  pass("Reachable over HTTPS", "Returns 200 with no redirects.");

  if (isJsonContentType(res.contentType)) {
    pass("Content-Type", `Served as ${res.contentType}.`);
  } else {
    warn(
      "Content-Type",
      `Served as ${res.contentType ?? "nothing"}. Apple accepts it, but application/json is the documented type and some CDNs and proxies mangle other types.`
    );
  }

  if (res.truncated || res.bytes > MAX_AASA_BYTES) {
    fail(
      "Size",
      `The file is over 128 KB (${Math.round(res.bytes / 1024)} KB read). Apple ignores larger files: use components with wildcards instead of listing paths.`
    );
    return { appIds: [], checks, parsed: null };
  }
  pass(
    "Size",
    `${(res.bytes / 1024).toFixed(1)} KB, under Apple's 128 KB limit.`
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(res.body ?? "");
  } catch (error) {
    fail(
      "Valid JSON",
      `It doesn't parse as JSON (${(error as Error).message}). Check for trailing commas, comments or an HTML error page.`
    );
    return { appIds: [], checks, parsed: null };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail("Valid JSON", "The top level must be a JSON object.");
    return { appIds: [], checks, parsed };
  }
  pass("Valid JSON", "Parses as a JSON object.");

  const root = parsed as Record<string, unknown>;
  const applinks = root.applinks as Record<string, unknown> | undefined;
  if (!applinks || typeof applinks !== "object") {
    fail(
      "applinks",
      'There is no "applinks" object, so Universal Links are off for this domain. Add { "applinks": { "details": [...] } }.'
    );
    return { appIds: [], checks, parsed };
  }
  if (!Array.isArray(applinks.details)) {
    fail(
      "applinks.details",
      '"applinks.details" must be an array of app entries.'
    );
    return { appIds: [], checks, parsed };
  }
  if (applinks.details.length === 0) {
    fail(
      "applinks.details",
      '"applinks.details" is empty: no app will open these links.'
    );
    return { appIds: [], checks, parsed };
  }
  pass(
    "applinks.details",
    `${applinks.details.length} app ${applinks.details.length === 1 ? "entry" : "entries"}.`
  );

  const appIds: string[] = [];
  (applinks.details as Detail[]).forEach((detail, i) => {
    const ids = appIdsOf(detail ?? {});
    const label = `Entry ${i + 1}`;
    if (ids.length === 0) {
      fail(
        `${label}: app ID`,
        'No "appIDs" (or legacy "appID") in this entry.'
      );
    } else {
      const bad = ids.filter((id) => !APP_ID.test(id));
      if (bad.length > 0) {
        fail(
          `${label}: app ID format`,
          `${bad.join(", ")} isn't TEAMID.bundle.id: the team ID is the 10-character ID from your Apple developer account, not the app's name.`
        );
      } else {
        pass(`${label}: app ID`, ids.join(", "));
      }
      appIds.push(...ids);
    }
    const hasPaths = Array.isArray(detail?.paths) && detail.paths.length > 0;
    const hasComponents =
      Array.isArray(detail?.components) && detail.components.length > 0;
    if (hasPaths || hasComponents) {
      pass(
        `${label}: paths`,
        hasComponents
          ? `${(detail.components as unknown[]).length} component rule(s) (iOS 13+ format).`
          : `${(detail.paths as unknown[]).length} path rule(s) (legacy format, still supported).`
      );
    } else {
      fail(
        `${label}: paths`,
        'No "components" or "paths", so no URL matches. Add { "components": [{ "/": "/*" }] } to match every path.'
      );
    }
  });

  for (const key of ["webcredentials", "appclips"] as const) {
    if (root[key]) {
      checks.push({
        detail: `Also declares ${key} (for ${key === "webcredentials" ? "password autofill" : "App Clips"}).`,
        status: "info",
        title: key,
      });
    }
  }
  return { appIds, checks, parsed };
}

const stable = (value: unknown) => JSON.stringify(value);

export async function checkAasa(
  host: string,
  deps: Pick<Deps, "domainFetch" | "fetch" | "lookup">
): Promise<AasaReport> {
  const opts = { fetchImpl: deps.domainFetch, resolve: deps.lookup };
  const url = `https://${host}/.well-known/apple-app-site-association`;
  const [origin, cdn] = await Promise.all([
    safeFetch(url, opts),
    safeFetch(`https://app-site-association.cdn-apple.com/a/v1/${host}`, opts),
  ]);
  const { checks, appIds, parsed } = analyzeAasa(origin);

  if (origin.status === 404 || origin.error) {
    const legacy = await safeFetch(
      `https://${host}/apple-app-site-association`,
      opts
    );
    if (legacy.status === 200) {
      checks.push({
        detail:
          "The file is only at the legacy root path /apple-app-site-association. iOS still reads it there, but move it to /.well-known/ as Apple documents.",
        status: "warn",
        title: "Location",
      });
    }
  }

  let cdnParsed: unknown = null;
  try {
    cdnParsed = cdn.status === 200 ? JSON.parse(cdn.body ?? "") : null;
  } catch {
    cdnParsed = null;
  }
  const matches =
    parsed && cdnParsed ? stable(parsed) === stable(cdnParsed) : null;
  if (cdn.status === 200) {
    checks.push(
      matches
        ? {
            detail:
              "Apple's CDN has the same file, so iOS devices install what you serve.",
            status: "pass",
            title: "Apple's CDN copy",
          }
        : {
            detail:
              "Apple's CDN has a different version. iOS installs the CDN copy, which can lag your server by a day or more after a change: while testing, add ?mode=developer to the associated domain in your entitlements (applinks:example.com?mode=developer) so a development build reads your server directly.",
            status: "warn",
            title: "Apple's CDN copy",
          }
    );
  } else if (cdn.status === 404) {
    checks.push({
      detail:
        "Apple's CDN has no copy for this domain yet. It fetches the file after an app with this associated domain is installed, so a new domain can take a while.",
      status: origin.status === 200 ? "warn" : "info",
      title: "Apple's CDN copy",
    });
  }

  return {
    appIds,
    cdn: { error: cdn.error, matches, status: cdn.status },
    checks,
    file: parsed ? JSON.stringify(parsed, null, 2) : null,
    host,
    overall: worst(checks),
    url,
  };
}
