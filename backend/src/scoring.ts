import {
  bandForScore,
  credibilityResponseJsonSchema,
  labelForScore,
  riskLevelForScore
} from "./contract.ts";
import type {
  CredibilityAssessRequest,
  CredibilityAssessResponse,
  PublicRiskSignal,
  RequestedAction
} from "../../shared/credibility-contract.ts";
import type { Env } from "./types";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const ANALYSIS_VERSION = "risk-rules-2026-04-29.2";
const MAX_TEXT_LENGTH = 6000;
const MAX_LINKS = 16;
const MAX_IMAGE_DATA_URL_LENGTH = 2_500_000;
const MAX_IMAGE_BYTES = 1_800_000;
const DEFAULT_OPENAI_TIMEOUT_MS = 2500;
const MAX_OPENAI_TIMEOUT_MS = 6000;

interface RiskSignal {
  category:
    | "scam-language"
    | "source-credibility"
    | "link-mismatch"
    | "claim-verification"
    | "ai-image-suspicion";
  weight: number;
  message: string;
}

interface FastRiskAnalysis {
  score: number;
  confidence: "low" | "medium" | "high";
  evidenceFor: string[];
  evidenceAgainst: string[];
  missingSignals: string[];
  signals: RiskSignal[];
}

export function validateAssessRequest(value: unknown): CredibilityAssessRequest {
  if (!value || typeof value !== "object") {
    throw new Error("Request body must be a JSON object.");
  }

  const input = value as Record<string, unknown>;
  if (input.client !== "android" && input.client !== "chrome") {
    throw new Error("client must be either 'android' or 'chrome'.");
  }

  const request: CredibilityAssessRequest = {
    client: input.client
  };

  for (const key of [
    "url",
    "pageTitle",
    "visibleText",
    "authorName",
    "authorHandle",
    "selectedText",
    "locale",
    "screenshotOcrText"
  ] as const) {
    const item = input[key];
    if (typeof item === "string" && item.trim()) {
      request[key] = item.slice(0, MAX_TEXT_LENGTH) as never;
    }
  }

  if (
    input.contentType === "post" ||
    input.contentType === "article" ||
    input.contentType === "reel" ||
    input.contentType === "unknown"
  ) {
    request.contentType = input.contentType;
  }

  if (Array.isArray(input.visibleProfileSignals)) {
    request.visibleProfileSignals = input.visibleProfileSignals
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .slice(0, 12)
      .map((item) => item.slice(0, 280));
  }

  request.extractedLinks = parseLinkEvidence(input.extractedLinks);
  request.imageCrop = parseImageCropEvidence(input.imageCrop);
  if (input.consentToStoreEvidence === true) {
    request.consentToStoreEvidence = true;
  }
  if (typeof input.consentLabel === "string" && input.consentLabel.trim()) {
    request.consentLabel = input.consentLabel.slice(0, 200);
  }

  if (!hasUsefulEvidence(request)) {
    throw new Error(
      "Provide at least visibleText, selectedText, screenshotOcrText, extractedLinks, imageCrop, or url."
    );
  }

  return request;
}

export function hasUsefulEvidence(request: CredibilityAssessRequest): boolean {
  return Boolean(
    request.visibleText?.trim() ||
      request.selectedText?.trim() ||
      request.screenshotOcrText?.trim() ||
      request.extractedLinks?.length ||
      request.imageCrop?.dataUrl ||
      request.imageCrop?.description ||
      request.url?.trim()
  );
}

export function normalizeAssessment(raw: CredibilityAssessResponse): CredibilityAssessResponse {
  const score = clampScore(raw.score);
  const confidence = ["low", "medium", "high"].includes(raw.confidence) ? raw.confidence : "low";
  const evidenceAgainst = sanitizeList(raw.evidenceAgainst);
  const missingSignals = sanitizeList(raw.missingSignals);
  const evidenceFor = sanitizeList(raw.evidenceFor);
  const why = sanitizeList(raw.why).length
    ? sanitizeList(raw.why).slice(0, 4)
    : buildWhy(score, evidenceAgainst, missingSignals, evidenceFor);
  const advice =
    raw.advice?.trim() ||
    raw.recommendedAction?.trim() ||
    "Check a trusted source or ask someone you trust before clicking or sharing.";

  return {
    score,
    band: bandForScore(score),
    riskLevel: riskLevelForScore(score),
    label: labelForScore(score, confidence),
    confidence,
    plainLanguageSummary:
      raw.plainLanguageSummary?.trim() ||
      "There was not enough clear public evidence to make a strong credibility estimate.",
    why,
    advice,
    evidenceFor,
    evidenceAgainst,
    missingSignals,
    recommendedAction:
      raw.recommendedAction?.trim() ||
      "Check the source and look for another reliable report before sharing.",
    riskSignals: sanitizeRiskSignals(raw.riskSignals),
    requestedActions: sanitizeRequestedActions(raw.requestedActions),
    analysisVersion: raw.analysisVersion?.trim() || ANALYSIS_VERSION
  };
}

