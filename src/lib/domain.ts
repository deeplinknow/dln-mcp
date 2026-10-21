/**
 * MCP-12 (TOOL-02 rules): turn what the user typed ("example.com",
 * "https://go.example.com/x?y", " Example.COM ") into a lowercase hostname, or
 * a friendly error. Ported from web/utils/tools/domain.ts.
 */
export type DomainInput =
  | { ok: true; host: string }
  | { ok: false; error: string };

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export function normalizeDomain(input: string | null | undefined): DomainInput {
  const raw = (input ?? "").trim();
  if (!raw) {
    return { error: "Enter a domain, like go.yourapp.com.", ok: false };
  }
  if (raw.length > 2048) {
    return { error: "That's too long to be a domain.", ok: false };
  }

  let host: string;
  try {
    host = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`
    ).hostname;
  } catch {
    return { error: "That doesn't look like a domain.", ok: false };
  }
  host = host.toLowerCase().replace(/\.$/, "");

  if (host.startsWith("[") || IPV4.test(host)) {
    return { error: "Enter a domain name, not an IP address.", ok: false };
  }
  if (host.length > 253 || !host.includes(".")) {
    return { error: "That doesn't look like a full domain name.", ok: false };
  }
  const labels = host.split(".");
  if (!labels.every((label) => LABEL.test(label))) {
    return {
      error: "That domain has characters a hostname can't have.",
      ok: false,
    };
  }
  if (/^\d+$/.test(labels.at(-1) ?? "")) {
    return { error: "That doesn't look like a full domain name.", ok: false };
  }
  return { host, ok: true };
}

/** a.b.example.com → [a.b.example.com, b.example.com, example.com]. */
export function selfAndParents(host: string): string[] {
  const labels = host.split(".");
  const out: string[] = [];
  for (let i = 0; i < labels.length - 1; i += 1) {
    out.push(labels.slice(i).join("."));
  }
  return out;
}
