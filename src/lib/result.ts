import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function ok(
  text: string,
  structured?: Record<string, unknown>
): CallToolResult {
  return structured
    ? { content: [{ text, type: "text" }], structuredContent: structured }
    : { content: [{ text, type: "text" }] };
}

export function fail(text: string): CallToolResult {
  return { content: [{ text, type: "text" }], isError: true };
}
