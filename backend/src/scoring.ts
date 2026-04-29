import {
  bandForScore,
  credibilityResponseJsonSchema,
  labelForScore,
  riskLevelForScore
} from "./contract.ts";
import type {
  CredibilityAssessRequest,
  CredibilityAssessResponse,
  AccountCredibility,
  PublicRiskSignal,
  RequestedAction,
  WebVerification
} from "../../shared/credibility-contract.ts";
import type { Env } from "./types";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const ANALYSIS_VERSION = "risk-rules-2026-04-29.4";
const MAX_TEXT_LENGTH = 6000;
const MAX_LINKS = 16;
const MAX_ACCOUNT_RECENT_POSTS = 5;
const MAX_IMAGE_DATA_URL_LENGTH = 2_500_000;
const MAX_IMAGE_BYTES = 1_800_000;
const DEFAULT_OPENAI_TIMEOUT_MS = 2500;
const MAX_OPENAI_TIMEOUT_MS = 6000;
const DEFAULT_WEB_VERIFICATION_TIMEOUT_MS = 6000;
const MAX_WEB_VERIFICATION_TIMEOUT_MS = 12000;

interface TrustedSource {
  name: string;
  domains: string[];
  logoAliases: string[];
  sourceType: "official" | "news" | "medical";
}

const TRUSTED_SOURCE_REGISTRY: TrustedSource[] = [
  {
    name: "ABC News",
    domains: ["abc.net.au", "abcnews.go.com"],
    logoAliases: ["abc news", "abc australia"],
    sourceType: "news"
  },
  {
    name: "Reuters",
    domains: ["reuters.com"],
    logoAliases: ["reuters"],
    sourceType: "news"
  },
  {
    name: "Associated Press",
    domains: ["apnews.com", "ap.org"],
    logoAliases: ["ap news", "associated press"],
    sourceType: "news"
  },
  {
    name: "BBC News",
    domains: ["bbc.com", "bbc.co.uk"],
    logoAliases: ["bbc news", "bbc"],
    sourceType: "news"
  },
  {
    name: "SBS News",
    domains: ["sbs.com.au"],
    logoAliases: ["sbs news", "sbs"],
    sourceType: "news"
  },
  {
    name: "The Guardian",
    domains: ["theguardian.com"],
    logoAliases: ["the guardian", "guardian news"],
    sourceType: "news"
  },
  {
    name: "The New York Times",
    domains: ["nytimes.com"],
    logoAliases: ["new york times", "nytimes", "the new york times"],
    sourceType: "news"
  },
  {
    name: "Washington Post",
    domains: ["washingtonpost.com"],
    logoAliases: ["washington post", "the washington post"],
    sourceType: "news"
  },
  {
    name: "Al Jazeera",
    domains: ["aljazeera.com"],
    logoAliases: ["al jazeera", "aljazeera"],
    sourceType: "news"
  },
  {
    name: "World Health Organization",
    domains: ["who.int"],
    logoAliases: ["world health organization", "who"],
    sourceType: "medical"
  },
  {
    name: "Australian Government",
    domains: ["health.gov.au", "bom.gov.au", "ato.gov.au", "my.gov.au"],
    logoAliases: ["australian government", "health.gov.au", "bureau of meteorology", "bom", "ato", "mygov"],
    sourceType: "official"
  }
];

interface RiskSignal {
  category:
    | "scam-language"
    | "account-credibility"
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
  accountCredibility?: AccountCredibility;
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

  request.accountContext = parseAccountContext(input.accountContext);
  request.extractedLinks = parseLinkEvidence(input.extractedLinks);
  request.imageCrop = parseImageCropEvidence(input.imageCrop);
  if (input.consentToStoreEvidence === true) {
    request.consentToStoreEvidence = true;
  }
  if (typeof input.consentLabel === "string" && input.consentLabel.trim()) {
    request.consentLabel = input.consentLabel.slice(0, 200);
  }
  if (input.verificationMode === "fast" || input.verificationMode === "web") {
    request.verificationMode = input.verificationMode;
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
    accountCredibility: sanitizeAccountCredibility(raw.accountCredibility),
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
    accountCredibility: analysis.accountCredibility,
    analysisVersion: ANALYSIS_VERSION
  });
}

