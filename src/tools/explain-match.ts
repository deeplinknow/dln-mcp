/**
 * explain_match_result (MCP-30..35): explains a fingerprint match's
 * confidence_score / match_quality and how to pick minConfidence, using only
 * the rules in docs/product/matching.md and docs/sdks/overview.md. A match
 * with `score_version: 2` is explained on the v2 weights, one without it on
 * v1 (MATCH-72), and a bare score on the current scale (v2).
 */
import { z } from "zod";
import {
  CLAIM_SCORE,
  CURRENT_SCORE_VERSION,
  lastMinuteAtOrAbove,
  MAX_WITHOUT_IP,
  noIpScore,
  type Quality,
  qualityOf,
  type ScoreVersion,
  scoreVersionOf,
  staticPointsWithoutIp,
  THRESHOLDS,
  WEIGHTS_V1,
  WEIGHTS_V2,
} from "../lib/matching.js";
import { fail, ok } from "../lib/result.js";

export const explainMatchInput = {
  confidence_score: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe("Or just the score (0-100), if you don't have the JSON."),
  result: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Paste the JSON you want explained: a whole /api/v1/sdk/match response ({ matches, ttl_seconds }), one entry of its matches array, or the DeferredDeepLink that checkDeferredDeepLink returned (camelCase)."
    ),
  score_version: z
    .union([z.literal(1), z.literal(2)])
    .optional()
    .describe(
      "The scoring version, when the JSON doesn't carry score_version itself (a DeferredDeepLink doesn't). 2 for deeplinknow.com since 2026-10-24."
    ),
  source: z
    .enum(["referrer", "clipboard", "fingerprint"])
    .optional()
    .describe("The DeferredDeepLink's source, if known."),
};

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
const bool = (v: unknown): boolean | undefined =>
  typeof v === "boolean" ? v : undefined;

/** How the scoring version was decided, for the line that says so. */
type VersionFrom = "response" | "argument" | "absent" | "bare";

interface Candidate {
  details?: Json;
  quality?: string;
  score?: number;
  source?: string;
  version: ScoreVersion;
  versionFrom: VersionFrom;
}

function candidateOf(v: Json, override?: ScoreVersion): Candidate {
  const raw = v.score_version ?? v.scoreVersion;
  let version: ScoreVersion;
  let versionFrom: VersionFrom;
  if (raw !== undefined && raw !== null) {
    version = scoreVersionOf(raw);
    versionFrom = "response";
  } else if (override) {
    version = override;
    versionFrom = "argument";
  } else {
    version = 1;
    versionFrom = "absent";
  }
  return {
    details: isObj(v.match_details)
      ? v.match_details
      : isObj(v.matchDetails)
        ? v.matchDetails
        : undefined,
    quality:
      (typeof v.match_quality === "string" ? v.match_quality : undefined) ??
      (typeof v.matchQuality === "string" ? v.matchQuality : undefined),
    score: num(v.confidence_score) ?? num(v.confidenceScore),
    source: typeof v.source === "string" ? v.source.toLowerCase() : undefined,
    version,
    versionFrom,
  };
}

const yes = (b: boolean | undefined) =>
  b === undefined ? "not reported" : b ? "match" : "no match";

function fmt(n: number | undefined): string {
  return n === undefined ? "?" : String(Math.round(n * 100) / 100);
}

const IP_MISS_NOTE =
  " Normal on iOS: iCloud Private Relay, carrier NAT and Wi-Fi/cellular switches give the app a different IP from the browser. DeepLinkNow doesn't require an IP match, and compares exact addresses only (no subnet matching).";
const PLATFORM_MISS_NOTE =
  " A platform miss usually means the click came from another device, such as a desktop on the same Wi-Fi.";
const MISSING_NOTE =
  "Missing values never count as a match: a field neither side reported scores 0, not full marks.";

interface Parts {
  device: Json;
  deviceParts: Json;
  ip: Json;
  locale: Json;
  localeParts: Json;
  time: Json;
}

function partsOf(details: Json): Parts {
  const device = isObj(details.device_match) ? details.device_match : {};
  const locale = isObj(details.locale_match) ? details.locale_match : {};
  return {
    device,
    deviceParts: isObj(device.components) ? device.components : {},
    ip: isObj(details.ip_match) ? details.ip_match : {},
    locale,
    localeParts: isObj(locale.components) ? locale.components : {},
    time: isObj(details.time_proximity) ? details.time_proximity : {},
  };
}

