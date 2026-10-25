import { describe, expect, it } from "vitest";
import {
  CLAIM_SCORE,
  lastMinuteAtOrAbove,
  MAX_WITHOUT_IP,
  noIpScore,
  qualityOf,
  roundScore,
  staticPointsWithoutIp,
  timeScore,
  WEIGHTS_V1,
  WEIGHTS_V2,
} from "../lib/matching.js";
import { callTool, makeDeps } from "./helpers/fakes.js";

const components = (all: boolean) => ({
  device_model: all,
  hardware_fingerprint: all,
  os_version: all,
  platform: all,
});

/** v1 example S2 (matching.md §2.7, v1 column): same iPhone, Private Relay IP, 3 minutes. No score_version. */
const S2_V1 = {
  confidence_score: 60,
  deeplink: { full_path: "/products/123?ref=x", id: "d1" },
  match_details: {
    device_match: { components: components(true), matched: true, score: 30 },
    ip_match: { matched: false, score: 0 },
    locale_match: {
      components: { language: true, timezone: true },
      matched: true,
      score: 10,
    },
    time_proximity: { score: 20, time_difference_minutes: 3 },
  },
  match_quality: "MEDIUM",
};

/** v2 example S2 (table A): the baseline click's OS is frozen (18 vs 26), so the OS is inferred: 6 + screen 15. */
const S2_V2 = {
  confidence_score: 54,
  match_details: {
    device_match: { components: components(true), matched: true, score: 21 },
    ip_match: { matched: false, score: 0 },
    locale_match: {
      components: { language: true, timezone: true },
      matched: true,
      score: 15,
    },
    time_proximity: { score: 18, time_difference_minutes: 3 },
  },
  match_quality: "MEDIUM",
  score_version: 2,
};

/** v2 case C2 (table B): exact Safari version, Private Relay, Δ 3: 60. */
const C2_V2 = {
  ...S2_V2,
  confidence_score: 60,
  match_details: {
    ...S2_V2.match_details,
    device_match: { components: components(true), matched: true, score: 27 },
  },
};

/** v2 example S7: same IP, but the click came from a Mac (the gates fail). */
const S7_V2 = {
  confidence_score: 73,
  match_details: {
    device_match: { components: components(false), matched: false, score: 0 },
    ip_match: { matched: true, score: 40 },
    locale_match: {
      components: { language: true, timezone: true },
      matched: true,
      score: 15,
    },
    time_proximity: { score: 18, time_difference_minutes: 1 },
  },
  match_quality: "MEDIUM",
  score_version: 2,
};

