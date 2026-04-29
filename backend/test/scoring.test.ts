import { describe, expect, it } from "vitest";
import {
  extractOutputText,
  heuristicAssessment,
  normalizeAssessment,
  validateAssessRequest
} from "../src/scoring";

describe("validateAssessRequest", () => {
  it("accepts useful chrome evidence", () => {
    const request = validateAssessRequest({
      client: "chrome",
      url: "https://example.com/news",
      visibleText: "A local council published a flood warning with evacuation routes."
    });

    expect(request.client).toBe("chrome");
    expect(request.url).toBe("https://example.com/news");
  });

  it("rejects empty evidence", () => {
    expect(() => validateAssessRequest({ client: "android" })).toThrow(/Provide at least/);
  });
});

describe("normalizeAssessment", () => {
  it("clamps score and recomputes band", () => {
    const result = normalizeAssessment({
      score: 140,
      band: "red",
      riskLevel: "high",
      label: "Suspicious",
      confidence: "high",
      plainLanguageSummary: "Looks supported.",
      why: ["Named source"],
      advice: "Read the original source.",
      evidenceFor: ["Named source"],
      evidenceAgainst: [],
      missingSignals: [],
      recommendedAction: "Read the original source."
    });

    expect(result.score).toBe(100);
    expect(result.band).toBe("green");
    expect(result.riskLevel).toBe("low");
    expect(result.label).toBe("Likely safe");
  });
});

describe("heuristicAssessment", () => {
  it("flags limited reels analysis", () => {
    const result = heuristicAssessment({
      client: "android",
      contentType: "reel",
      visibleText: "Breaking!!! They don't want you to know this secret cure",
      authorName: "Example Page"
    });

    expect(result.band).toBe("red");
    expect(result.riskLevel).toBe("high");
    expect(result.label).toBe("Suspicious");
    expect(result.advice).toContain("Do not click");
    expect(result.missingSignals.join(" ")).toContain("Video and audio");
  });
});

describe("extractOutputText", () => {
  it("reads response output_text shortcut", () => {
    expect(extractOutputText({ output_text: "{\"score\":80}" })).toBe("{\"score\":80}");
  });

  it("reads nested Responses API content", () => {
    expect(
      extractOutputText({
        output: [{ content: [{ type: "output_text", text: "{\"score\":60}" }] }]
      })
    ).toBe("{\"score\":60}");
  });
});