function ipLine(ip: Json, max: number): string {
  const matched = bool(ip.matched);
  return `- IP (${fmt(num(ip.score))} of ${max}): ${yes(matched)}.${matched === false ? IP_MISS_NOTE : ""}`;
}

function timeLine(time: Json, max: number): string {
  const minutes = num(time.time_difference_minutes);
  return `- Time (${fmt(num(time.score))} of ${max}): ${
    minutes === undefined
      ? "gap not reported"
      : `about ${minutes} min between the click and this request`
  }. Full credit up to 5 minutes, then a straight line down to 0 at 60 minutes (the 1-hour claim window).`;
}

/** v1: every device and locale sub-component earned points. */
function explainDetailsV1(p: Parts): string[] {
  const w = WEIGHTS_V1;
  return [
    ipLine(p.ip, w.ip),
    `- Device (${fmt(num(p.device.score))} of ${w.device}): platform ${yes(bool(p.deviceParts.platform))} (${w.platform}), OS version ${yes(bool(p.deviceParts.os_version))} (${w.os_version}), device class ${yes(bool(p.deviceParts.device_model))} (${w.device_model}), screen/hardware ${yes(bool(p.deviceParts.hardware_fingerprint))} (${w.hardware_fingerprint}).${
      bool(p.deviceParts.platform) === false ? PLATFORM_MISS_NOTE : ""
    }`,
    timeLine(p.time, w.time),
    `- Locale (${fmt(num(p.locale.score))} of ${w.locale}): language ${yes(bool(p.localeParts.language))} (${w.language}), time zone ${yes(bool(p.localeParts.timezone))} (${w.timezone}).`,
    MISSING_NOTE,
  ];
}

/**
 * v2 OS points: 12 exact, 6 when only a frozen-UA rule agrees (MATCH-74).
 * The response has one os_version boolean for both, so the points are read
 * off the device score (screen is 15 or 0, so 6 or 21 means inferred).
 */
function osLineV2(p: Parts, gatesPass: boolean): string {
  const w = WEIGHTS_V2;
  const os = bool(p.deviceParts.os_version);
  if (os !== true) {
    return `OS version ${yes(os)} (0 of ${w.os_version})`;
  }
  if (!gatesPass) {
    return "OS version match (not counted: a gate failed)";
  }
  const score = num(p.device.score);
  const screen =
    bool(p.deviceParts.hardware_fingerprint) === true ? w.screen : 0;
  const osPoints = score === undefined ? undefined : score - screen;
  if (osPoints === w.os_version_inferred) {
    return `OS version match, inferred (${w.os_version_inferred} of ${w.os_version}: the browser couldn't report its real OS version, as with Chrome or an in-app browser on iOS 26+ and Chrome on Android, so a compatible version earns half)`;
  }
  if (osPoints === w.os_version) {
    return `OS version match, exact (${w.os_version} of ${w.os_version})`;
  }
  return `OS version match (${w.os_version} when the major versions are equal, ${w.os_version_inferred} when they only agree through a frozen browser user agent)`;
}

/** v2: platform and device class are gates worth 0 points (MATCH-73). */
function explainDetailsV2(p: Parts): string[] {
  const w = WEIGHTS_V2;
  const platform = bool(p.deviceParts.platform);
  const deviceClass = bool(p.deviceParts.device_model);
  const gatesPass = platform === true && deviceClass === true;
  const gateNote =
    platform === false || deviceClass === false
      ? ` A gate failed, so the device score is 0 whatever the OS and screen say.${platform === false ? PLATFORM_MISS_NOTE : " A device class miss means, for example, an iPad click and an iPhone open."}`
      : "";
  return [
    ipLine(p.ip, w.ip),
    `- Device (${fmt(num(p.device.score))} of ${w.device}): gates first, worth 0 points: platform ${yes(platform)}, device class ${yes(deviceClass)}. Then ${osLineV2(p, gatesPass)}, screen ${yes(bool(p.deviceParts.hardware_fingerprint))} (${w.screen}).${gateNote}`,
    timeLine(p.time, w.time),
    `- Locale (${fmt(num(p.locale.score))} of ${w.locale}): time zone ${yes(bool(p.localeParts.timezone))} (${w.timezone}), language ${yes(bool(p.localeParts.language))} (${w.language}).`,
    MISSING_NOTE,
  ];
}

/** One line per component of match_details, with what a miss usually means. */
export function explainDetails(
  details: Json,
  version: ScoreVersion = CURRENT_SCORE_VERSION
): string[] {
  const parts = partsOf(details);
  return version === 2 ? explainDetailsV2(parts) : explainDetailsV1(parts);
}

