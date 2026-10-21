/**
 * list_links and create_link (MCP-65, MCP-66): the private-key deep link
 * routes of the management API, GET /api/v1/deeplinks,
 * GET /api/v1/deeplinks/search and POST /api/v1/deeplinks. A private key
 * acts on exactly one app, the key's app.
 */
import { z } from "zod";
import { apiRequest, redact, redactDeep } from "../lib/api.js";
import type { Deps } from "../lib/deps.js";
import { fail, ok } from "../lib/result.js";

/**
 * MCP-67: a response that isn't the documented shape (for example the demo
 * key's canned answer) is reported, never thrown.
 */
export function unexpected(data: unknown, key: string | undefined) {
  const body = redact(String(JSON.stringify(data)), key).slice(0, 300);
  return fail(
    key === "test_api_key"
      ? `The demo key test_api_key returns canned responses, not your links (DeepLinkNow answered ${body}). Use your app's private key (dln_priv_…) for real data.`
      : `DeepLinkNow returned a response this tool didn't expect: ${body}`
  );
}

type Row = Record<string, unknown> & {
  id?: string;
  shortUrl?: string;
  target_url?: string;
  title?: string | null;
  url_path?: string;
  created_at?: string;
  clicks?: number;
};

export const listLinksInput = {
  campaign_id: z
    .string()
    .uuid()
    .optional()
    .describe("Only links in this campaign."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("How many links (1-100; default 50, or 20 with query)."),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Skip this many links (without query)."),
  page: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Page number (with query; starts at 1)."),
  query: z
    .string()
    .max(200)
    .optional()
    .describe(
      "Text to find in the link's title, path or target URL (case-insensitive, literal). Uses the search endpoint."
    ),
  url_path: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Only the link with exactly this stored path (no leading /, query sorted). Can't be combined with query."
    ),
};

function line(row: Row): string {
  const parts = [
    `- ${row.shortUrl ?? `/${row.url_path ?? ""}`}`,
    row.title ? `"${row.title}"` : null,
    row.target_url ? `target ${row.target_url}` : null,
    typeof row.clicks === "number" ? `${row.clicks} clicks` : null,
    row.created_at ? `created ${row.created_at}` : null,
    row.id ? `id ${row.id}` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

export async function listLinks(
  args: {
    query?: string;
    campaign_id?: string;
    url_path?: string;
    limit?: number;
    offset?: number;
    page?: number;
  },
  deps: Pick<Deps, "env" | "fetch">
) {
  if (args.query && args.url_path) {
    return fail("Use either query or url_path, not both.");
  }
  if (args.query) {
    const res = await apiRequest<{
      data: Row[];
      pagination: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
      };
    }>(deps, "GET", "/api/v1/deeplinks/search", {
      query: {
        campaignId: args.campaign_id,
        limit: args.limit,
        page: args.page,
        query: args.query,
      },
    });
    if (!res.ok) {
      return fail(res.message);
    }
    if (!(Array.isArray(res.data.data) && res.data.pagination)) {
      return unexpected(res.data, deps.env.apiKey);
    }
    const { data, pagination } = res.data;
    const text = [
      `${pagination.total} link(s) match "${args.query}" (page ${pagination.page} of ${Math.max(pagination.totalPages, 1)}):`,
      ...data.map(line),
    ].join("\n");
    return ok(
      redact(text, deps.env.apiKey),
      redactDeep({ links: data, pagination }, deps.env.apiKey)
    );
  }

  const res = await apiRequest<Row[]>(deps, "GET", "/api/v1/deeplinks", {
    query: {
      campaign_id: args.campaign_id,
      limit: args.limit,
      offset: args.offset,
      url_path: args.url_path,
    },
  });
  if (!res.ok) {
    return fail(res.message);
  }
  if (!Array.isArray(res.data)) {
    return unexpected(res.data, deps.env.apiKey);
  }
  const rows = res.data;
  const text =
    rows.length === 0
      ? "No links found. That's fine: any path on the app's link domain works as a deep link without creating one. Links visited on the domain show up here as they're used."
      : [
          `${rows.length} link(s), newest first${args.offset ? ` (from offset ${args.offset})` : ""}:`,
          ...rows.map(line),
        ].join("\n");
  return ok(
    redact(text, deps.env.apiKey),
    redactDeep({ links: rows }, deps.env.apiKey)
  );
}

export const createLinkInput = {
  android_button_text: z
    .string()
    .max(50)
    .optional()
    .describe("Text of the Play Store button on the link page."),
  campaign_id: z
    .string()
    .uuid()
    .optional()
    .describe("Add the link to this campaign (must be in the key's app)."),
  custom_path: z
    .string()
    .min(1)
    .max(500)
    .optional()
    .describe(
      'The path on the link domain, e.g. "summer-sale" or "products/123?ref=email" (leading / optional, query sorted). It must pass the app\'s link path rule. Omit it for a random 8-character path.'
    ),
  ios_button_text: z
    .string()
    .max(50)
    .optional()
    .describe("Text of the App Store button on the link page."),
  metadata: z
    .record(z.string(), z.string())
    .optional()
    .describe("String key/value pairs returned to the app with the link."),
  social_description: z
    .string()
    .max(160)
    .optional()
    .describe("Social preview description."),
  social_image: z.string().optional().describe("Social preview image URL."),
  social_title: z.string().max(60).optional().describe("Social preview title."),
  subtitle: z.string().max(200).optional().describe("Link page subtitle."),
  target_url: z
    .string()
    .url()
    .describe(
      "Required by the API: an absolute URL stored as the link's target_url and returned to the app as targetUrl (for example the web page for the same content). Apps should route on the link's path and query, not on targetUrl."
    ),
  title: z.string().min(1).max(100).optional().describe("Link page title."),
};

export async function createLink(
  args: {
    target_url: string;
    custom_path?: string;
    title?: string;
    subtitle?: string;
    campaign_id?: string;
    metadata?: Record<string, string>;
    social_title?: string;
    social_description?: string;
    social_image?: string;
    ios_button_text?: string;
    android_button_text?: string;
  },
  deps: Pick<Deps, "env" | "fetch">
) {
  const body = {
    android_button_text: args.android_button_text,
    campaignId: args.campaign_id,
    customPath: args.custom_path,
    ios_button_text: args.ios_button_text,
    metadata: args.metadata,
    social_description: args.social_description,
    social_image: args.social_image,
    social_title: args.social_title,
    subtitle: args.subtitle,
    targetUrl: args.target_url,
    title: args.title,
  };
  const res = await apiRequest<Row & { urlPath?: string }>(
    deps,
    "POST",
    "/api/v1/deeplinks",
    { body }
  );
  if (!res.ok) {
    return fail(res.message);
  }
  if (typeof res.data.id !== "string") {
    return unexpected(res.data, deps.env.apiKey);
  }
  const row = res.data;
  const text = [
    `Created ${row.shortUrl ?? row.urlPath ?? "the link"}`,
    row.id ? `id ${row.id}` : "",
    `The app receives path "/${(row.urlPath ?? row.url_path ?? "").split("?")[0]}" when this link is opened or deferred.`,
    args.title ||
    args.subtitle ||
    args.ios_button_text ||
    args.android_button_text
      ? "Translations of the page text are generated in the background."
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  return ok(
    redact(text, deps.env.apiKey),
    redactDeep({ link: row }, deps.env.apiKey)
  );
}
