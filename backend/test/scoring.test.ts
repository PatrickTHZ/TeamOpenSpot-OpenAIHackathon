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

  it("accepts extracted links and image crop evidence", () => {
    const request = validateAssessRequest({
      client: "chrome",
      extractedLinks: [{ href: "https://bit.ly/example", source: "dom" }],
      imageCrop: {
        description: "Cropped post image containing text.",
        crop: { x: 0, y: 10, width: 320, height: 180 }
      }
    });

    expect(request.extractedLinks?.[0]?.href).toBe("https://bit.ly/example");
    expect(request.imageCrop?.crop?.width).toBe(320);
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

  it("flags suspicious shortened links", () => {
    const result = heuristicAssessment({
      client: "chrome",
      visibleText: "Act now and verify your account to claim your prize.",
      authorName: "Example Support",
      extractedLinks: [{ href: "https://bit.ly/claim-now", source: "dom" }]
    });

    expect(result.riskLevel).toBe("high");
    expect(result.evidenceAgainst.join(" ")).toContain("links look shortened");
  });

  it("gives stronger support to official source domains", () => {
    const result = heuristicAssessment({
      client: "chrome",
      url: "https://www.health.gov.au/news/example-update",
      visibleText: "The health department published an update today about vaccine appointments.",
      authorName: "Department of Health",
      visibleProfileSignals: ["official government page"]
    });

    expect(result.riskLevel).toBe("low");
    expect(result.evidenceFor.join(" ")).toContain("official");
  });

  it("flags high-impact claims without trusted support", () => {
    const result = heuristicAssessment({
      client: "chrome",
      visibleText: "A secret cure is now guaranteed and doctors do not want you to know.",
      authorName: "Health Truth Daily"
    });

    expect(result.riskLevel).toBe("high");
    expect(result.evidenceAgainst.join(" ")).toContain("high-impact claim");
  });

  it("flags anchor text and destination mismatches", () => {
    const result = heuristicAssessment({
      client: "chrome",
      visibleText: "Official myGov account notice.",
      extractedLinks: [
        {
          text: "my.gov.au",
          href: "https://account-verify-prize.example.com/login",
          source: "dom"
        }
      ]
    });

    expect(result.riskLevel).toBe("high");
    expect(result.evidenceAgainst.join(" ")).toContain("different destination domain");
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
