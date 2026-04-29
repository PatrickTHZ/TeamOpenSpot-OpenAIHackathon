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

  it("accepts reverse image search provenance evidence", () => {
    const request = validateAssessRequest({
      client: "android",
      reverseImageSearch: {
        status: "checked",
        provider: "google_lens",
        summary: "Found matching university image results.",
        matches: [
          {
            title: "University of Technology Sydney",
            url: "https://www.uts.edu.au/about/campus",
            sourceName: "UTS",
            sourceType: "education",
            similarity: "exact",
            context: "Official campus page"
          }
        ]
      }
    });

    expect(request.reverseImageSearch?.status).toBe("checked");
    expect(request.reverseImageSearch?.matches?.[0]?.sourceType).toBe("education");
  });

  it("accepts the Android accessibility capture payload shape", () => {
    const request = validateAssessRequest({
      client: "android",
      visibleText: "Act now to claim your prize at www.example.com/claim",
      screenshotOcrText: "",
      contentType: "post",
      locale: "en-AU",
      visibleProfileSignals: ["Sponsored", "2 h", "Example profile image"],
      extractedLinks: [
        {
          text: "www.example.com/claim",
          href: "https://www.example.com/claim",
          source: "visible"
        }
      ]
    });

    expect(request.client).toBe("android");
    expect(request.visibleText).toContain("claim your prize");
    expect(request.visibleProfileSignals).toEqual(["Sponsored", "2 h", "Example profile image"]);
    expect(request.extractedLinks?.[0]).toEqual({
      text: "www.example.com/claim",
      href: "https://www.example.com/claim",
      source: "visible"
    });
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
    expect(result.advice).toContain("Do not act");
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

  it("scores Android accessibility capture output without requiring OCR or screenshots", () => {
    const request = validateAssessRequest({
      client: "android",
      visibleText: "Act now and click the link below to claim your prize.",
      screenshotOcrText: "",
      contentType: "post",
      locale: "en-AU",
      visibleProfileSignals: ["Sponsored"],
      extractedLinks: [
        {
          text: "bit.ly/claim-now",
          href: "https://bit.ly/claim-now",
          source: "visible"
        }
      ]
    });

    const result = heuristicAssessment(request);

    expect(result.riskLevel).toBe("high");
    expect(result.label).toBe("Suspicious");
    expect(result.requestedActions?.some((action) => action.action === "click_link")).toBe(true);
    expect(result.advice).toContain("Do not click");
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

  it("does not treat absent verification wording as a positive trust signal", () => {
    const result = heuristicAssessment({
      client: "chrome",
      visibleText: "Private AI stock watchlist available if you comment INFO.",
      authorName: "Example Investor",
      visibleProfileSignals: ["No verified badge visible in screenshot"]
    });

    expect(result.evidenceFor.join(" ")).not.toContain("official or verified source");
  });

  it("raises credibility when screenshot text shows a reputable news source", () => {
    const trusted = heuristicAssessment({
      client: "chrome",
      screenshotOcrText:
        "REUTERS Health agency says vaccine appointments will expand today after new supply numbers were confirmed.",
      imageCrop: {
        description: "Screenshot of a Reuters news card with logo visible."
      }
    });
    const unsupported = heuristicAssessment({
      client: "chrome",
      screenshotOcrText:
        "Health agency says vaccine appointments will expand today after new supply numbers were confirmed.",
      imageCrop: {
        description: "Screenshot of a social media card."
      }
    });

    expect(trusted.score).toBeGreaterThan(unsupported.score);
    expect(trusted.evidenceFor.join(" ")).toContain("Reuters");
    expect(trusted.riskSignals?.some((signal) => signal.category === "source-credibility")).toBe(true);
  });

  it("does not let a reputable logo override synthetic image warnings", () => {
    const result = heuristicAssessment({
      client: "chrome",
      screenshotOcrText:
        "BBC News synthetic demo example. Before and after 3 months. SunBerry Gel wellness support. Image generated by AI.",
      imageCrop: {
        description: "Synthetic screenshot with BBC News logo text and an AI-generated before/after ad."
      }
    });

    expect(result.riskLevel).toBe("high");
    expect(result.riskSignals?.some((signal) => signal.category === "ai-image-suspicion")).toBe(true);
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

  it("treats plausible food and hydration cramp advice as needs-checking instead of high risk", () => {
    const result = heuristicAssessment({
      client: "chrome",
      url: "https://www.instagram.com/p/example/",
      authorName: "healthyfoodtab",
      authorHandle: "@healthyfoodtab",
      visibleProfileSignals: ["No verified badge visible in screenshot"],
      visibleText:
        "Struggling with leg cramps at night? Your body might need more minerals. Magnesium supports muscle relaxation. Proper hydration is key.",
      screenshotOcrText:
        "Leg cramps at night? Fix it naturally. Banana, spinach, pumpkin seeds, avocado, Greek yogurt, water. Magnesium and hydration equals less cramps, better sleep.",
      imageCrop: {
        description: "AI-generated wellness infographic about foods, minerals, and hydration for leg cramps."
      }
    });

    expect(result.score).toBeGreaterThanOrEqual(68);
    expect(result.score).toBeLessThan(75);
    expect(result.riskLevel).toBe("medium");
    expect(result.evidenceFor.join(" ")).toContain("broad food, mineral, and hydration advice");
    expect(result.evidenceAgainst.join(" ")).not.toContain("high-impact claim");
  });

  it("treats benign Google Images university results as low risk browsing context", () => {
    const result = heuristicAssessment({
      client: "android",
      url: "https://www.google.com/search?tbm=isch&q=University+of+Technology+Sydney+Universities+Australia",
      authorName: "Universities Australia",
      visibleText:
        "google.com/search? Universities Australia University of Technology Sydney - Universities Australia Images may be subject to copyright. Learn more Visit Share Save UTS International Students UTS Faculties and Schools UTS",
      screenshotOcrText:
        "google.com/search? Universities Australia University of Technology Sydney - Universities Australia Images may be subject to copyright. Learn more Visit Share Save",
      imageCrop: {
        description:
          "Google Images viewer showing a UTS building. Source label says Universities Australia and title says University of Technology Sydney - Universities Australia."
      },
      contentType: "unknown"
    });

    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.riskLevel).toBe("low");
    expect(result.label).toBe("Likely safe");
    expect(result.evidenceFor.join(" ")).toContain("search result or image viewer");
    expect(result.requestedActions).toBeUndefined();
    expect(result.evidenceAgainst).toEqual([]);
  });

  it("does not mark ordinary personal Facebook posts as high risk just because no link was captured", () => {
    const result = heuristicAssessment({
      client: "android",
      contentType: "post",
      pageTitle: "Like button. Double tap and hold to react to the comment.",
      visibleText:
        "Like button. Double tap and hold to react to the comment.\nComment\nShare button. Double tap to share the post.\nAlex McNaught\n2d•Shared with: Public\nYay I've now got half a moon! It's a decent size so only 1/4 at a time fits on the print bed and takes 12-15 hours each quarter to print. I got a matte grey filament to best match.",
      screenshotOcrText: "Image or video description: Alex McNaught Profile picture\nImage or video description: Photo",
      visibleProfileSignals: ["App detected: Facebook", "Captured after scrolling paused for 1.5 seconds"],
      imageCrop: {
        description: "Image or video description: Alex McNaught Profile picture\nImage or video description: Photo"
      }
    });

    expect(result.score).toBeGreaterThanOrEqual(75);
    expect(result.riskLevel).toBe("low");
    expect(result.requestedActions).toBeUndefined();
  });

  it("treats normal verified sponsored ads and their signup actions as low risk", () => {
    const result = heuristicAssessment({
      client: "android",
      contentType: "post",
      pageTitle: "Is there a app that's free that you can view your shot while shooting",
      visibleText:
        "Amazon Web Services\nSponsored•Shared with: Public\nLearn how to integrate and scale production-ready AI solutions using proven architectures. Shared Link: Form, AWS Summit Sydney. Sign up.",
      screenshotOcrText: "Image or video description: Image",
      visibleProfileSignals: ["App detected: Facebook", "Captured after scrolling paused for 1.5 seconds"],
      imageCrop: { description: "Visible image or video has no readable description." }
    });

    expect(result.score).toBeGreaterThanOrEqual(60);
    expect(result.riskLevel).not.toBe("high");
    expect(result.requestedActions?.[0]?.risk).toBe("low");
  });

  it("treats normal ChatGPT signup ads as low risk when no scam signal is present", () => {
    const result = heuristicAssessment({
      client: "android",
      contentType: "post",
      pageTitle: "Create images with ChatGPT",
      visibleText:
        "ChatGPT\nSponsored · Public\nBreak big projects down with step-by-step guidance from ChatGPT. Try ChatGPT now. Sign up.",
      screenshotOcrText: "Image or video description: ChatGPT Profile picture\nImage",
      visibleProfileSignals: ["App detected: Facebook"],
      imageCrop: { description: "ChatGPT Profile picture" }
    });

    expect(result.score).toBeGreaterThanOrEqual(75);
    expect(result.riskLevel).toBe("low");
    expect(result.requestedActions?.[0]).toMatchObject({
      action: "click_link",
      risk: "low"
    });
  });

  it("does not let the word who accidentally match World Health Organization", () => {
    const result = heuristicAssessment({
      client: "android",
      contentType: "post",
      pageTitle: "Who has the cheapest first aid course in port?",
      visibleText:
        "Who has the cheapest first aid course in port?\nADF Careers\nSponsored•Shared with: Public\nWork at the leading edge of technical innovation in the Navy, Army or Air Force.",
      visibleProfileSignals: ["App detected: Facebook"],
      imageCrop: { description: "ADF Careers Profile picture" }
    });

    expect(result.riskSignals?.some((signal) => signal.message.includes("World Health Organization"))).not.toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(60);
  });

  it("treats event ticket bio links as commercial links to check, not high-impact claims", () => {
    const result = heuristicAssessment({
      client: "android",
      contentType: "post",
      pageTitle: "Shared Link: beacons.ai, @cosraves | FORT WORTH - FIVE NIGHTS AT FREDDY'S | Beacons",
      visibleText:
        "Shared Link: beacons.ai, @cosraves | FORT WORTH - FIVE NIGHTS AT FREDDY'S | Beacons\n@cosraves | FORT WORTH - FIVE NIGHTS AT FREDDY'S | Beacons\nBuy tickets\nLike button. Double tap and hold to react to the comment.\nComment\nShare button. Double tap to share the post.\nFair Work Ombudsman\nCan you actually be on call when you're on annual leave?",
      screenshotOcrText:
        "Image or video description: Image\nImage or video description: Fair Work Ombudsman Profile picture",
      visibleProfileSignals: ["App detected: Facebook"],
      imageCrop: { description: "Image or video description: Image" }
    });

    expect(result.score).toBeGreaterThanOrEqual(50);
    expect(result.riskLevel).toBe("medium");
    expect(result.evidenceAgainst).toEqual([]);
    expect(result.why.join(" ")).toContain("event or ticket post");
    expect(result.requestedActions?.[0]).toMatchObject({
      action: "click_link",
      risk: "medium"
    });
  });

  it("allows verified event accounts to lower normal ticket-link action risk", () => {
    const result = heuristicAssessment({
      client: "android",
      contentType: "post",
      pageTitle: "Cosraves",
      visibleText:
        "Cosraves\nSponsored\nHATSUNE MIKU RAVE TO A CITY NEAR YOU\nDATES VENUES & TICKET IN BIO LINK\nBuy tickets",
      visibleProfileSignals: ["App detected: Facebook"],
      accountContext: {
        displayName: "Cosraves",
        handle: "cosraves",
        verificationSignals: ["verified badge visible"]
      },
      imageCrop: { description: "Image or video description: Image" }
    });

    expect(result.score).toBeGreaterThanOrEqual(75);
    expect(result.riskLevel).toBe("low");
    expect(result.requestedActions?.[0]).toMatchObject({
      action: "click_link",
      risk: "low"
    });
  });

  it("treats official public-safety Facebook posts as credible enough to check, not automatically suspicious", () => {
    const result = heuristicAssessment({
      client: "android",
      contentType: "post",
      pageTitle: "Like button. Double tap and hold to react to the comment.",
      visibleText:
        "CHP - Westminster .•Follow\nCHP - Westminster\nFollow\n22 Apr•Shared with: Public\nLaser Strike Arrest. Consequences of laser strikes on aircraft. Air 51 monitoring locations.",
      screenshotOcrText: "Image or video description: CHP - Westminster Profile picture\nVisible image or video has no readable description.",
      visibleProfileSignals: ["App detected: Facebook"],
      imageCrop: { description: "Image or video description: CHP - Westminster Profile picture" }
    });

    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.riskLevel).not.toBe("high");
    expect(result.evidenceFor.join(" ")).toContain("institutional");
    expect(result.requestedActions).toBeUndefined();
  });

  it("does not treat music titles containing gel as health product claims", () => {
    const result = heuristicAssessment({
      client: "android",
      contentType: "post",
      pageTitle: "Profile picture of lachy_mclean and 2 others",
      visibleText:
        "Profile picture of lachy_mclean and 2 others\nlachy_mclean and 2 others\nABBA · Angeleyes\nFollow\nAn uncle is the same as a parent right…? 🤔 …\nLike number is10169619. View likes\nComment number is13649. View comments\nReposted 142489 times\nReshare number is913980\nSave number is316597\nReel by lachy_mclean. Double tap to play or pause.",
      screenshotOcrText:
        "Visible image or video has no readable description.\nImage or video description: Like\nImage or video description: Comment\nImage or video description: Repost\nImage or video description: Share\nImage or video description: Save\nImage or video description: Audio",
      visibleProfileSignals: ["App detected: Instagram", "Captured after scrolling paused for 1.5 seconds"],
      imageCrop: { description: "Visible image or video has no readable description." }
    });

    expect(result.riskLevel).toBe("low");
    expect(result.score).toBeGreaterThanOrEqual(75);
    expect(result.evidenceAgainst).toEqual([]);
    expect(result.riskSignals?.some((signal) => signal.category === "claim-verification")).not.toBe(true);
  });

  it("spreads ordinary low-risk reel scores instead of pinning every safe post to 76", () => {
    const samples = [
      {
        pageTitle: "laurenandrich",
        visibleText:
          "laurenandrich\nFollow\nFollow Lauren & Rich | Van Life & Dog Friendly Travel\nDecisions decisions… 🤔 …\nLike number is277821. View likes\nComment number is1826. View comments\nReposted 4751 times\nReshare number is264175\nSave number is14806\nReel by laurenandrich. Double tap to play or pause."
      },
      {
        pageTitle: "thegrocerystoresydney",
        visibleText:
          "thegrocerystoresydney\nFollow\nFollow The Grocery Store\nPapaya but make it spicy. …\nLike number is24. View likes\nReshare number is7\nReel by thegrocerystoresydney. Double tap to play or pause."
      },
      {
        pageTitle: "kinso.kinterns",
        visibleText:
          "kinso.kinterns\nFollow\nFollow Kinso Kinterns\nWhen the 20 year old interns meet the 20 year o …\nLike number is293233. View likes\nComment number is265. View comments\nReposted 2333 times\nReshare number is29282\nSave number is16744\nReel by kinso.kinterns. Double tap to play or pause."
      }
    ];

    const scores = samples.map((sample) =>
      heuristicAssessment({
        client: "android",
        contentType: "post",
        pageTitle: sample.pageTitle,
        visibleText: sample.visibleText,
        screenshotOcrText:
          `Image or video description: Profile picture of ${sample.pageTitle}\nImage or video description: Like\nImage or video description: Comment\nImage or video description: Share`,
        visibleProfileSignals: ["App detected: Instagram", "Captured after scrolling paused for 1.5 seconds"],
        imageCrop: {
          mediaType: "image/jpeg",
          description: `Image or video description: Profile picture of ${sample.pageTitle}`
        }
      }).score
    );

    expect(scores.every((score) => score >= 76 && score <= 95)).toBe(true);
    expect(new Set(scores).size).toBeGreaterThan(1);
  });

  it("does not treat food words containing ato as official tax claims", () => {
    const result = heuristicAssessment({
      client: "android",
      contentType: "post",
      pageTitle: "thegrocerystoresydney",
      visibleText:
        "thegrocerystoresydney\nFollow\nFollow The Grocery Store\nTomato and potato salad today. Papaya but make it spicy.\nReel by thegrocerystoresydney. Double tap to play or pause.",
      screenshotOcrText:
        "Image or video description: Profile picture of thegrocerystoresydney\nImage or video description: Like\nImage or video description: Comment",
      visibleProfileSignals: ["App detected: Instagram", "Captured after scrolling paused for 1.5 seconds"],
      imageCrop: { description: "Image or video description: Profile picture of thegrocerystoresydney" }
    });

    expect(result.riskLevel).toBe("low");
    expect(result.evidenceAgainst.join(" ")).not.toContain("official topic");
    expect(result.riskSignals?.some((signal) => signal.message.includes("Official-topic"))).not.toBe(true);
  });

  it("flags private AI stock watchlist posts as investment scam bait", () => {
    const result = heuristicAssessment({
      client: "android",
      contentType: "post",
      pageTitle: "Send post",
      visibleText:
        "health.que.en 🚨 I wasn't planning to share this, but after hearing this strategy from a senior chip industry insider at a private tech event, I had to tell people close to me. He said the biggest money in AI over the next 12 months won't come from the stocks everyone is already talking about — it'll come from a small group of overlooked suppliers most retail investors have never heard of. I followed this method myself and the early results have been unbelievable. If you want the full watchlist, comment INFO or click the link below and leave your number. I'll send the details privately before the mainstream media catches on. Don't wait too long. Once everyone finds out, the opportunity will be gone.",
      screenshotOcrText:
        "Image or video description: Photo by health.que.en, 0 likes\nImage or video description: health.que.en posted a photo 1 hour ago",
      visibleProfileSignals: ["App detected: Instagram", "Captured after scrolling paused for 1.5 seconds"],
      imageCrop: { description: "Image or video description: Photo by health.que.en, 0 likes" }
    });

    expect(result.riskLevel).toBe("high");
    expect(result.score).toBeLessThan(50);
    expect(result.evidenceAgainst.join(" ")).toContain("urgency, pressure, or scam-like promises");
    expect(result.missingSignals.join(" ")).not.toContain("event or ticket post");
    expect(result.riskSignals?.some((signal) => signal.message.includes("leave your number"))).toBe(true);
    expect(result.claimDetails?.[0]).toMatchObject({
      category: "source",
      status: "unsupported",
      severity: "high"
    });
    expect(result.claimDetails?.[0]?.explanation).toContain("phone number");
    expect(result.requestedActions?.map((action) => action.action)).toEqual(
      expect.arrayContaining(["click_link", "share_personal_info"])
    );
  });

  it("treats local incident retellings as ordinary stories when they do not ask the user to act", () => {
    const result = heuristicAssessment({
      client: "android",
      contentType: "post",
      pageTitle: "Like button. Double tap and hold to react to the comment.",
      visibleText:
        "Sydney Trains Complaint\nJordan Collier · 14m · Shared with: Public group\nTrain stopped in between Leumeah and Campbelltown due to someone being on the tracks. Police are in the process of getting the culprit.",
      screenshotOcrText: "Image or video description: Photo",
      visibleProfileSignals: ["App detected: Facebook"],
      imageCrop: { description: "Image or video description: Photo" }
    });

    expect(result.score).toBeGreaterThanOrEqual(75);
    expect(result.riskLevel).toBe("low");
    expect(result.evidenceAgainst).toEqual([]);
    expect(result.requestedActions).toBeUndefined();
  });

  it("keeps local incident safety instructions in needs-checking", () => {
    const result = heuristicAssessment({
      client: "android",
      contentType: "post",
      pageTitle: "Like button. Double tap and hold to react to the comment.",
      visibleText:
        "Sydney Trains Complaint\nJordan Collier · 14m · Shared with: Public group\nTrain stopped between Leumeah and Campbelltown. Do not travel on this line and avoid the station.",
      screenshotOcrText: "Image or video description: Photo",
      visibleProfileSignals: ["App detected: Facebook"],
      imageCrop: { description: "Image or video description: Photo" }
    });

    expect(result.score).toBeGreaterThanOrEqual(50);
    expect(result.score).toBeLessThan(75);
    expect(result.riskLevel).toBe("medium");
    expect(result.evidenceAgainst.join(" ")).toContain("safety guidance");
  });

  it("treats product support anecdotes as ordinary discussion, not misinformation", () => {
    const result = heuristicAssessment({
      client: "android",
      contentType: "post",
      pageTitle: "DJI Osmo Pocket 4s both now WiFi Bricked",
      visibleText:
        "DJI Osmo Pocket 4s both now WiFi Bricked. I bought 2 Pocket 4s, both now WiFi bricked after firmware update. DJI Support told me it must be faulty and to return it.",
      screenshotOcrText: "Image or video description: Photo",
      visibleProfileSignals: ["App detected: Facebook"],
      imageCrop: { description: "Image or video description: Photo" }
    });

    expect(result.score).toBeGreaterThanOrEqual(75);
    expect(result.riskLevel).toBe("low");
  });

  it("uses credible reverse image matches to lift image provenance", () => {
    const result = heuristicAssessment({
      client: "android",
      visibleText: "University of Technology Sydney campus building.",
      imageCrop: {
        description: "Photo of a UTS campus building shown in a mobile browser."
      },
      reverseImageSearch: {
        status: "checked",
        provider: "google_lens",
        summary: "Exact visual match found on official university and education sources.",
        matches: [
          {
            title: "UTS campus",
            url: "https://www.uts.edu.au/about/campus",
            sourceName: "University of Technology Sydney",
            sourceType: "education",
            similarity: "exact",
            context: "Official UTS page with the same building image."
          }
        ]
      }
    });

    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.riskLevel).toBe("low");
    expect(result.evidenceFor.join(" ")).toContain("Reverse image search found an exact image match");
    expect(result.reverseImageSearch?.credibleMatches[0]?.sourceName).toBe("University of Technology Sydney");
    expect(result.riskSignals?.some((signal) => signal.category === "image-provenance")).toBe(true);
  });

  it("does not let reverse image matches override unsupported high-risk claims", () => {
    const result = heuristicAssessment({
      client: "chrome",
      visibleText:
        "Some seniors are eating 400g of spinach a day and losing up to 4kg in 30 days. No pills, no gym.",
      imageCrop: {
        description: "Infographic about a spinach routine for senior weight loss."
      },
      reverseImageSearch: {
        status: "checked",
        provider: "manual",
        matches: [
          {
            title: "Spinach photo",
            url: "https://www.health.gov.au/resources/healthy-eating",
            sourceName: "Australian Government",
            sourceType: "government",
            similarity: "near",
            context: "Generic spinach image, not clinical evidence for this routine."
          }
        ]
      }
    });

    expect(result.riskLevel).toBe("high");
    expect(result.score).toBeLessThan(50);
    expect(result.evidenceAgainst.join(" ")).toContain("specific rapid weight loss");
    expect(result.reverseImageSearch?.credibleMatches).toHaveLength(1);
  });

  it("explains unsupported rapid single-food weight-loss claims specifically", () => {
    const result = heuristicAssessment({
      client: "chrome",
      url: "https://www.instagram.com/p/spinach-routine-example/",
      authorName: "instartupa",
      visibleText:
        "Some seniors are eating 400g of spinach a day and losing up to 4kg in 30 days. No pills, no gym, one simple daily habit.",
      screenshotOcrText:
        "The 400g Spinach Routine. Claimed result: -4kg in 30 days. No pills. No complicated plan.",
      imageCrop: {
        description: "Likely AI-generated Instagram infographic about a 400g spinach routine for senior weight loss."
      }
    });

    expect(result.score).toBeGreaterThanOrEqual(20);
    expect(result.score).toBeLessThanOrEqual(35);
    expect(result.riskLevel).toBe("high");
    expect(result.plainLanguageSummary).toContain("No trusted clinical or nutrition support");
    expect(result.why[0]).toContain("No trusted clinical or nutrition support");
    expect(result.advice).toContain("Do not follow or share this routine");
    expect(result.recommendedAction).toContain("Do not follow or share this health routine");
    expect(result.evidenceAgainst.join(" ")).toContain("specific rapid weight loss");
    expect(result.missingSignals.join(" ")).toContain("clinician/dietitian credential");
    expect(result.claimDetails?.[0]).toMatchObject({
      category: "weight-loss",
      status: "unsupported",
      severity: "high"
    });
    expect(result.claimDetails?.[0]?.claim).toContain("400g of spinach");
    expect(result.claimDetails?.[0]?.claim).toContain("4kg");
    expect(result.claimDetails?.[0]?.explanation).toContain("single-food/simple daily routine");
    expect(result.claimDetails?.[0]?.guidanceComparison).toContain("1-2 lb per week");
    expect(result.riskSignals?.some((signal) => signal.message.includes("Specific rapid weight-loss claim"))).toBe(true);
  });

  it("flags high-dose spinach senior routines even when image OCR only captures partial text", () => {
    const result = heuristicAssessment({
      client: "android",
      contentType: "post",
      pageTitle: "Send post",
      visibleText:
        "Like\nComment\nSend post\nAdd to Saved\nhealth.que.en 🚨 I wasn't planning to share this, but after hearing this strategy from a senior chip industry ins… more\nhealth.que.en\n50 minutes ago\nLiked\n1 like\nhealth.que.en 😳 I didn't believe this at first, but apparently some seniors are eating 400g of spinach a day and… more",
      screenshotOcrText:
        "Image or video description: Photo by health.que.en, 0 likes\nImage or video description: health.que.en posted a photo 1 hour ago\nImage or video description: Profile picture of health.que.en",
      visibleProfileSignals: ["App detected: Instagram", "Captured after scrolling paused for 1.5 seconds"],
      imageCrop: {
        mediaType: "image/jpeg",
        description:
          "Image or video description: Photo by health.que.en, 0 likes\nImage or video description: health.que.en posted a photo 1 hour ago"
      }
    });

    expect(result.riskLevel).toBe("high");
    expect(result.score).toBeLessThan(50);
    expect(result.evidenceAgainst.join(" ")).toContain("high-dose spinach routine");
    expect(result.claimDetails?.[0]).toMatchObject({
      category: "weight-loss",
      status: "unsupported",
      severity: "high"
    });
    expect(result.claimDetails?.[0]?.missingEvidence.join(" ")).toContain("Safety cautions");
    expect(result.claimDetails?.[0]?.guidanceComparison).toContain("1-2 lb per week");
  });

  it("flags raw mushroom gut-health routines aimed at older adults", () => {
    const result = heuristicAssessment({
      client: "android",
      contentType: "post",
      pageTitle: "Send post",
      visibleText:
        "Like\nComment\nSend post\nAdd to Saved\nhealth.que.en 🍄✨ Your gut will thank you for this simple daily habit! Did you know raw mushrooms are packed with natural enzymes that help balance gut bacteria, especially for older adults? Adding just a handful of fresh mushrooms to your daily routine may support digestion, reduce bloating, and keep your gut feeling light and happy. Sometimes the simplest foods make the biggest difference. Save this and try it today.",
      screenshotOcrText:
        "Image or video description: Photo by health.que.en, 0 likes\nImage or video description: health.que.en posted a photo 1 hour ago\nImage or video description: Profile picture of health.que.en",
      visibleProfileSignals: ["App detected: Instagram", "Captured after scrolling paused for 1.5 seconds"],
      imageCrop: {
        mediaType: "image/jpeg",
        description:
          "Image or video description: Photo by health.que.en, 0 likes\nImage or video description: health.que.en posted a photo 1 hour ago"
      }
    });

    expect(result.riskLevel).toBe("high");
    expect(result.score).toBeLessThan(50);
    expect(result.evidenceAgainst.join(" ")).toContain("raw mushrooms");
    expect(result.missingSignals.join(" ")).toContain("food-safety caution");
    expect(result.claimDetails?.[0]).toMatchObject({
      category: "health",
      status: "unsupported",
      severity: "high"
    });
    expect(result.claimDetails?.[0]?.claim).toContain("Raw mushrooms");
    expect(result.claimDetails?.[0]?.missingEvidence.join(" ")).toContain("Food-safety guidance");
    expect(result.claimDetails?.[0]?.guidanceComparison).toContain("older adults");
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