export async function assessCredibility(
  request: CredibilityAssessRequest,
  env: Env
): Promise<CredibilityAssessResponse> {
  const baseline = heuristicAssessment(request);
  if (!env.OPENAI_API_KEY) {
    return maybeAddWebVerification(baseline, request, env);
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
          "Your job is to estimate whether visible social media or web content is low, medium, high, or unknown risk.",
          "Use only the supplied evidence: visible text, selected text, OCR text, extracted links, source URL, author/account name, visible profile signals, account context, and optional image description or image crop.",
          "Do not browse the web. Do not invent account age, verification status, source reputation, image facts, or hidden context.",
          "Start from the deterministic baseline assessment and improve it only when supplied evidence supports the change.",
          "Check exactly these categories: scam language, account credibility, source credibility, link mismatch, claim verification, and AI-image suspicion.",
          "Scam language means urgency, prizes, giveaways, miracle cures, investment pressure, threats, account verification, requests for codes, payment, downloads, personal details, or replies.",
          "Account credibility means judging only supplied visible account context, such as profile URL, display name, joined-date text, follower or friend count text, verification signals, bio text, and recent visible post samples.",
          "Source credibility means judging whether the author, account name, handle, source URL, visible profile signals, and domain look official, established, suspicious, mismatched, or missing.",
          "Link mismatch means visible link text differs from the real destination, or links use shorteners, lookalike domains, login/verify/prize wording, IP addresses, punycode, or unrelated domains.",
          "Claim verification means checking whether important claims are supported by the provided source/domain/profile/text evidence. Health, finance, emergency, legal, police, tax, government, recall, and safety claims need official or established source evidence.",
          "AI-image suspicion means checking OCR or image description for AI-generated, synthetic, edited, manipulated, deepfake, before/after transformation, sensational image claims, or staged/demo labels.",
          "If evidence is thin, use Cannot verify or Needs checking rather than guessing.",
          "Keep the explanation plain, calm, and short. Explain the top 1-3 reasons without technical jargon or shaming the user.",
          "Give a concrete elderly-friendly next step, such as do not click, open the official app or website yourself, call a trusted number, or ask someone you trust.",
          "Return JSON matching the schema exactly."
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

    const assessment = mergeModelAssessment(
      baseline,
      normalizeAssessment(JSON.parse(text) as CredibilityAssessResponse)
    );
    return maybeAddWebVerification(assessment, request, env);
  } catch {
    return maybeAddWebVerification(baseline, request, env);
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

  const account = assessAccountCredibility(request);
  score += account.scoreDelta;
  evidenceFor.push(...account.evidenceFor);
  evidenceAgainst.push(...account.evidenceAgainst);
  missingSignals.push(...account.missingSignals);
  signals.push(...account.signals);

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
    signals,
    accountCredibility: account.accountCredibility
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

  const profileText = [
    ...(request.visibleProfileSignals || []),
    request.accountContext?.profileUrl,
    request.accountContext?.displayName,
    request.accountContext?.handle,
    request.accountContext?.accountAgeText,
    request.accountContext?.followerCountText,
    request.accountContext?.friendCountText,
    ...(request.accountContext?.verificationSignals || [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (profileText) {
    evidenceFor.push("Some visible profile or account signals were captured.");
    scoreDelta += 3;
  } else {
    missingSignals.push("No account age, verification, or profile history is visible.");
  }

  if (hasPositiveTrustSignal(profileText)) {
    evidenceFor.push("The visible profile signals suggest an official or verified source.");
    scoreDelta += 8;
  }

  const trustedDomain = domains.find(isTrustedDomain);
  if (trustedDomain) {
    evidenceFor.push(`The link domain ${trustedDomain} looks like an official or established source.`);
    scoreDelta += 12;
  }

  const trustedSource = trustedSourceFromEvidence(request, domains);
  if (trustedSource) {
    evidenceFor.push(`The captured evidence mentions ${trustedSource.name}, which is a recognized ${trustedSource.sourceType} source.`);
    signals.push({
      category: "source-credibility",
      weight: 4,
      message: `Recognized source evidence: ${trustedSource.name}.`
    });
    scoreDelta += trustedSource.sourceType === "official" || trustedSource.sourceType === "medical" ? 12 : 10;
  }

  const officialClaim =
    /official|government|bank|medicare|mygov|ato|police|council|emergency/.test(text) ||
    (/\bhealth\b/.test(text) && !isGeneralNutritionWellnessAdvice(text));
  if (officialClaim && !trustedDomain && !trustedSource) {
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

function assessAccountCredibility(request: CredibilityAssessRequest): {
  scoreDelta: number;
  evidenceFor: string[];
  evidenceAgainst: string[];
  missingSignals: string[];
  signals: RiskSignal[];
  accountCredibility?: AccountCredibility;
} {
  const account = request.accountContext;
  if (!account) {
    return { scoreDelta: 0, evidenceFor: [], evidenceAgainst: [], missingSignals: [], signals: [] };
  }

  const signalsFor: string[] = [];
  const signalsAgainst: string[] = [];
  const missingSignals: string[] = [];
  const evidenceFor: string[] = [];
  const evidenceAgainst: string[] = [];
  const riskSignals: RiskSignal[] = [];
  let scoreDelta = 0;

  if (account.displayName || account.handle || account.profileUrl) {
    signalsFor.push("The poster account identity was captured.");
    evidenceFor.push("The poster account identity was captured.");
    scoreDelta += 3;
  } else {
    missingSignals.push("The poster profile URL, display name, or handle was not captured.");
    scoreDelta -= 4;
  }

  if (request.authorName && account.displayName && !sameLooseName(request.authorName, account.displayName)) {
    signalsAgainst.push("The visible author name and captured profile name do not clearly match.");
    evidenceAgainst.push("The visible author name and captured profile name do not clearly match.");
    riskSignals.push({
    …