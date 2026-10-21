/**
 * Facts from docs/product/matching.md (MATCH-20..33, MATCH-40) and
 * docs/sdks/overview.md (SDK-13, SDK-14, SDK-16) that explain_match_result
 * relies on. If those requirements change, change these too.
 */
export const WEIGHTS = {
  device: 30,
  device_model: 6,
  hardware_fingerprint: 6,
  ip: 40,
  language: 5,
  locale: 10,
  os_version: 9,
  platform: 9,
  time: 20,
  timezone: 5,
} as const;

/** CONFIDENCE_THRESHOLDS on the server (MATCH-32). */
export const THRESHOLDS = { HIGH: 75, LOW: 30, MEDIUM: 50 } as const;

/** The server claims its top candidate for the calling device at this score or above (MATCH-40). */
export const CLAIM_SCORE = 50;

/** Everything except IP adds up to this, so a match without an IP match can't reach HIGH. */
export const MAX_WITHOUT_IP = WEIGHTS.device + WEIGHTS.time + WEIGHTS.locale;

export type Quality = "HIGH" | "MEDIUM" | "LOW";

export function qualityOf(score: number): Quality | null {
  if (score >= THRESHOLDS.HIGH) {
    return "HIGH";
  }
  if (score >= THRESHOLDS.MEDIUM) {
    return "MEDIUM";
  }
  if (score >= THRESHOLDS.LOW) {
    return "LOW";
  }
  return null;
}

/** MATCH-27: full credit to 5 minutes, then linear to 0 at 60. */
export function timeScore(minutes: number): number {
  if (minutes <= 5) {
    return 20;
  }
  if (minutes >= 60) {
    return 0;
  }
  return (20 * (60 - minutes)) / 55;
}
