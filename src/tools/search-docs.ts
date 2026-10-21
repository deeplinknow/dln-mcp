/** search_docs (MCP-24, MCP-25): keyword search over DeepLinkNow's llms-full.txt. */
import { z } from "zod";
import type { Deps } from "../lib/deps.js";
import { getDoc, sourceLine } from "../lib/docs.js";
import { ok } from "../lib/result.js";
import { excerpt, search, splitSections } from "../lib/search.js";

export const searchDocsInput = {
  max_results: z
    .number()
    .int()
    .min(1)
    .max(10)
    .default(5)
    .describe("How many sections to return (1-10, default 5)."),
  query: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'What to look for, in words or identifiers, e.g. "minConfidence", "custom domain", "paste prompt", "Install Referrer".'
    ),
};

export async function searchDocs(
  args: { query: string; max_results?: number },
  deps: Pick<Deps, "fetch" | "now">
) {
  const doc = await getDoc("llms-full", deps);
  const hits = search(
    splitSections(doc.text),
    args.query,
    args.max_results ?? 5
  );
  if (hits.length === 0) {
    return ok(
      [
        `No DeepLinkNow docs section matches "${args.query}".`,
        sourceLine(doc),
        "Try other words, or read the index at https://deeplinknow.com/llms.txt.",
      ].join("\n"),
      { query: args.query, results: [], source: doc.source }
    );
  }
  const text = [
    `# DeepLinkNow docs: "${args.query}"`,
    sourceLine(doc),
    ...hits.map((h, i) =>
      [
        "",
        `## ${i + 1}. ${h.page} › ${h.heading}`,
        `Page: ${h.url}`,
        "",
        excerpt(h.text),
      ].join("\n")
    ),
  ].join("\n");
  return ok(text, {
    query: args.query,
    results: hits.map((h) => ({
      heading: h.heading,
      page: h.page,
      url: h.url,
    })),
    source: doc.source,
  });
}