function versionLine(c: Candidate): string {
  switch (c.versionFrom) {
    case "response":
      return `Scoring version ${c.version} (score_version in the response).`;
    case "argument":
      return `Scoring version ${c.version} (from the score_version argument).`;
    case "absent":
      return "No score_version, so this is read as scoring version 1: servers before 2026-10-24 and the test_api_key demo answers. deeplinknow.com scores with version 2 since 2026-10-24 and says so in every /sdk/match result. The SDK's DeferredDeepLink doesn't carry score_version, so if this came from checkDeferredDeepLink against deeplinknow.com after that date, ask again with score_version: 2.";
    default:
      return "Read on the current scale, scoring version 2 (deeplinknow.com since 2026-10-24). The bands are the same in version 1, so the label holds either way; only the points behind it differ. Paste the whole match to see each component.";
  }
}

function weightsLine(version: ScoreVersion): string {
  if (version === 2) {
    const w = WEIGHTS_V2;
    return `The score is a weighted sum: IP ${w.ip} + device ${w.device} (screen ${w.screen}, OS version ${w.os_version} or ${w.os_version_inferred} when inferred; counted only when the platform and device class agree) + time ${w.time} + locale ${w.locale} (time zone ${w.timezone}, language ${w.language}).`;
  }
  const w = WEIGHTS_V1;
  return `The score is a weighted sum (version 1): IP ${w.ip} + device ${w.device} + time ${w.time} + locale ${w.locale}.`;
}

function explainCandidate(c: Candidate, label: string): string[] {
  if (c.source === "referrer" || c.source === "clipboard") {
    return [
      `### ${label}: source ${c.source} (exact)`,
      `${c.source === "referrer" ? "The Play Install Referrer carried this click's ID through the install" : "The landing page copied this link to the pasteboard and the app read it"}, so it isn't a guess. The SDK reports confidenceScore 100 and matchQuality HIGH for it, and minConfidence never filters it.`,
    ];
  }
  const lines = [`### ${label}`];
  if (c.score === undefined) {
    lines.push("No confidence_score found in this object.");
    return lines;
  }
  const computed = qualityOf(c.score);
  lines.push(
    `confidence_score ${c.score} → ${computed ?? "below 30 (the server never returns these)"}${
      c.quality && c.quality !== computed
        ? ` (the object says ${c.quality}; the server derives the label from the rounded score, so check that the score and label come from the same response)`
        : ""
    }.`
  );
  lines.push(versionLine(c));
  lines.push(
    `Bands: HIGH ≥ ${THRESHOLDS.HIGH}, MEDIUM ${THRESHOLDS.MEDIUM}–${THRESHOLDS.HIGH - 1}, LOW ${THRESHOLDS.LOW}–${THRESHOLDS.MEDIUM - 1}. ${weightsLine(c.version)}`
  );
  if (c.score >= CLAIM_SCORE) {
    lines.push(
      `At ${CLAIM_SCORE} or more, the server claims its top candidate for the device that asked (when the SDK sent a device ID), so another phone can't receive the same click.`
    );
  } else {
    lines.push(
      `Below ${CLAIM_SCORE} the click isn't claimed, so the same candidate can also be offered to other devices within the hour.`
    );
  }
  if (c.details) {
    lines.push(...explainDetails(c.details, c.version));
  }
  return lines;
}

/** Minutes after the tap at which a no-IP match drops below `target`, rounded to a whole minute. */
function dropMinute(
  osInferred: boolean,
  version: ScoreVersion,
  target: number = CLAIM_SCORE
): number {
  const last = lastMinuteAtOrAbove(
    staticPointsWithoutIp(version, osInferred),
    target,
    version
  );
  return Math.round(last ?? 0);
}

