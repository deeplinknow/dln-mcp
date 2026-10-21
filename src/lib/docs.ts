/**
 * DeepLinkNow's public docs as markdown: fetched live from the `.md` twins on
 * deeplinknow.com (MCP-20), with a bundled snapshot when the site can't be
 * reached (MCP-21). Live copies are kept in memory for an hour.
 */
import { readFile } from "node:fs/promises";
import type { Deps } from "./deps.js";
import { USER_AGENT } from "./version.js";

export const DOCS_ORIGIN = "https://deeplinknow.com";
/** When the files in content/ were copied from the live site. */
export const SNAPSHOT_DATE = "2026-10-21";

export const DOC_PAGES = {
  android: "/docs/android.md",
  "firebase-migration": "/docs/firebase-migration.md",
  flutter: "/docs/flutter.md",
  "integration-checklist": "/docs/integration-checklist.md",
  ios: "/docs/ios.md",
  llms: "/llms.txt",
  "llms-full": "/llms-full.txt",
  quickstart: "/docs/quickstart.md",
  "react-native": "/docs/react-native.md",
} as const;

export type DocSlug = keyof typeof DOC_PAGES;

const BUNDLED_FILE: Record<DocSlug, string> = {
  android: "android.md",
  "firebase-migration": "firebase-migration.md",
  flutter: "flutter.md",
  "integration-checklist": "integration-checklist.md",
  ios: "ios.md",
  llms: "llms.txt",
  "llms-full": "llms-full.txt",
  quickstart: "quickstart.md",
  "react-native": "react-native.md",
};

export interface Doc {
  slug: DocSlug;
  /** "live": fetched from deeplinknow.com now; "bundled": the snapshot shipped in the package. */
  source: "live" | "bundled";
  text: string;
  url: string;
}

const HOUR_MS = 60 * 60 * 1000;
const MAX_DOC_BYTES = 2 * 1024 * 1024;
const cache = new Map<DocSlug, { doc: Doc; at: number }>();

/** For tests. */
export function resetDocCache() {
  cache.clear();
}

export function docUrl(slug: DocSlug): string {
  return `${DOCS_ORIGIN}${DOC_PAGES[slug]}`;
}

export function readBundled(slug: DocSlug): Promise<string> {
  // content/ sits next to src/ and dist/, so this path works from both.
  const file = new URL(`../../content/${BUNDLED_FILE[slug]}`, import.meta.url);
  return readFile(file, "utf8");
}

/** A live response is usable only if it's a 200 with markdown or text, not an HTML error page. */
function usable(res: Response, text: string): boolean {
  const type = res.headers.get("content-type") ?? "";
  return (
    res.status === 200 &&
    /^text\/(markdown|plain)\b/i.test(type) &&
    text.trim().length > 0 &&
    !text.trimStart().startsWith("<") &&
    text.length <= MAX_DOC_BYTES
  );
}

export async function getDoc(
  slug: DocSlug,
  deps: Pick<Deps, "fetch" | "now">
): Promise<Doc> {
  const now = deps.now().getTime();
  const hit = cache.get(slug);
  if (hit && now - hit.at < HOUR_MS) {
    return hit.doc;
  }
  const url = docUrl(slug);
  try {
    const res = await deps.fetch(url, {
      headers: {
        accept: "text/markdown, text/plain;q=0.9",
        "user-agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(8000),
    });
    const text = await res.text();
    if (usable(res, text)) {
      const doc: Doc = { slug, source: "live", text, url };
      cache.set(slug, { at: now, doc });
      return doc;
    }
  } catch {
    // Offline, DNS failure or timeout: use the bundled copy below.
  }
  return { slug, source: "bundled", text: await readBundled(slug), url };
}

export function sourceLine(doc: Doc): string {
  return doc.source === "live"
    ? `Source: ${doc.url} (fetched live)`
    : `Source: bundled copy of ${doc.url} from ${SNAPSHOT_DATE} (the live page couldn't be fetched, so it may be out of date)`;
}
