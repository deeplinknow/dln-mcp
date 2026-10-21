import { describe, expect, it } from "vitest";
import {
  MAX_WITHOUT_IP,
  qualityOf,
  timeScore,
  WEIGHTS,
} from "../lib/matching.js";
import { callTool, makeDeps } from "./helpers/fakes.js";

/** Example S2 in docs/product/matching.md §2.7: same iPhone, Private Relay IP, 3 minutes. */
const S2 = {
  confidence_score: 60,
  deeplink: { full_path: "/products/123?ref=x", id: "d1" },
  match_details: {
    device_match: {
      components: {
        device_model: true,
        hardware_fingerprint: true,
        os_version: true,
        platform: true,
      },
      matched: true,
      score: 30,
    },
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

/** Example S7: same IP, but the click came from a Mac. */
const S7 = {
  confidence_score: 70,
  match_details: {
    device_match: {
      components: {
        device_model: false,
        hardware_fingerprint: false,
        os_version: false,
        platform: false,
      },
      matched: false,
      score: 0,
    },
    ip_match: { matched: true, score: 40 },
    locale_match: {
      components: { language: true, timezone: true },
      matched: true,
      score: 10,
    },
    time_proximity: { score: 20, time_difference_minutes: 1 },
  },
  match_quality: "MEDIUM",
};

describe("explain_match_result", () => {
  it("MCP-30: accepts a whole /sdk/match response, one match, a DeferredDeepLink or a bare score", async () => {
    const whole = await callTool(makeDeps(), "explain_match_result", {
      result: { matches: [S2, S7], ttl_seconds: 3600 },
    });
    expect(whole.text).toContain("### Candidate 1");
    expect(whole.text).toContain("### Candidate 2");
    expect(whole.text).toContain("never re-scores or reorders them");
    expect(whole.structuredContent).toEqual({
      candidates: [
        { quality: "MEDIUM", score: 60 },
        { quality: "MEDIUM", score: 70 },
      ],
    });

    const camel = await callTool(makeDeps(), "explain_match_result", {
      result: {
        confidenceScore: 82,
        matchDetails: S2.match_details,
        matchQuality: "HIGH",
        path: "/p",
        source: "fingerprint",
      },
    });
    expect(camel.text).toContain("confidence_score 82 → HIGH");

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

  it("MCP-32: explains each component with its weight, missing ≠ match, no IP requirement and the claim at 50", async () => {
    expect(WEIGHTS.ip + WEIGHTS.device + WEIGHTS.time + WEIGHTS.locale).toBe(
      100
    );
    expect(
      WEIGHTS.platform +
        WEIGHTS.os_version +
        WEIGHTS.device_model +
        WEIGHTS.hardware_fingerprint
    ).toBe(WEIGHTS.device);
    const res = await callTool(makeDeps(), "explain_match_result", {
      result: S2,
    });
    expect(res.text).toContain(
      "- IP (0 of 40): no match. Normal on iOS: iCloud Private Relay"
    );
    expect(res.text).toContain("doesn't require an IP match");
    expect(res.text).toContain(
      "- Device (30 of 30): platform match (9), OS version match (9), device class match (6), screen/hardware match (6)."
    );
    expect(res.text).toContain("- Time (20 of 20): about 3 min");
    expect(res.text).toContain("- Locale (10 of 10)");
    expect(res.text).toContain("Missing values never count as a match");
    expect(res.text).toContain(
      "At 50 or more, the server claims its top candidate"
    );

    const desktop = await callTool(makeDeps(), "explain_match_result", {
      result: S7,
    });
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

  it("MCP-34: gives threshold guidance that matches the scoring rules and leaves the choice to the developer", async () => {
    expect(MAX_WITHOUT_IP).toBe(60);
    // matching.md §2.7: S2 = 60 at 3 min, S3 = 51 at 30 min, S4 = 45 at 45 min (no IP match).
    const noIp = (minutes: number) => Math.round(30 + 10 + timeScore(minutes));
    expect([noIp(3), noIp(30), noIp(45)]).toEqual([60, 51, 45]);
    expect(noIp(33)).toBeGreaterThanOrEqual(50);
    expect(noIp(35)).toBeLessThan(50);

    const res = await callTool(makeDeps(), "explain_match_result", {
      confidence_score: 60,
    });
    expect(res.text).toContain("**Off (the default).**");
    expect(res.text).toContain("the threshold is your choice");
    expect(res.text).toContain(
      "scores about 60 within 5 minutes of the tap, 51 after 30 minutes and 45 after 45 minutes"
    );
    expect(res.text).toContain("about 34 minutes after the tap");
    expect(res.text).toContain("other components add up to at most 60");
    expect(res.text).toContain(
      'minConfidence applies only to `source: "fingerprint"`'
    );
  });
});
