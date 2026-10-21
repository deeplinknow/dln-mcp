/** The shape every domain check reports in (same as web/utils/tools/checks.ts). */
export type CheckStatus = "pass" | "warn" | "fail" | "info";

export interface Check {
  /** One sentence: what's wrong and how to fix it, or why it's fine. */
  detail: string;
  status: CheckStatus;
  title: string;
}

export function worst(checks: Check[]): CheckStatus {
  if (checks.some((c) => c.status === "fail")) {
    return "fail";
  }
  if (checks.some((c) => c.status === "warn")) {
    return "warn";
  }
  return "pass";
}

export const isJsonContentType = (contentType: string | null) =>
  /^application\/(?:[\w.+-]+\+)?json\b/i.test(contentType ?? "");
