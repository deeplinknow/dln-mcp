/**
 * explain_match_result (MCP-30..34): explains a fingerprint match's
 * confidence_score / match_quality and how to pick minConfidence, using only
 * the rules in docs/product/matching.md and docs/sdks/overview.md.
 */
import { z } from "zod";
import {
  CLAIM_SCORE,
  MAX_WITHOUT_IP,
  type Quality,
  qualityOf,
  THRESHOLDS,
  WEIGHTS,
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

interface Candidate {
  details?: Json;
  quality?: string;
  score?: number;
  source?: string;
}

function candidateOf(v: Json): Candidate {
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
  };
}

const yes = (b: boolean | undefined) =>
  b === undefined ? "not reported" : b ? "match" : "no match";

function fmt(n: number | undefined): string {
  return n === undefined ? "?" : String(Math.round(n * 100) / 100);
}

/** One line per component of match_details, with what a miss usually means. */
export function explainDetails(details: Json): string[] {
  const out: string[] = [];
  const ip = isObj(details.ip_match) ? details.ip_match : {};
  const device = isObj(details.device_match) ? details.device_match : {};
  const deviceParts = isObj(device.components) ? device.components : {};
  const time = isObj(details.time_proximity) ? details.time_proximity : {};
  const locale = isObj(details.locale_match) ? details.locale_match : {};
  const localeParts = isObj(locale.components) ? locale.components : {};

  const ipMatched = bool(ip.matched);
  out.push(
    `- IP (${fmt(num(ip.score))} of ${WEIGHTS.ip}): ${yes(ipMatched)}.${
      ipMatched === false
        ? " Normal on iOS: iCloud Private Relay, carrier NAT and Wi-Fi/cellular switches give the app a different IP from the browser. DeepLinkNow doesn't require an IP match, and compares exact addresses only (no subnet matching)."
        : ""
    }`
  );
  out.push(
    `- Device (${fmt(num(device.score))} of ${WEIGHTS.device}): platform ${yes(bool(deviceParts.platform))} (${WEIGHTS.platform}), OS version ${yes(bool(deviceParts.os_version))} (${WEIGHTS.os_version}), device class ${yes(bool(deviceParts.device_model))} (${WEIGHTS.device_model}), screen/hardware ${yes(bool(deviceParts.hardware_fingerprint))} (${WEIGHTS.hardware_fingerprint}).${
      bool(deviceParts.platform) === false
        ? " A platform miss usually means the click came from another device, such as a desktop on the same Wi-Fi."
        : ""
    }`
  );
  const minutes = num(time.time_difference_minutes);
  out.push(
    `- Time (${fmt(num(time.score))} of ${WEIGHTS.time}): ${
      minutes === undefined
        ? "gap not reported"
        : `about ${minutes} min between the click and this request`
    }. Full credit up to 5 minutes, then a straight line down to 0 at 60 minutes (the 1-hour claim window).`
  );
  out.push(
    `- Locale (${fmt(num(locale.score))} of ${WEIGHTS.locale}): language ${yes(bool(localeParts.language))} (${WEIGHTS.language}), time zone ${yes(bool(localeParts.timezone))} (${WEIGHTS.timezone}).`
  );
  out.push(
    "Missing values never count as a match: a field neither side reported scores 0, not full marks."
  );
  return out;
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
  lines.push(
    `Bands: HIGH ≥ ${THRESHOLDS.HIGH}, MEDIUM ${THRESHOLDS.MEDIUM}–${THRESHOLDS.HIGH - 1}, LOW ${THRESHOLDS.LOW}–${THRESHOLDS.MEDIUM - 1}. The score is a weighted sum: IP ${WEIGHTS.ip} + device ${WEIGHTS.device} + time ${WEIGHTS.time} + locale ${WEIGHTS.locale}.`
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
    lines.push(...explainDetails(c.details));
  }
  return lines;
}

export const THRESHOLD_GUIDE = `## Choosing minConfidence

- **Off (the default).** Every candidate the server returns (score 30 or more) is eligible, and the SDK returns the best one. DeepLinkNow gives honest scores; the threshold is your choice. A common pattern, from the DeepLinkNow docs: route \`HIGH\` matches straight away and confirm \`MEDIUM\` or \`LOW\` ones with the user ("Continue to …?").
- **minConfidence: 50** keeps MEDIUM and HIGH, the same bar at which the server claims a click for one device. The same phone behind iCloud Private Relay (different IP) scores about 60 within 5 minutes of the tap, 51 after 30 minutes and 45 after 45 minutes, so on iOS a match without an IP match drops below 50 about 34 minutes after the tap.
- **minConfidence: 75** keeps HIGH only. Without an IP match the other components add up to at most ${MAX_WITHOUT_IP}, so 75 effectively requires the same IP and drops every match where the app's IP differs from the browser's (common with iCloud Private Relay).
- minConfidence applies only to \`source: "fingerprint"\`. Referrer (Android) and clipboard (iOS) results are exact and never filtered.
- For anything where a wrong match costs something (a referral credit, someone else's invite, pre-filled personal data), act only on exact sources or HIGH, or confirm with the user. A fingerprint match is a scored guess, not an identity.
- Keep your own "handled" flag: the SDK returns a link at most once per install unless you pass \`force\`.

Sources: https://deeplinknow.com/docs/ios.md#how-fingerprint-matching-works and https://deeplinknow.com/docs/integration-checklist.md`;

export function explainMatch(args: {
  result?: Json;
  confidence_score?: number;
  source?: "referrer" | "clipboard" | "fingerprint";
}) {
  const lines = ["# DeepLinkNow match result"];
  const structured: {
    candidates: { score?: number; quality: Quality | null }[];
  } = {
    candidates: [],
  };

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
        const c = candidateOf(m);
        structured.candidates.push({
          quality: c.score === undefined ? null : qualityOf(c.score),
          score: c.score,
        });
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
      const c = candidateOf(args.result);
      if (args.source) {
        c.source = args.source;
      }
      structured.candidates.push({
        quality: c.score === undefined ? null : qualityOf(c.score),
        score: c.score,
      });
      lines.push("", ...explainCandidate(c, "This match"));
    }
  } else if (args.confidence_score !== undefined || args.source) {
    const c: Candidate = { score: args.confidence_score, source: args.source };
    structured.candidates.push({
      quality: c.score === undefined ? null : qualityOf(c.score),
      score: c.score,
    });
    lines.push("", ...explainCandidate(c, "This match"));
  } else {
    return fail(
      "Give `result` (the match JSON) or `confidence_score` (a number from 0 to 100)."
    );
  }

  lines.push("", THRESHOLD_GUIDE);
  return ok(lines.join("\n"), structured);
}