export function heuristicAssessment(request: CredibilityAssessRequest): CredibilityAssessResponse {
  const analysis = analyzeFastRisk(request);
  const score = analysis.score;

  return normalizeAssessment({
    score,
    band: bandForScore(score),
    riskLevel: riskLevelForScore(score),
    label: labelForScore(score, analysis.confidence),
    confidence: analysis.confidence,
    plainLanguageSummary: buildSummary(score, analysis),
    why: buildWhy(score, analysis.evidenceAgainst, analysis.missingSignals, analysis.evidenceFor),
    advice: buildAdvice(score, analysis),
    evidenceFor: analysis.evidenceFor,
    evidenceAgainst: analysis.evidenceAgainst,
    missingSignals: analysis.missingSignals,
    recommendedAction: buildRecommendedAction(score, analysis),
    riskSignals: publicRiskSignals(analysis.signals),
    requestedActions: detectRequestedActions(request, analysis),
    analysisVersion: ANALYSIS_VERSION
  });
}

export async function assessCredibility(
  request: CredibilityAssessRequest,
  env: Env
): Promise<CredibilityAssessResponse> {
  const baseline = heuristicAssessment(request);
  if (!env.OPENAI_API_KEY) {
    return baseline;
  }

  const content: Array<
    | { type: "input_text"; text: string }
    | { type: "input_image"; image_url: string; detail?: "low" | "high" | "auto" }
  > = [
    {
      type: "input_text",
      text: JSON.stringify({
        ...request,
        imageCrop: request.imageCrop
          ? {
              ...request.imageCrop,
              dataUrl: request.imageCrop.dataUrl
                ? "[image data sent separately]"
                : undefined
            }
          : undefined
      })
    }
  ];

  if (shouldSendImageToOpenAI(request, env)) {
    content.push({
      type: "input_image" as const,
      image_url: request.imageCrop.dataUrl,
      detail: "low"
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), openAiTimeoutMs(env));

  try {
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || "gpt-5",
        max_output_tokens: 900,
        instructions: [
          "You are a fast credibility risk assistant for elderly users.",
          "Start from the deterministic baseline assessment and improve it only when supplied evidence supports the change.",
          "Estimate risk from the supplied visible text, OCR text, extracted links, source/profile signals, and optional image crop.",
          "Check exactly these categories: scam language, source credibility, link mismatch, claim verification, and AI-image suspicion.",
          "Claim verification means checking whether the claim is supported by the provided source/domain/profile/text evidence. Do not browse the web.",
          "Source credibility means judging visible source signals, official-looking domains, known risky link patterns, and whether the source matches the claim type.",
          "Do not claim to verify private account creation dates unless they are supplied.",
          "If evidence is thin, use Cannot verify or Needs checking rather than guessing.",
          "Keep the explanation plain, calm, and short."
        ].join(" "),
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify({
                  deterministicBaseline: baseline,
                  request: {
                    ...request,
                    imageCrop: request.imageCrop
                      ? {
                          ...request.imageCrop,
                          dataUrl: request.imageCrop.dataUrl ? "[image data sent separately]" : undefined
                        }
                      : undefined
                  }
                })
              },
              ...content.slice(1)
            ]
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "credibility_assessment",
            strict: true,
            schema: credibilityResponseJsonSchema
          }
        }
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI request failed with ${response.status}`);
    }

    const payload = (await response.json()) as unknown;
    const text = extractOutputText(payload);
    if (!text) {
      throw new Error("OpenAI response did not contain structured output text.");
    }

    return mergeModelAssessment(baseline, normalizeAssessment(JSON.parse(text) as CredibilityAssessResponse));
  } catch {
    return baseline;
  } finally {
    clearTimeout(timeout);
  }
}

export function extractOutputText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  if (typeof root.output_text === "string") return root.output_text;

  const output = root.output;
  if (!Array.isArray(output)) return null;

  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const text = (part as Record<string, unknown>).text;
      if (typeof text === "string") return text;
    }
  }

  return null;
}

function analyzeFastRisk(request: CredibilityAssessRequest): FastRiskAnalysis {
  const text = allText(request);
  const lowerText = text.toLowerCase();
  const links = collectLinks(request);
  const domains = links.map(getDomain).filter((domain): domain is string => Boolean(domain));
  const signals: RiskSignal[] = [];
  const evidenceFor: string[] = [];
  const evidenceAgainst: string[] = [];
  const missingSignals: string[] = [];

  let score = 62;

  if (request.url || links.length) {
    evidenceFor.push("A link or page address is available for checking.");
    score += 4;
  } else {
    missingSignals.push("No source link is visible.");
    score -= 10;
  }

  if (links.length) {
    evidenceFor.push(`${links.length} link${links.length === 1 ? "" : "s"} were captured for checking.`);
  }

  const source = assessSourceCredibility(request, domains, lowerText);
  score += source.scoreDelta;
  evidenceFor.push(...source.evidenceFor);
  evidenceAgainst.push(...source.evidenceAgainst);
  missingSignals.push(...source.missingSignals);
  signals.push(...source.signals);

  const scam = assessScamLanguage(lowerText);
  score += scam.scoreDelta;
  evidenceAgainst.push(...scam.evidenceAgainst);
  signals.push(...scam.signals);

  const mismatch = assessLinkMismatch(request, links, lowerText);
  score += mismatch.scoreDelta;
  evidenceAgainst.push(...mismatch.evidenceAgainst);
  missingSignals.push(...mismatch.missingSignals);
  signals.push(...mismatch.signals);

  const claims = assessClaimSupport(request, lowerText, domains);
  score += claims.scoreDelta;
  evidenceFor.push(...claims.evidenceFor);
  evidenceAgainst.push(...claims.evidenceAgainst);
  missingSignals.push(...claims.missingSignals);
  signals.push(...claims.signals);

  const image = assessImageSuspicion(request, lowerText);
  score += image.scoreDelta;
  evidenceFor.push(...image.evidenceFor);
  evidenceAgainst.push(...image.evidenceAgainst);
  missingSignals.push(...image.missingSignals);
  signals.push(...image.signals);

  if (request.contentType === "reel") {
    missingSignals.push("Video and audio content were not fully analyzed in this prototype.");
    score -= 6;
  }

  if (text.trim().length < 80 && !request.imageCrop?.description && !request.imageCrop?.dataUrl) {
    missingSignals.push("There is not much readable text to assess.");
    score -= 12;
  }

  return {
    score: clampScore(score),
    confidence: confidenceFor(text, links, request, signals),
    evidenceFor: dedupe(evidenceFor).slice(0, 6),
    evidenceAgainst: dedupe(evidenceAgainst).slice(0, 6),
    missingSignals: dedupe(missingSignals).slice(0, 6),
    signals
  };
}

function assessSourceCredibility(
  request: CredibilityAssessRequest,
  domains: string[],
  text: string
): {
  scoreDelta: number;
  evidenceFor: string[];
  evidenceAgainst: string[];
  missingSignals: string[];
  signals: RiskSignal[];
} {
  const evidenceFor: string[] = [];
  const evidenceAgainst: string[] = [];
  const missingSignals: string[] = [];
  const signals: RiskSignal[] = [];
  let scoreDelta = 0;

  if (request.authorName || request.authorHandle) {
    evidenceFor.push("A visible author or account name is present.");
    scoreDelta += 4;
  } else {
    missingSignals.push("No clear author or account name is visible.");
    scoreDelta -= 8;
  }

  const profileText = (request.visibleProfileSignals || []).join(" ").toLowerCase();
  if (profileText) {
    evidenceFor.push("Some visible profile or account signals were captured.");
    scoreDelta += 3;
  } else {
    missingSignals.push("No account age, verification, or profile history is visible.");
  }

  if (/verified|blue tick|official|government|posted by/.test(profileText)) {
    evidenceFor.push("The visible profile signals suggest an official or verified source.");
    scoreDelta += 8;
  }

  const trustedDomain = domains.find(isTrustedDomain);
  if (trustedDomain) {
    evidenceFor.push(`The link domain ${trustedDomain} looks like an official or established source.`);
    scoreDelta += 12;
  }

  const officialClaim = /official|government|bank|medicare|mygov|ato|police|council|health|emergency/.test(text);
  if (officialClaim && !trustedDomain) {
    evidenceAgainst.push("The post refers to an official topic but no official source domain is visible.");
    signals.push({
      category: "source-credibility",
      weight: 14,
      message: "Official-topic claim lacks an official-looking source."
    });
    scoreDelta -= 14;
  }

  if (domains.some(isSuspiciousDomainName)) {
    evidenceAgainst.push("A link domain uses unusual spelling, numbers, or a risky-looking pattern.");
    signals.push({
      category: "source-credibility",
      weight: 14,
      message: "Domain pattern looks risky."
    });
    scoreDelta -= 14;
  }

  return { scoreDelta, evidenceFor, evidenceAgainst, missingSignals, signals };
}

function assessScamLanguage(text: string): {
  scoreDelta: number;
  evidenceAgainst: string[];
  signals: RiskSignal[];
} {
  const patterns = [
    { phrase: "act now", weight: 10 },
    { phrase: "urgent", weight: 8 },
    { phrase: "limited time", weight: 8 },
    { phrase: "click here", weight: 8 },
    { phrase: "claim your prize", weight: 14 },
    { phrase: "verify your account", weight: 14 },
    { phrase: "investment opportunity", weight: 14 },
    { phrase: "secret cure", weight: 18 },
    { phrase: "guaranteed", weight: 8 },
    { phrase: "they don't want you to know", weight: 12 },
    { phrase: "100% true", weight: 8 },
    { phrase: "breaking!!!", weight: 8 }
  ];
  const matched = patterns.filter((item) => text.includes(item.phrase));
  if (!matched.length) return { scoreDelta: 0, evidenceAgainst: [], signals: [] };

  const weight = Math.min(30, matched.reduce((total, item) => total + item.weight, 0));
  return {
    scoreDelta: -weight,
    evidenceAgainst: ["The wording uses urgency, pressure, or scam-like promises."],
    signals: matched.map((item) => ({
      category: "scam-language",
      weight: item.weight,
      message: `Matched risky phrase: ${item.phrase}`
    }))
  };
}

function assessLinkMismatch(
  request: CredibilityAssessRequest,
  links: string[],
  text: string
): {
  scoreDelta: number;
  evidenceAgainst: string[];
  missingSignals: string[];
  signals: RiskSignal[];
} {
  const evidenceAgainst: string[] = [];
  const missingSignals: string[] = [];
  const signals: RiskSignal[] = [];
  let scoreDelta = 0;

  const suspiciousLinks = links.filter((link) => isSuspiciousLink(link));
  if (suspiciousLinks.length) {
    evidenceAgainst.push("One or more links look shortened, unusual, or risky.");
    signals.push({
      category: "link-mismatch",
      weight: 16,
      message: "Shortened or risky-looking link detected."
    });
    scoreDelta -= 16;
  }

  if (hasLinkMismatch(request.url, links, text)) {
    evidenceAgainst.push("The visible link text may not match the actual destination.");
    signals.push({
      category: "link-mismatch",
      weight: 14,
      message: "Official wording and destination domain do not line up."
    });
    scoreDelta -= 14;
  }

  if (request.extractedLinks?.some((link) => link.text && isDomainLike(link.text))) {
    const mismatchedAnchor = request.extractedLinks.some((link) => {
      if (!link.text) return false;
      const visibleDomain = domainFromLooseText(link.text);
      const hrefDomain = getDomain(link.href);
      return Boolean(visibleDomain && hrefDomain && rootDomain(visibleDomain) !== rootDomain(hrefDomain));
    });
    if (mismatchedAnchor) {
      evidenceAgainst.push("A visible link label points to a different destination domain.");
      scoreDelta -= 18;
    }
  }

  if (!links.length) {
    missingSignals.push("No clickable link was captured for domain checking.");
  }

  return { scoreDelta, evidenceAgainst, missingSignals, signals };
}

function assessClaimSupport(
  request: CredibilityAssessRequest,
  text: string,
  domains: string[]
): {
  scoreDelta: number;
  evidenceFor: string[];
  evidenceAgainst: string[];
  missingSignals: string[];
  signals: RiskSignal[];
} {
  const evidenceFor: string[] = [];
  const evidenceAgainst: string[] = [];
  const missingSignals: string[] = [];
  const signals: RiskSignal[] = [];
  let scoreDelta = 0;

  const highImpact = /cure|medicine|vaccine|health|emergency|evacuation|police|bank|tax|ato|mygov|medicare|investment|crypto|lawsuit|arrest|death|recall/.test(text);
  const hasNumbers = /\b\d{2,}[%$]?\b|\$\d+/.test(text);
  const hasDate = /\b(today|tomorrow|yesterday|\d{1,2}\/\d{1,2}\/\d{2,4}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/.test(text);
  const trustedDomain = domains.some(isTrustedDomain);

  if (highImpact && trustedDomain) {
    evidenceFor.push("A high-impact claim has an official or established source domain visible.");
    scoreDelta += 8;
  }

  if (highImpact && !trustedDomain) {
    evidenceAgainst.push("This is a high-impact claim but no trusted confirming source is visible.");
    signals.push({
      category: "claim-verification",
      weight: 16,
      message: "High-impact claim lacks visible trusted support."
    });
    scoreDelta -= 16;
  }

  if ((hasNumbers || hasDate) && !request.url && !request.extractedLinks?.length) {
    missingSignals.push("The post makes specific claims but no source link was captured.");
    scoreDelta -= 8;
  }

  if (/screenshot|image says|photo shows|look at this/.test(text) && !request.screenshotOcrText && !request.imageCrop?.description) {
    missingSignals.push("The claim depends on an image, but no OCR text or image description was captured.");
    scoreDelta -= 8;
  }

  return { scoreDelta, evidenceFor, evidenceAgainst, missingSignals, signals };
}

function assessImageSuspicion(
  request: CredibilityAssessRequest,
  text: string
): {
  scoreDelta: number;
  evidenceFor: string[];
  evidenceAgainst: string[];
  missingSignals: string[];
  signals: RiskSignal[];
} {
  const evidenceFor: string[] = [];
  const evidenceAgainst: string[] = [];
  const missingSignals: string[] = [];
  const signals: RiskSignal[] = [];
  let scoreDelta = 0;

  if (request.imageCrop?.dataUrl || request.imageCrop?.description) {
    evidenceFor.push("An image crop was supplied for OCR or image-risk analysis.");
  } else {
    missingSignals.push("No image crop was supplied for AI-image suspicion checks.");
    return { scoreDelta, evidenceFor, evidenceAgainst, missingSignals, signals };
  }

  const imageText = `${request.imageCrop?.description || ""} ${request.screenshotOcrText || ""}`.toLowerCase();
  if (/ai generated|deepfake|photoshop|edited|fake image|manipulated/.test(imageText)) {
    evidenceAgainst.push("The image/OCR evidence mentions possible editing, AI generation, or manipulation.");
    signals.push({
      category: "ai-image-suspicion",
      weight: 12,
      message: "Image text or description mentions manipulation."
    });
    scoreDelta -= 12;
  }

  if (/too good to be true|shocking photo|you won't believe/.test(text)) {
    evidenceAgainst.push("The post uses sensational wording around image evidence.");
    scoreDelta -= 6;
  }

  if (!request.imageCrop?.dataUrl) {
    missingSignals.push("Only an image description was supplied, so visual manipulation checks are limited.");
  }

  return { scoreDelta, evidenceFor, evidenceAgainst, missingSignals, signals };
}

function buildSummary(score: number, analysis: FastRiskAnalysis): string {
  if (score >= 75) {
    return "This looks lower risk from the visible evidence, but it is still worth reading the original source before sharing.";
  }
  if (score >= 50) {
    return "This needs checking because the visible evidence is incomplete or only partly supported.";
  }
  const reason = analysis.evidenceAgainst[0] || "the visible evidence contains warning signs";
  return `This looks risky because ${lowerFirst(reason)}.`;
}

function buildAdvice(score: number, analysis: FastRiskAnalysis): string {
  const hasLinkRisk = analysis.signals.some((signal) => signal.category === "link-mismatch");
  const hasScamRisk = analysis.signals.some((signal) => signal.category === "scam-language");
  if (score < 50 && (hasLinkRisk || hasScamRisk)) {
    return "Do not click the link or enter details. Go to the official website yourself or ask someone you trust to check it.";
  }
  if (score < 50) {
    return "Do not share or act on this yet. Check an official source or ask someone you trust.";
  }
  if (score < 75) {
    return "Pause before sharing. Look for the same claim on an official website or a trusted news source.";
  }
  return "It looks safer, but still read the full source before sharing.";
}

function buildRecommendedAction(score: number, analysis: FastRiskAnalysis): string {
  if (score < 50 && analysis.signals.some((signal) => signal.category === "link-mismatch")) {
    return "Do not click. Type the official website address yourself.";
  }
  if (score < 50) return "Do not share yet. Check a trusted source first.";
  if (score < 75) return "Look for another reliable source before sharing.";
  return "Still read the full source before sharing.";
}

function confidenceFor(
  text: string,
  links: string[],
  request: CredibilityAssessRequest,
  signals: RiskSignal[]
): "low" | "medium" | "high" {
  let evidencePoints = 0;
  if (text.length >= 120) evidencePoints += 1;
  if (links.length) evidencePoints += 1;
  if (request.authorName || request.authorHandle) evidencePoints += 1;
  if (request.visibleProfileSignals?.length) evidencePoints += 1;
  if (request.screenshotOcrText || request.imageCrop?.description || request.imageCrop?.dataUrl) evidencePoints += 1;
  if (signals.length >= 2) evidencePoints += 1;

  if (evidencePoints >= 5) return "high";
  if (evidencePoints >= 3) return "medium";
  return "low";
}

function allText(request: CredibilityAssessRequest): string {
  return [
    request.pageTitle,
    request.selectedText,
    request.visibleText,
    request.screenshotOcrText,
    request.imageCrop?.description,
    ...(request.extractedLinks || []).flatMap((link) => [link.text, link.href])
  ]
    .filter(Boolean)
    .join(" ");
}

function parseLinkEvidence(value: unknown): CredibilityAssessRequest["extractedLinks"] {
  if (!Array.isArray(value)) return undefined;

  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      href: typeof item.href === "string" ? item.href.slice(0, 2048) : "",
      text: typeof item.text === "string" ? item.text.slice(0, 500) : undefined,
      source: parseLinkSource(item.source)
    }))
    .filter((item) => item.href.trim().length > 0)
    .slice(0, MAX_LINKS);
}

function shouldSendImageToOpenAI(request: CredibilityAssessRequest, env: Env): request is CredibilityAssessRequest & {
  imageCrop: NonNullable<CredibilityAssessRequest["imageCrop"]> & { dataUrl: string };
} {
  return env.OPENAI_ENABLE_VISION === "true" && Boolean(request.imageCrop?.dataUrl);
}

function openAiTimeoutMs(env: Env): number {
  const parsed = Number.parseInt(env.OPENAI_TIMEOUT_MS || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_OPENAI_TIMEOUT_MS;
  return Math.min(parsed, MAX_OPENAI_TIMEOUT_MS);
}

function parseLinkSource(value: unknown): "visible" | "ocr" | "dom" | "manual" | undefined {
  if (value === "visible" || value === "ocr" || value === "dom" || value === "manual") {
    return value;
  }
  return undefined;
}

function parseImageCropEvidence(value: unknown): CredibilityAssessRequest["imageCrop"] {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const imageCrop: NonNullable<CredibilityAssessRequest["imageCrop"]> = {};

  if (typeof input.dataUrl === "string") {
    if (input.dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
      throw new Error("imageCrop.dataUrl is too large.");
    }
    const match = input.dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=]+)$/i);
    if (!match) {
      throw new Error("imageCrop.dataUrl must be a PNG, JPEG, or WebP base64 data URL.");
    }
    const decodedBytes = Math.floor((match[2].length * 3) / 4);
    if (decodedBytes > MAX_IMAGE_BYTES) {
      throw new Error("imageCrop.dataUrl decoded image is too large.");
    }
    imageCrop.dataUrl = input.dataUrl;
  }
  if (
    input.mediaType === "image/png" ||
    input.mediaType === "image/jpeg" ||
    input.mediaType === "image/webp"
  ) {
    imageCrop.mediaType = input.mediaType;
  }
  if (typeof input.description === "string" && input.description.trim()) {
    imageCrop.description = input.description.slice(0, 1000);
  }

  if (input.crop && typeof input.crop === "object") {
    const crop = input.crop as Record<string, unknown>;
    const x = numberOrNull(crop.x);
    const y = numberOrNull(crop.y);
    const width = numberOrNull(crop.width);
    const height = numberOrNull(crop.height);
    if (x !== null && y !== null && width !== null && height !== null) {
      imageCrop.crop = { x, y, width, height };
    }
  }

  return imageCrop.dataUrl || imageCrop.description || imageCrop.crop ? imageCrop : undefined;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function collectLinks(request: CredibilityAssessRequest): string[] {
  const links = new Set<string>();
  if (request.url) links.add(request.url);
  for (const item of request.extractedLinks || []) {
    links.add(item.href);
  }

  const text = [
    request.pageTitle,
    request.visibleText,
    request.selectedText,
    request.screenshotOcrText
  ]
    .filter(Boolean)
    .join(" ");
  for (const match of text.matchAll(/https?:\/\/[^\s)"'<>]+/gi)) {
    links.add(match[0]);
  }

  return [...links].slice(0, MAX_LINKS);
}

function isSuspiciousLink(link: string): boolean {
  const domain = getDomain(link);
  if (!domain) return true;
  return (
    domain.includes("bit.ly") ||
    domain.includes("tinyurl.com") ||
    domain.includes("t.co") ||
    domain.includes("goo.gl") ||
    domain.includes("ow.ly") ||
    /xn--/.test(domain) ||
    /\d+\.\d+\.\d+\.\d+/.test(domain) ||
    isSuspiciousDomainName(domain)
  );
}

function isTrustedDomain(domain: string): boolean {
  return (
    domain.endsWith(".gov.au") ||
    domain.endsWith(".edu.au") ||
    domain.endsWith(".gov") ||
    domain.endsWith(".edu") ||
    domain.endsWith(".nhs.uk") ||
    domain === "abc.net.au" ||
    domain === "bbc.com" ||
    domain === "bbc.co.uk" ||
    domain === "reuters.com" ||
    domain === "apnews.com" ||
    domain === "who.int" ||
    domain === "bom.gov.au"
  );
}

function isSuspiciousDomainName(domain: string): boolean {
  return (
    /xn--/.test(domain) ||
    /\d+\.\d+\.\d+\.\d+/.test(domain) ||
    /(login|verify|secure|account|support|prize|gift|claim)[-.]/.test(domain) ||
    /[-.](login|verify|secure|account|support|prize|gift|claim)\./.test(domain) ||
    domain.length > 45
  );
}

function isDomainLike(value: string): boolean {
  return /[a-z0-9-]+\.[a-z]{2,}/i.test(value);
}

function domainFromLooseText(value: string): string | null {
  const match = value.match(/[a-z0-9-]+(?:\.[a-z0-9-]+)+/i);
  return match ? match[0].toLowerCase().replace(/^www\./, "") : null;
}

function hasLinkMismatch(url: string | undefined, links: string[], text: string): boolean {
  const domains = links.map(getDomain).filter((domain): domain is string => Boolean(domain));
  if (domains.length < 2) return false;

  const baseDomain = url ? getDomain(url) : domains[0];
  if (!baseDomain) return false;

  const mismatchedDomains = domains.filter((domain) => rootDomain(domain) !== rootDomain(baseDomain));
  const mentionsOfficial = /official|government|bank|medicare|mygov|ato|police|council/.test(text);
  return mismatchedDomains.length > 0 && mentionsOfficial;
}

function getDomain(link: string): string | null {
  try {
    return new URL(link).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function rootDomain(domain: string): string {
  const parts = domain.split(".");
  return parts.slice(Math.max(0, parts.length - 2)).join(".");
}

function dedupe(items: string[]): string[] {
  return [...new Set(items.filter((item) => item.trim()).map((item) => item.trim()))];
}

function publicRiskSignals(signals: RiskSignal[]): PublicRiskSignal[] {
  return signals
    .slice(0, 8)
    .map((signal) => ({
      category: signal.category,
      severity: signal.weight >= 16 ? "high" : signal.weight >= 10 ? "medium" : "low",
      message: signal.message
    }));
}

function detectRequestedActions(
  request: CredibilityAssessRequest,
  analysis: FastRiskAnalysis
): RequestedAction[] {
  const text = allText(request).toLowerCase();
  const actions: RequestedAction[] = [];
  const highRisk = analysis.score < 50 || analysis.signals.some((signal) => signal.weight >= 14);

  if (/\b(click|tap|open|visit)\b|follow the link|link below/.test(text) || request.extractedLinks?.length) {
    actions.push({
      action: "click_link",
      risk: highRisk ? "high" : "medium",
      target: request.extractedLinks?.[0]?.href || request.url,
      advice: highRisk
        ? "Do not click the link. Type the official website address yourself."
        : "Check the link carefully before opening it."
    });
  }

  if (/\b(call|phone|ring)\b|contact us/.test(text) || /\+?\d[\d\s().-]{7,}\d/.test(text)) {
    actions.push({
      action: "call_phone",
      risk: highRisk ? "high" : "medium",
      advice: "Do not call numbers from suspicious messages. Use an official number you already trust."
    });
  }

  if (/send money|\btransfer\b|pay now|\bpayment\b|gift card|\bcrypto\b|\bbitcoin\b|bank transfer/.test(text)) {
    actions.push({
      action: "send_money",
      risk: "high",
      advice: "Do not send money, gift cards, or crypto from this message."
    });
  }

  if (/one.?time code|\botp\b|verification code|login code|security code|\bpassword\b|\bpin\b/.test(text)) {
    actions.push({
      action: "share_code",
      risk: "high",
      advice: "Never share passwords, PINs, or login codes."
    });
  }

  if (/medicare number|tax file number|tfn|driver licence|passport|bank details|date of birth|address/.test(text)) {
    actions.push({
      action: "share_personal_info",
      risk: "high",
      advice: "Do not send personal or identity details from this message."
    });
  }

  if (/\b(download|install|attachment|apk|exe|zip)\b/.test(text)) {
    actions.push({
      action: "download_file",
      risk: "high",
      advice: "Do not download files or apps from this message."
    });
  }

  if (/\b(reply|respond)\b|message me|dm me|\bwhatsapp\b|\btelegram\b/.test(text)) {
    actions.push({
      action: "reply_message",
      risk: highRisk ? "high" : "medium",
      advice: "Do not reply with personal information. Check through an official channel."
    });
  }

  return dedupeActions(actions).slice(0, 6);
}

function sanitizeRiskSignals(signals: PublicRiskSignal[] | undefined): PublicRiskSignal[] | undefined {
  if (!Array.isArray(signals)) return undefined;
  const cleaned = signals
    .filter((signal) =>
      Boolean(signal) &&
      typeof signal.message === "string" &&
      [
        "scam-language",
        "source-credibility",
        "link-mismatch",
        "claim-verification",
        "ai-image-suspicion"
      ].includes(signal.category) &&
      ["low", "medium", "high"].includes(signal.severity)
    )
    .slice(0, 8)
    .map((signal) => ({
      category: signal.category,
      severity: signal.severity,
      message: signal.message.slice(0, 240)
    }));
  return cleaned.length ? cleaned : undefined;
}

function sanitizeRequestedActions(actions: RequestedAction[] | undefined): RequestedAction[] | undefined {
  if (!Array.isArray(actions)) return undefined;
  const cleaned = actions
    .filter((action) =>
      Boolean(action) &&
      [
        "click_link",
        "call_phone",
        "send_money",
        "share_code",
        "share_personal_info",
        "download_file",
        "reply_message"
      ].includes(action.action) &&
      ["low", "medium", "high"].includes(action.risk) &&
      typeof action.advice === "string"
    )
    .slice(0, 6)
    .map((action) => ({
      action: action.action,
      risk: action.risk,
      target: typeof action.target === "string" ? action.target.slice(0, 500) : undefined,
      advice: action.advice.slice(0, 240)
    }));
  return cleaned.length ? cleaned : undefined;
}

function dedupeActions(actions: RequestedAction[]): RequestedAction[] {
  const seen = new Set<string>();
  return actions.filter((action) => {
    if (seen.has(action.action)) return false;
    seen.add(action.action);
    return true;
  });
}

function lowerFirst(value: string): string {
  return value ? value.charAt(0).toLowerCase() + value.slice(1) : value;
}

function mergeModelAssessment(
  baseline: CredibilityAssessResponse,
  model: CredibilityAssessResponse
): CredibilityAssessResponse {
  const boundedScore = Math.max(baseline.score - 15, Math.min(baseline.score + 15, model.score));
  return normalizeAssessment({
    ...model,
    score: boundedScore,
    evidenceFor: dedupe([...baseline.evidenceFor, ...model.evidenceFor]).slice(0, 6),
    evidenceAgainst: dedupe([...baseline.evidenceAgainst, ...model.evidenceAgainst]).slice(0, 6),
    missingSignals: dedupe([...baseline.missingSignals, ...model.missingSignals]).slice(0, 6),
    riskSignals: model.riskSignals?.length ? model.riskSignals : baseline.riskSignals,
    requestedActions: model.requestedActions?.length ? model.requestedActions : baseline.requestedActions,
    analysisVersion: model.analysisVersion || baseline.analysisVersion || ANALYSIS_VERSION
  });
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function sanitizeList(items: string[] | undefined): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item) => typeof item === "string" && item.trim().length > 0)
    .slice(0, 6)
    .map((item) => item.trim());
}

function buildWhy(
  score: number,
  evidenceAgainst: string[],
  missingSignals: string[],
  evidenceFor: string[]
): string[] {
  if (score >= 75) {
    return [
      evidenceFor[0] || "The visible information gives some support for this post.",
      "No strong scam or urgency warning signs were found in the readable text."
    ];
  }

  const why = [...evidenceAgainst, ...missingSignals].slice(0, 3);
  if (why.length) return why;

  return [
    "There is not enough visible evidence to confirm this post.",
    "Check an official website or another trusted source before acting."
  ];
}
