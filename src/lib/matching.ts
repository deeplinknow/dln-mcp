/**
 * Facts from docs/product/matching.md (MATCH-20..33, MATCH-40, MATCH-72..74)
 * and docs/sdks/overview.md (SDK-13, SDK-14, SDK-16) that explain_match_result
 * relies on. If those requirements change, change these too.
 */

/** MATCH-72: the scoring rules a match was scored with. */
export type ScoreVersion = 1 | 2;

/** The version deeplinknow.com scores with since 2026-10-24 (RM-69). */
export const CURRENT_SCORE_VERSION: ScoreVersion = 2;

/** Scoring v1 (before 2026-10-24): every sub-component earned points. */
export const WEIGHTS_V1 = {
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

/**
 * Scoring v2 (MATCH-20, MATCH-73, MATCH-74): platform and device class are
 * gates worth 0 points; OS version earns 12 when the majors are equal and 6
 * when they agree only through a frozen-UA rule.
 */
export const WEIGHTS_V2 = {
  device: 27,
  ip: 40,
  language: 5,
  locale: 15,
  os_version: 12,
  os_version_inferred: 6,
  screen: 15,
  time: 18,
  timezone: 10,
} as const;

/** The weights deeplinknow.com uses now. */
export const WEIGHTS = WEIGHTS_V2;

/** CONFIDENCE_THRESHOLDS on the server (MATCH-32), the same in v1 and v2. */
export const THRESHOLDS = { HIGH: 75, LOW: 30, MEDIUM: 50 } as const;

/** The server claims its top candidate for the calling device at this score or above (MATCH-40). */
export const CLAIM_SCORE = 50;

/**
 * Everything except IP adds up to this, so a match without an IP match can't
 * reach HIGH. 60 in both versions (v1 30 + 20 + 10, v2 27 + 18 + 15).
 */
export const MAX_WITHOUT_IP =
  WEIGHTS_V2.device + WEIGHTS_V2.time + WEIGHTS_V2.locale;

/** MATCH-72: an absent score_version means v1. */
export function scoreVersionOf(value: unknown): ScoreVersion {
  return value === 2 ? 2 : 1;
}

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

const FULL_TIME_CREDIT_MINUTES = 5;
const WINDOW_MINUTES = 60;

function timeWeight(version: ScoreVersion): number {
  return version === 2 ? WEIGHTS_V2.time : WEIGHTS_V1.time;
}

/** MATCH-27: full credit to 5 minutes, then linear to 0 at 60. */
export function timeScore(
  minutes: number,
  version: ScoreVersion = CURRENT_SCORE_VERSION
): number {
  const max = timeWeight(version);
  if (minutes <= FULL_TIME_CREDIT_MINUTES) {
    return max;
  }
  if (minutes >= WINDOW_MINUTES) {
    return 0;
  }
  return (
    (max * (WINDOW_MINUTES - minutes)) /
    (WINDOW_MINUTES - FULL_TIME_CREDIT_MINUTES)
  );
}

/** MATCH-30: the sum rounded half up (with the server's epsilon), clamped to 0..100. */
export function roundScore(sum: number): number {
  return Math.min(100, Math.max(0, Math.floor(sum + 0.5 + 1e-9)));
}

/**
 * Points without IP and time when everything else agrees: device + locale.
 * `osInferred`: the OS matched only through a frozen-UA rule (v2: 6 of 12).
 */
export function staticPointsWithoutIp(
  version: ScoreVersion,
  osInferred = false
): number {
  if (version === 1) {
    return WEIGHTS_V1.device + WEIGHTS_V1.locale;
  }
  return (
    WEIGHTS_V2.screen +
    (osInferred ? WEIGHTS_V2.os_version_inferred : WEIGHTS_V2.os_version) +
    WEIGHTS_V2.locale
  );
}

/** The score of a match without an IP match where everything else agrees, `minutes` after the tap. */
export function noIpScore(
  minutes: number,
  version: ScoreVersion = CURRENT_SCORE_VERSION,
  osInferred = false
): number {
  return roundScore(
    staticPointsWithoutIp(version, osInferred) + timeScore(minutes, version)
  );
}

/**
 * The last minute (to 0.01) at which a match with `staticPoints` (everything
 * but time) still rounds to `target` or more, or null when it never does.
 */
export function lastMinuteAtOrAbove(
  staticPoints: number,
  target: number,
  version: ScoreVersion = CURRENT_SCORE_VERSION
): number | null {
  if (roundScore(staticPoints + timeScore(0, version)) < target) {
    return null;
  }
  let minute = 0;
  while (
    minute < WINDOW_MINUTES &&
    roundScore(staticPoints + timeScore(minute + 0.01, version)) >= target
  ) {
    minute = Math.round((minute + 0.01) * 100) / 100;
  }
  return minute;
}
