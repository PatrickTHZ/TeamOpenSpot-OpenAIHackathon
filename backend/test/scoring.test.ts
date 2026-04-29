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

  it("rejects invalid image data URLs", () => {
    expect(() =>
      validateAssessRequest({
        client: "chrome",
        imageCrop: {
          dataUrl: "data:text/plain;base64,SGVsbG8="
        }
      })
    ).toThrow(/imageCrop.dataUrl/);
  });

  it("preserves evidence storage consent fields", () => {
    const request = validateAssessRequest({
      client: "chrome",
      visibleText: "Example post text",
      consentToStoreEvidence: true,
      consentLabel: "training-qa-v1"
    });

    expect(request.consentToStoreEvidence).toBe(true);
    expect(request.consentLabel).toBe("training-qa-v1");
  });

  it("accepts optional web verification mode", () => {
    const request = validateAssessRequest({
      client: "chrome",
      visibleText: "Example claim",
      verificationMode: "web"
    });

    expect(request.verificationMode).toBe("web");
  });

  it("caps long request fields and repeated arrays", () => {
    const request = validateAssessRequest({
      client: "chrome",
      visibleText: "x".repeat(7000),
      visibleProfileSignals: Array.from({ length: 20 }, () => "y".repeat(400)),
      accountContext: {
        bioText: "b".repeat(1200),
        recentPosts: Array.from({ length: 8 }, (_, index) => ({
          text: "p".repeat(1200),
          postedAtText: `post ${index}`
        }))
      },
      extractedLinks: Array.from({ length: 20 }, (_, index) => ({
        href: `https://example.com/${index}`,
        text: "z".repeat(800),
        source: "dom"
      })),
      consentLabel: "c".repeat(300)
    });

    expect(request.visibleText?.length).toBe(6000);
    expect(request.visibleProfileSignals).toHaveLength(12);
    expect(request.visibleProfileSignals?.[0]?.length).toBe(280);
    expect(request.accountContext?.bioText?.length).toBe(1000);
    expect(request.accountContext?.recentPosts).toHaveLength(5);
    expect(request.accountContext?.recentPosts?.[0]?.text?.length).toBe(1000);
    expect(request.extractedLinks).toHaveLength(16);
    expect(request.extractedLinks?.[0]?.text?.length).toBe(500);
    expect(request.consentLabel?.length).toBe(200);
  });

  it("filters malformed links so they do not count as evidence", () => {
    expect(() =>
      validateAssessRequest({
        client: "chrome",
        extractedLinks: [{ text: "missing href" }]
      })
    ).toThrow(/Provide at least/);
  });

  it("rejects empty evidence", () => {
    expect(() => validateAssessRequest({ client: "android" })).toThrow(/Provide at least/);
  });

  it("rejects invalid clients and non-object bodies", () => {
    expect(() => validateAssessRequest(null)).toThrow(/JSON object/);
    expect(() => validateAssessRequest("bad")).toThrow(/JSON object/);
    expect(() => validateAssessRequest({ client: "web", visibleText: "hello" })).toThrow(/client must/);
  });

  it("ignores invalid content type values", () => {
    const request = validateAssessRequest({
      client: "chrome",
      visibleText: "hello",
      contentType: "video"
    });

    expect(request.contentType).toBeUndefined();
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
    expect(result.riskSignals?.some((signal) => signal.category === "source-credibility")).toBe(true);
    expect(result.requestedActions?.some((action) => action.action === "click_link")).toBe(true);
  });

  it("flags AI image suspicion from image descriptions", () => {
    const result = heuristicAssessment({
      client: "chrome",
      visibleText: "Look at this shocking photo.",
      imageCrop: {
        description: "The image appears AI generated and manipulated."
      }
    });

    expect(result.riskLevel).toBe("high");
    expect(result.evidenceAgainst.join(" ")).toContain("possible editing");
    expect(result.riskSignals?.some((signal) => signal.category === "ai-image-suspicion")).toBe(true);
  });

  it("lowers credibility for OCR-extracted synthetic before/after product claims", () => {
    const result = heuristicAssessment({
      client: "chrome",
      contentType: "post",
      authorName: "Marissa Lane",
      screenshotOcrText:
        "SYNTHETIC DEMO EXAMPLE For misinformation-detection testing. My aunt is 71. She started taking 1 spoon of SunBerry Gel every morning for 3 months. Her skin looks tighter. Before. After 3 months.",
      imageCrop: {
        description:
          "Screenshot contains before and after face images, a SunBerry Gel jar, and synthetic demo label."
      }
    });

    expect(result.riskLevel).toBe("high");
    expect(result.score).toBeLessThan(45);
    expect(result.evidenceAgainst.join(" ")).toContain("Text found in the image");
    expect(result.riskSignals?.some((signal) => signal.category === "claim-verification")).toBe(true);
    expect(result.riskSignals?.some((signal) => signal.category === "ai-image-suspicion")).toBe(true);
  });

  it("uses OCR claim content even when no link is present", () => {
    const result = heuristicAssessment({
      client: "android",
      screenshotOcrText:
        "After 30 days this wellness supplement reduced wrinkles and made skin look younger. Limited time miracle results.",
      imageCrop: {
        description: "OCR from a product ad screenshot."
      }
    });

    expect(result.riskLevel).toBe("high");
    expect(result.evidenceAgainst.join(" ")).toContain("product, health, or before/after claim");
  });

  it("does not treat normal visible text as image-extracted evidence", () => {
    const result = heuristicAssessment({
      client: "chrome",
      visibleText:
        "This supplement produced shocking anti-aging results in 30 days with no injections.",
      imageCrop: {
        description: "Benign screenshot crop of a social media post layout."
      }
    });

    expect(result.evidenceAgainst.join(" ")).not.toContain("Text found in the image");
    expect(result.riskSignals?.some((signal) => signal.category === "ai-image-suspicion")).not.toBe(true);
  });

  it("detects common generated-by-AI image wording", () => {
    const result = heuristicAssessment({
      client: "chrome",
      screenshotOcrText:
        "Before and after 3 months. SunBerry Gel wellness support. Image generated by AI.",
      imageCrop: {
        description: "Product transformation ad screenshot."
      }
    });

    expect(result.riskSignals?.some((signal) => signal.category === "ai-image-suspicion")).toBe(true);
  });

  it("deep-checks risky Facebook account context", () => {
    const result = heuristicAssessment({
      client: "chrome",
      visibleText: "This gel changed my aunt's face in 3 months before it disappears.",
      authorName: "Marissa Lane",
      accountContext: {
        profileUrl: "https://www.facebook.com/sunberry-deals",
        displayName: "SunBerry Deals",
        accountAgeText: "Joined this week",
        followerCountText: "18 followers",
        recentPosts: [
          { text: "DM me to claim your prize before it disappears", postedAtText: "Yesterday" },
          { text: "Limited time miracle skin gel discount, message me", postedAtText: "Today" }
        ]
      }
    });

    expect(result.accountCredibility?.level).toBe("low");
    expect(result.accountCredibility?.signalsAgainst.join(" ")).toContain("scam-like");
    expect(result.riskSignals?.some((signal) => signal.category === "account-credibility")).toBe(true);
  });

  it("recognizes established supplied account context", () => {
    const result = heuristicAssessment({
      client: "chrome",
      visibleText: "The local council published evacuation routes for today.",
      authorName: "Example Council",
      authorHandle: "@examplecouncil",
      accountContext: {
        profileUrl: "https://www.facebook.com/examplecouncil",
        displayName: "Example Council",
        handle: "@examplecouncil",
        accountAgeText: "Joined 2014",
        followerCountText: "24K followers",
        verificationSignals: ["verified badge visible"],
        recentPosts: [
          { text: "Road closure update for Main Street.", postedAtText: "Monday" },
          { text: "Community library hours this weekend.", postedAtText: "Tuesday" }
        ]
      }
    });

    expect(result.accountCredibility?.level).toBe("high");
    expect(result.accountCredibility?.signalsFor.join(" ")).toContain("visible age");
  });

  it("adds missing signal for image-dependent claims without OCR evidence", () => {
    const result = heuristicAssessment({
      client: "chrome",
      visibleText: "This photo shows official proof of the emergency."
    });

    expect(result.missingSignals.join(" ")).toContain("depends on an image");
  });

  it("detects concrete requested actions", () => {
    const result = heuristicAssessment({
      client: "chrome",
      visibleText:
        "Call this number, pay now with gift cards, share your one-time code, and download the attachment.",
      extractedLinks: [{ href: "https://bit.ly/download", source: "dom" }]
    });

    expect(result.requestedActions?.map((action) => action.action)).toEqual(
      expect.arrayContaining(["click_link", "call_phone", "send_money", "share_code", "download_file"])
    );
  });

  it("does not treat words like clickable or public as call/click requests", () => {
    const result = heuristicAssessment({
      client: "chrome",
      visibleText: "This public post says no clickable URL is shown in the screenshot."
    });

    expect(result.requestedActions).toBeUndefined();
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