describe("explain_match_result", () => {
  it("MCP-30: accepts a whole /sdk/match response, one match, a DeferredDeepLink or a bare score", async () => {
    const whole = await callTool(makeDeps(), "explain_match_result", {
      result: { matches: [C2_V2, S7_V2], ttl_seconds: 3600 },
    });
    expect(whole.text).toContain("### Candidate 1");
    expect(whole.text).toContain("### Candidate 2");
    expect(whole.text).toContain("never re-scores or reorders them");
    expect(whole.structuredContent).toEqual({
      candidates: [
        { quality: "MEDIUM", score: 60, score_version: 2 },
        { quality: "MEDIUM", score: 73, score_version: 2 },
      ],
    });

    const camel = await callTool(makeDeps(), "explain_match_result", {
      result: {
        confidenceScore: 82,
        matchDetails: S2_V2.match_details,
        matchQuality: "HIGH",
        path: "/p",
        source: "fingerprint",
      },
      score_version: 2,
    });
    expect(camel.text).toContain("confidence_score 82 → HIGH");
    expect(camel.text).toContain(
      "Scoring version 2 (from the score_version argument)."
    );

    const bare = await callTool(makeDeps(), "explain_match_result", {
      confidence_score: 45,
    });
    expect(bare.text).toContain("confidence_score 45 → LOW");

    const empty = await callTool(makeDeps(), "explain_match_result", {
      result: { matches: [], ttl_seconds: 3600 },
    });
    expect(empty.text).toContain("`matches` is empty");

    const nothing = await callTool(makeDeps(), "explain_match_result", {});
    expect(nothing.isError).toBe(true);
  });

  it("MCP-31: derives the label from the score with the server's thresholds and flags a label that disagrees", async () => {
    expect([
      qualityOf(75),
      qualityOf(74),
      qualityOf(50),
      qualityOf(49),
      qualityOf(30),
      qualityOf(29),
    ]).toEqual(["HIGH", "MEDIUM", "MEDIUM", "LOW", "LOW", null]);
    const res = await callTool(makeDeps(), "explain_match_result", {
      result: { confidence_score: 76, match_quality: "MEDIUM" },
    });
    expect(res.text).toContain(
      "confidence_score 76 → HIGH (the object says MEDIUM"
    );
  });

  it("MCP-32: explains each v2 component with its weight (gates, exact and inferred OS), missing ≠ match, no IP requirement and the claim at 50", async () => {
    expect(
      WEIGHTS_V2.ip + WEIGHTS_V2.device + WEIGHTS_V2.time + WEIGHTS_V2.locale
    ).toBe(100);
    expect(WEIGHTS_V2.screen + WEIGHTS_V2.os_version).toBe(WEIGHTS_V2.device);
    expect(WEIGHTS_V2.timezone + WEIGHTS_V2.language).toBe(WEIGHTS_V2.locale);
    expect(WEIGHTS_V2.os_version_inferred * 2).toBe(WEIGHTS_V2.os_version);

    const inferred = await callTool(makeDeps(), "explain_match_result", {
      result: S2_V2,
    });
    expect(inferred.text).toContain("confidence_score 54 → MEDIUM");
    expect(inferred.text).toContain(
      "Scoring version 2 (score_version in the response)."
    );
    expect(inferred.text).toContain(
      "IP 40 + device 27 (screen 15, OS version 12 or 6 when inferred; counted only when the platform and device class agree) + time 18 + locale 15 (time zone 10, language 5)"
    );
    expect(inferred.text).toContain(
      "- IP (0 of 40): no match. Normal on iOS: iCloud Private Relay"
    );
    expect(inferred.text).toContain("doesn't require an IP match");
    expect(inferred.text).toContain(
      "- Device (21 of 27): gates first, worth 0 points: platform match, device class match. Then OS version match, inferred (6 of 12"
    );
    expect(inferred.text).toContain("screen match (15).");
    expect(inferred.text).toContain("- Time (18 of 18): about 3 min");
    expect(inferred.text).toContain(
      "- Locale (15 of 15): time zone match (10), language match (5)."
    );
    expect(inferred.text).toContain("Missing values never count as a match");
    expect(inferred.text).toContain(
      "At 50 or more, the server claims its top candidate"
    );

    const exact = await callTool(makeDeps(), "explain_match_result", {
      result: C2_V2,
    });
    expect(exact.text).toContain(
      "- Device (27 of 27): gates first, worth 0 points: platform match, device class match. Then OS version match, exact (12 of 12), screen match (15)."
    );

    const desktop = await callTool(makeDeps(), "explain_match_result", {
      result: S7_V2,
    });
    expect(desktop.text).toContain("- Device (0 of 27)");
    expect(desktop.text).toContain(
      "A gate failed, so the device score is 0 whatever the OS and screen say."
    );
    expect(desktop.text).toContain("such as a desktop on the same Wi-Fi");

    const low = await callTool(makeDeps(), "explain_match_result", {
      confidence_score: 40,
    });
    expect(low.text).toContain("Below 50 the click isn't claimed");
  });

  it("MCP-33: treats referrer and clipboard results as exact and never filtered", async () => {
    for (const source of ["referrer", "clipboard"] as const) {
      const res = await callTool(makeDeps(), "explain_match_result", {
        result: {
          confidenceScore: 100,
          matchQuality: "HIGH",
          path: "/x",
          source,
        },
      });
      expect(res.text).toContain(`source ${source} (exact)`);
      expect(res.text).toContain("minConfidence never filters it");
    }
  });

  it("MCP-34: gives threshold guidance that matches the v2 scoring rules (rounded half up) and leaves the choice to the developer", async () => {
    expect(MAX_WITHOUT_IP).toBe(60);
    expect(roundScore(49.5)).toBe(50);
    expect(roundScore(49.499)).toBe(49);
    // matching.md table B C2 (exact Safari, no IP): 60 within 5 min; 42 + 18 × (60 − Δ)/55.
    expect(staticPointsWithoutIp(2)).toBe(42);
    expect(staticPointsWithoutIp(2, true)).toBe(36);
    expect(timeScore(30)).toBeCloseTo(9.818, 3);
    expect([noIpScore(3), noIpScore(30), noIpScore(45)]).toEqual([60, 52, 47]);
    // Rounds to 50 until 42 + time < 49.5, i.e. Δ > 37.08 min.
    expect(lastMinuteAtOrAbove(42, CLAIM_SCORE)).toBe(37.08);
    expect(noIpScore(37)).toBe(50);
    expect(noIpScore(37.2)).toBe(49);
    // Inferred OS (C1, S2): 54 within 5 min, 50 until Δ = 18.75.
    expect(noIpScore(3, 2, true)).toBe(54);
    expect(lastMinuteAtOrAbove(36, CLAIM_SCORE)).toBe(18.75);
    expect(lastMinuteAtOrAbove(42, 55)).toBe(21.8);
    expect(lastMinuteAtOrAbove(36, 55)).toBeNull();

    const res = await callTool(makeDeps(), "explain_match_result", {
      confidence_score: 60,
    });
    expect(res.text).toContain("**Off (the default).**");
    expect(res.text).toContain("the threshold is your choice");
    expect(res.text).toContain(
      "scores 60 within 5 minutes of the tap, 52 after 30 minutes and 47 after 45 minutes, so it drops below 50 about 37 minutes after the tap"
    );
    expect(res.text).toContain(
      "the same match scores 54 and drops below 50 about 19 minutes after the tap"
    );
    expect(res.text).toContain(
      "an exact one passes until about 22 minutes after the tap"
    );
    expect(res.text).toContain("other components add up to at most 60");
    expect(res.text).toContain(
      'minConfidence applies only to `source: "fingerprint"`'
    );
  });

  it("MCP-34: states the version 1 numbers for apps tuned before 2026-10-24", async () => {
    expect(
      WEIGHTS_V1.ip + WEIGHTS_V1.device + WEIGHTS_V1.time + WEIGHTS_V1.locale
    ).toBe(100);
    // matching.md §2.7 v1 column: S2 = 60 at 3 min, S3 = 51 at 30, S4 = 45 at 45.
    expect([noIpScore(3, 1), noIpScore(30, 1), noIpScore(45, 1)]).toEqual([
      60, 51, 45,
    ]);
    expect(lastMinuteAtOrAbove(40, CLAIM_SCORE, 1)).toBe(33.87);
    const res = await callTool(makeDeps(), "explain_match_result", {
      confidence_score: 60,
    });
    expect(res.text).toContain(
      "Before 2026-10-24 the same no-IP match scored 60, 51 and 45 (below 50 about 34 minutes after the tap)"
    );
  });

  it("MCP-35: explains a match with score_version 2 on v2, one without it on v1, and a bare score on v2 with a note", async () => {
    const v1 = await callTool(makeDeps(), "explain_match_result", {
      result: S2_V1,
    });
    expect(v1.text).toContain(
      "No score_version, so this is read as scoring version 1"
    );
    expect(v1.text).toContain("test_api_key");
    expect(v1.text).toContain(
      "The score is a weighted sum (version 1): IP 40 + device 30 + time 20 + locale 10."
    );
    expect(v1.text).toContain(
      "- Device (30 of 30): platform match (9), OS version match (9), device class match (6), screen/hardware match (6)."
    );
    expect(v1.text).toContain("- Time (20 of 20): about 3 min");
    expect(v1.text).toContain(
      "- Locale (10 of 10): language match (5), time zone match (5)."
    );
    expect(v1.structuredContent).toEqual({
      candidates: [{ quality: "MEDIUM", score: 60, score_version: 1 }],
    });

    // A whole response with v1 and v2 entries explains each on its own scale.
    const mixed = await callTool(makeDeps(), "explain_match_result", {
      result: { matches: [S2_V2, S2_V1] },
    });
    expect(mixed.structuredContent).toEqual({
      candidates: [
        { quality: "MEDIUM", score: 54, score_version: 2 },
        { quality: "MEDIUM", score: 60, score_version: 1 },
      ],
    });
    expect(mixed.text).toContain("- Device (21 of 27)");
    expect(mixed.text).toContain("- Device (30 of 30)");

    // The response's own score_version wins over the argument.
    const own = await callTool(makeDeps(), "explain_match_result", {
      result: { ...S2_V1, score_version: 1 },
      score_version: 2,
    });
    expect(own.text).toContain(
      "Scoring version 1 (score_version in the response)."
    );

    const bare = await callTool(makeDeps(), "explain_match_result", {
      confidence_score: 54,
    });
    expect(bare.text).toContain(
      "Read on the current scale, scoring version 2 (deeplinknow.com since 2026-10-24). The bands are the same in version 1"
    );
    expect(bare.text).toContain("IP 40 + device 27");
    expect(bare.structuredContent).toEqual({
      candidates: [{ quality: "MEDIUM", score: 54, score_version: 2 }],
    });
  });
});