/** Every number here comes from the scoring functions in lib/matching.ts (MCP-34). */
export function thresholdGuide(): string {
  const exact = [3, 30, 45].map((m) => noIpScore(m, 2));
  const inferred = noIpScore(3, 2, true);
  const v1 = [3, 30, 45].map((m) => noIpScore(m, 1));
  return `## Choosing minConfidence

- **Off (the default).** Every candidate the server returns (score 30 or more) is eligible, and the SDK returns the best one. DeepLinkNow gives honest scores; the threshold is your choice. A common pattern, from the DeepLinkNow docs: route \`HIGH\` matches straight away and confirm \`MEDIUM\` or \`LOW\` ones with the user ("Continue to …?").
- **minConfidence: 50** keeps MEDIUM and HIGH, the same bar at which the server claims a click for one device. An exact iOS Safari match behind iCloud Private Relay (different IP, everything else agrees) scores ${exact[0]} within 5 minutes of the tap, ${exact[1]} after 30 minutes and ${exact[2]} after 45 minutes, so it drops below 50 about ${dropMinute(false, 2)} minutes after the tap. When the browser couldn't report its real OS version (Chrome or an in-app browser such as Instagram's on iOS 26+, Chrome on Android), the same match scores ${inferred} and drops below 50 about ${dropMinute(true, 2)} minutes after the tap.
- **minConfidence: 55** also drops those inferred-OS matches without an IP match (${inferred} at best), while an exact one passes until about ${dropMinute(false, 2, 55)} minutes after the tap.
- **minConfidence: 75** keeps HIGH only. Without an IP match the other components add up to at most ${MAX_WITHOUT_IP}, so 75 effectively requires the same IP and drops every match where the app's IP differs from the browser's (common with iCloud Private Relay).
- **Tuned on scoring version 1?** Before 2026-10-24 the same no-IP match scored ${v1[0]}, ${v1[1]} and ${v1[2]} (below 50 about ${dropMinute(false, 1)} minutes after the tap), whatever the browser. Version 2 scores an inferred OS version and a different time zone lower, so the same minConfidence can let fewer fingerprint matches through. Check \`score_version\` in the /sdk/match response.
- minConfidence applies only to \`source: "fingerprint"\`. Referrer (Android) and clipboard (iOS) results are exact and never filtered.
- For anything where a wrong match costs something (a referral credit, someone else's invite, pre-filled personal data), act only on exact sources or HIGH, or confirm with the user. A fingerprint match is a scored guess, not an identity.
- Keep your own "handled" flag: the SDK returns a link at most once per install unless you pass \`force\`.

Sources: https://deeplinknow.com/docs/ios.md#how-fingerprint-matching-works and https://deeplinknow.com/docs/integration-checklist.md`;
}

export const THRESHOLD_GUIDE = thresholdGuide();

interface Structured {
  candidates: {
    quality: Quality | null;
    score?: number;
    score_version: ScoreVersion;
  }[];
}

function record(structured: Structured, c: Candidate) {
  structured.candidates.push({
    quality: c.score === undefined ? null : qualityOf(c.score),
    score: c.score,
    score_version: c.version,
  });
}

export function explainMatch(args: {
  result?: Json;
  confidence_score?: number;
  score_version?: ScoreVersion;
  source?: "referrer" | "clipboard" | "fingerprint";
}) {
  const lines = ["# DeepLinkNow match result"];
  const structured: Structured = { candidates: [] };

  if (args.result) {
    const matches = Array.isArray(args.result.matches)
      ? args.result.matches.filter(isObj)
      : null;
    if (matches) {
      if (matches.length === 0) {
        lines.push(
          "",
          "`matches` is empty: no click on this app's link pages in the last hour scored 30 or more against this device. Check that the link was tapped within the hour, on this app's domain, and that the landing page loaded (it stores the click)."
        );
      }
      matches.slice(0, 3).forEach((m, i) => {
        const c = candidateOf(m, args.score_version);
        record(structured, c);
        lines.push("", ...explainCandidate(c, `Candidate ${i + 1}`));
      });
      if (matches.length > 3) {
        lines.push(
          "",
          `(${matches.length - 3} more candidates, lower scores, not shown.)`
        );
      }
      lines.push(
        "",
        "The server sorts candidates best first, and checkDeferredDeepLink takes the first one that has a link and passes minConfidence. It never re-scores or reorders them."
      );
    } else {
      const c = candidateOf(args.result, args.score_version);
      if (args.source) {
        c.source = args.source;
      }
      record(structured, c);
      lines.push("", ...explainCandidate(c, "This match"));
    }
  } else if (args.confidence_score !== undefined || args.source) {
    const c: Candidate = {
      score: args.confidence_score,
      source: args.source,
      version: args.score_version ?? CURRENT_SCORE_VERSION,
      versionFrom: args.score_version ? "argument" : "bare",
    };
    record(structured, c);
    lines.push("", ...explainCandidate(c, "This match"));
  } else {
    return fail(
      "Give `result` (the match JSON) or `confidence_score` (a number from 0 to 100)."
    );
  }

  lines.push("", THRESHOLD_GUIDE);
  return ok(lines.join("\n"), { candidates: structured.candidates });
}
