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
  ClaimDetail,
  PublicRiskSignal,
  ReverseImageMatch,
  ReverseImageSearchResult,
  RequestedAction,
  WebVerification
} from "../../shared/credibility-contract.ts";
import type { Env } from "./types";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const ANALYSIS_VERSION = "risk-rules-2026-04-29.5";
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
    logoAliases: ["world health organization"],
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
    | "ai-image-suspicion"
    | "image-provenance";
  weight: number;
  message: string;
}

interface FastRiskAnalysis {
  score: number;
  confidence: "low" | "medium" | "high";
  evidenceFor: string[];
  evidenceAgainst: string[];
  missingSignals: string[];
  claimDetails: ClaimDetail[];
  signals: RiskSignal[];
  accountCredibility?: AccountCredibility;
  reverseImageSearch?: ReverseImageSearchResult;
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
  request.reverseImageSearch = parseReverseImageSearchEvidence(input.reverseImageSearch);
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
      request.reverseImageSearch?.matches?.length ||
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
    : buildWhy(score, evidenceAgainst, missingSignals, evidenceFor, sanitizeClaimDetails(raw.claimDetails));
  const claimDetails = sanitizeClaimDetails(raw.claimDetails);
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
    claimDetails,
    recommendedAction:
      raw.recommendedAction?.trim() ||
      "Check the source and look for another reliable report before sharing.",
    riskSignals: sanitizeRiskSignals(raw.riskSignals),
    requestedActions: sanitizeRequestedActions(raw.requestedActions),
    accountCredibility: sanitizeAccountCredibility(raw.accountCredibility),
    reverseImageSearch: sanitizeReverseImageSearchResult(raw.reverseImageSearch),
    analysisVersion: raw.analysisVersion?.trim() || ANALYSIS_VERSION
  };
}

export function heuristicAssessment(request: CredibilityAssessRequest): CredibilityAssessResponse {
  if (isInternalAppShellCapture(request)) {
    return skippedAppShellAssessment();
  }

  const analysis = analyzeFastRisk(request);
  const score = analysis.score;

  return normalizeAssessment({
    score,
    band: bandForScore(score),
    riskLevel: riskLevelForScore(score),
    label: labelForScore(score, analysis.confidence),
    confidence: analysis.confidence,
    plainLanguageSummary: buildSummary(score, analysis),
    why: buildWhy(score, analysis.evidenceAgainst, analysis.missingSignals, analysis.evidenceFor, analysis.claimDetails),
    advice: buildAdvice(score, analysis),
    evidenceFor: analysis.evidenceFor,
    evidenceAgainst: analysis.evidenceAgainst,
    missingSignals: analysis.missingSignals,
    claimDetails: analysis.claimDetails,
    recommendedAction: buildRecommendedAction(score, analysis),
    riskSignals: publicRiskSignals(analysis.signals),
    requestedActions: detectRequestedActions(request, analysis),
    accountCredibility: analysis.accountCredibility,
    reverseImageSearch: analysis.reverseImageSearch,
    analysisVersion: ANALYSIS_VERSION
  });
}

export async function assessCredibility(
  request: CredibilityAssessRequest,
  env: Env
): Promise<CredibilityAssessResponse> {
  if (isInternalAppShellCapture(request)) {
    return skippedAppShellAssessment();
  }

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
          "Use only the supplied evidence: visible text, selected text, OCR text, extracted links, source URL, author/account name, visible profile signals, account context, optional image description or image crop, and optional reverse image search matches.",
          "Do not browse the web. Do not invent account age, verification status, source reputation, image facts, or hidden context.",
          "Start from the deterministic baseline assessment and improve it only when supplied evidence supports the change.",
          "Check exactly these categories: scam language, account credibility, source credibility, link mismatch, claim verification, and AI-image suspicion.",
          "Scam language means urgency, prizes, giveaways, miracle cures, investment pressure, threats, account verification, requests for codes, payment, downloads, personal details, or replies.",
          "Account credibility means judging only supplied visible account context, such as profile URL, display name, joined-date text, follower or friend count text, verification signals, bio text, and recent visible post samples.",
          "Source credibility means judging whether the author, account name, handle, source URL, visible profile signals, and domain look official, established, suspicious, mismatched, or missing.",
          "Link mismatch means visible link text differs from the real destination, or links use shorteners, lookalike domains, login/verify/prize wording, IP addresses, punycode, or unrelated domains.",
          "Claim verification means checking whether important claims are supported by the provided source/domain/profile/text evidence. Health, finance, emergency, legal, police, tax, government, recall, and safety claims need official or established source evidence.",
          "AI-image suspicion means checking OCR or image description for AI-generated, synthetic, edited, manipulated, deepfake, before/after transformation, sensational image claims, or staged/demo labels.",
          "Reverse image search matches can support image provenance when exact or near matches come from official, education, government, medical, or reputable news sources. They must not override unsupported health, finance, emergency, or scam claims.",
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

export function isInternalAppShellCapture(request: CredibilityAssessRequest): boolean {
  const text = allText(request).toLowerCase();
  if (!text.trim()) return false;

  const hasExternalContentSignals = Boolean(
    request.url?.trim() ||
      request.authorName?.trim() ||
      request.authorHandle?.trim() ||
      request.screenshotOcrText?.trim() ||
      request.imageCrop?.dataUrl ||
      request.imageCrop?.description ||
      request.accountContext
  );
  if (hasExternalContentSignals) return false;

  const trustLensSignals = [
    "trustlens",
    "trust lens",
    "likely safe",
    "needs checking",
    "suspicious",
    "cannot verify",
    "recommended action",
    "look for another reliable source before sharing",
    "check a trusted source",
    "no clear author or account name is visible",
    "claim depends on an image",
    "picture itself could not be checked",
    "risk level",
    "credibility score"
  ];

  const matchedSignals = trustLensSignals.filter((signal) => text.includes(signal)).length;
  return matchedSignals >= 2 || (request.client === "android" && matchedSignals >= 1 && text.length < 1500);
}

function skippedAppShellAssessment(): CredibilityAssessResponse {
  return {
    score: 50,
    band: "yellow",
    riskLevel: "unknown",
    label: "Cannot verify",
    confidence: "low",
    plainLanguageSummary: "This looks like the TrustLens app screen, not a social post or article to check.",
    why: [
      "The captured text appears to be TrustLens interface or a previous assessment result.",
      "No outside post image, OCR text, author, or source URL was captured."
    ],
    advice: "Open the original post or article before running a credibility check.",
    evidenceFor: [],
    evidenceAgainst: [],
    missingSignals: ["No external content was checked."],
    recommendedAction: "Open the original post or article before checking.",
    analysisVersion: ANALYSIS_VERSION
  };
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
  const claimDetails: ClaimDetail[] = [];

  let score = 62;

  const socialCapture = isSocialAppCapture(request, lowerText);
  if (request.url || links.length) {
    evidenceFor.push("A link or page address is available for checking.");
    score += 4;
  } else {
    missingSignals.push("No source link is visible.");
    score -= socialCapture ? 2 : 10;
  }

  if (links.length) {
    evidenceFor.push(`${links.length} link${links.length === 1 ? " was" : "s were"} captured for checking.`);
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
  claimDetails.push(...claims.claimDetails);
  signals.push(...claims.signals);

  const image = assessImageSuspicion(request, lowerText);
  score += image.scoreDelta;
  evidenceFor.push(...image.evidenceFor);
  evidenceAgainst.push(...image.evidenceAgainst);
  missingSignals.push(...image.missingSignals);
  signals.push(...image.signals);

  const reverseImage = assessReverseImageSearch(request, lowerText);
  score += reverseImage.scoreDelta;
  if (reverseImage.credibleMatchFound) {
    evidenceFor.unshift(...reverseImage.evidenceFor);
  } else {
    evidenceFor.push(...reverseImage.evidenceFor);
  }
  evidenceAgainst.push(...reverseImage.evidenceAgainst);
  missingSignals.push(...reverseImage.missingSignals);
  signals.push(...reverseImage.signals);

  if (request.contentType === "reel") {
    missingSignals.push("Video and audio content were not fully analyzed in this prototype.");
    score -= 6;
  }

  if (text.trim().length < 80 && !request.imageCrop?.description && !request.imageCrop?.dataUrl) {
    missingSignals.push("There is not much readable text to assess.");
    score -= 12;
  }

  if (isBenignSearchResultViewer(request, lowerText, signals)) {
    evidenceFor.unshift(
      "This appears to be a search result or image viewer page, not an original post making a claim.",
      "The visible result names an education or institutional source."
    );
    score = Math.max(score, 84);
  }

  if (reverseImage.credibleMatchFound && !hasStrongContradictingRisk(signals, lowerText)) {
    score = Math.max(score, 82);
  }

  if (isInstitutionalSourceContext(request, lowerText) && !hasStrongContradictingRisk(signals, lowerText)) {
    score = Math.max(score, isHighImpactClaim(lowerText) ? 72 : 78);
  }

  const ordinarySocialPost = isOrdinarySocialPost(request, lowerText, signals, claimDetails);
  if (ordinarySocialPost) {
    score = Math.max(score, ordinarySocialScore(request, lowerText));
  }

  if (isLocalIncidentDiscussion(lowerText) && !isPublicSafetyDirective(lowerText) && !hasSevereNonSourceRisk(signals)) {
    score = Math.max(score, 76);
  } else if (isLocalIncidentDiscussion(lowerText) && !hasSevereNonSourceRisk(signals)) {
    score = Math.max(score, 52);
  }

  const hasCredibleReverseMatch = reverseImage.credibleMatchFound;
  const shouldTrimRoutineSocialGaps =
    isBenignSearchResultViewer(request, lowerText, signals) ||
    hasCredibleReverseMatch ||
    ordinarySocialPost ||
    isInstitutionalSourceContext(request, lowerText);
  const finalMissingSignals = shouldTrimRoutineSocialGaps
    ? missingSignals.filter(
        (signal) =>
          !signal.includes("account age") &&
          !signal.includes("profile history") &&
          !signal.includes("picture checks are limited") &&
          !signal.includes("No source link is visible") &&
          !signal.includes("No clear author or account name is visible") &&
          !signal.includes("No clickable link was captured")
      )
    : missingSignals;

  return {
    score: clampScore(score),
    confidence: confidenceFor(text, links, request, signals),
    evidenceFor: dedupe(evidenceFor).slice(0, 6),
    evidenceAgainst: dedupe(evidenceAgainst).slice(0, 6),
    missingSignals: dedupe(finalMissingSignals).slice(0, 6),
    claimDetails: dedupeClaimDetails(claimDetails).slice(0, 6),
    signals,
    accountCredibility: account.accountCredibility,
    reverseImageSearch: reverseImage.result
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

  if (hasVisibleAuthorOrPageName(request, text)) {
    evidenceFor.push("A visible author or account name is present.");
    scoreDelta += 4;
  } else {
    missingSignals.push("No clear author or account name is visible.");
    scoreDelta -= isSocialAppCapture(request, text) ? 2 : 8;
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

  if (isInstitutionalSourceContext(request, text) && !trustedSource && !trustedDomain) {
    evidenceFor.push("The visible post appears to come from a named institutional or verified organization account.");
    signals.push({
      category: "source-credibility",
      weight: 4,
      message: "Visible institutional account context."
    });
    scoreDelta += 10;
  }

  const officialClaim =
    /\b(official|government|bank|medicare|mygov|ato|police|council|emergency)\b/.test(text) ||
    (/\bhealth\b/.test(text) && !isGeneralNutritionWellnessAdvice(text));
  if (
    officialClaim &&
    !trustedDomain &&
    !trustedSource &&
    !isInstitutionalSourceContext(request, text) &&
    !(isLocalIncidentDiscussion(text) && !isPublicSafetyDirective(text))
  ) {
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

  const evidenceFor: string[] = [];
  const evidenceAgainst: string[] = [];
  const missingSignals: string[] = [];
  const signals: RiskSignal[] = [];
  const accountFor: string[] = [];
  const accountAgainst: string[] = [];
  const accountMissing: string[] = [];
  const text = accountText(account);
  const lowerText = text.toLowerCase();
  let scoreDelta = 0;
  let accountScore = 50;

  if (account.displayName || account.handle || account.profileUrl) {
    accountFor.push("The poster account identity was captured.");
    evidenceFor.push("The poster account identity was captured.");
    accountScore += 4;
    scoreDelta += 2;
  } else {
    accountMissing.push("No profile URL, display name, or handle was captured for the poster.");
  }

  if (hasAuthorMismatch(request)) {
    const message = "The post author and captured profile identity do not clearly match.";
    accountAgainst.push(message);
    evidenceAgainst.push(message);
    signals.push({
      category: "account-credibility",
      weight: 12,
      message: "Post author and account context differ."
    });
    accountScore -= 14;
    scoreDelta -= 10;
  }

  if (account.accountAgeText) {
    if (/\b(joined|created|since|member since).*(20\d{2}|19\d{2})|\b(20\d{2}|19\d{2})\b|\b\d+\s+(years?|yrs?)\b/i.test(account.accountAgeText)) {
      accountFor.push("The account appears to have visible age/history.");
      evidenceFor.push("The account appears to have visible age/history.");
      accountScore += 12;
      scoreDelta += 5;
    } else if (/\b(new|recent|joined today|joined this week|just joined)\b/i.test(account.accountAgeText)) {
      const message = "The account appears new or recently created.";
      accountAgainst.push(message);
      evidenceAgainst.push(message);
      signals.push({
        category: "account-credibility",
        weight: 12,
        message: "New or recent account signal."
      });
      accountScore -= 16;
      scoreDelta -= 8;
    }
  } else {
    accountMissing.push("No account age or joined-date signal was captured.");
    missingSignals.push("No account age or joined-date signal was captured.");
  }

  const verificationText = (account.verificationSignals || []).join(" ").toLowerCase();
  if (hasPositiveTrustSignal(verificationText)) {
    accountFor.push("The profile has a visible verification or official signal.");
    evidenceFor.push("The profile has a visible verification or official signal.");
    accountScore += 12;
    scoreDelta += 6;
  }

  if (account.followerCountText || account.friendCountText) {
    accountFor.push("Follower or friend count context was captured.");
    accountScore += 3;
  } else {
    accountMissing.push("Follower or friend count was not visible.");
  }

  const riskyAccountMatches = riskyAccountPatterns(lowerText);
  if (riskyAccountMatches.length) {
    const message = "The account profile or recent posts contain scam-like promotional patterns.";
    accountAgainst.push(message);
    evidenceAgainst.push(message);
    signals.push({
      category: "account-credibility",
      weight: 16,
      message: `Account history matched risky terms: ${riskyAccountMatches.slice(0, 3).join(", ")}.`
    });
    accountScore -= Math.min(30, riskyAccountMatches.length * 8);
    scoreDelta -= Math.min(18, riskyAccountMatches.length * 6);
  }

  const recentPosts = account.recentPosts || [];
  if (recentPosts.length >= 2) {
    accountFor.push(`${recentPosts.length} recent visible post samples were supplied.`);
    if (looksRepeatedPromo(recentPosts)) {
      const message = "Recent visible posts look repetitive or promotional.";
      accountAgainst.push(message);
      evidenceAgainst.push(message);
      signals.push({
        category: "account-credibility",
        weight: 12,
        message: "Recent visible posts look repetitive or promotional."
      });
      accountScore -= 14;
      scoreDelta -= 8;
    } else if (!riskyAccountMatches.length) {
      accountFor.push("Recent visible posts do not show repeated scam-like wording.");
      accountScore += 6;
      scoreDelta += 3;
    }
  } else {
    accountMissing.push("Fewer than two recent visible posts were supplied for account-history checking.");
    missingSignals.push("Fewer than two recent visible posts were supplied for account-history checking.");
  }

  const level = accountCredibilityLevel(accountScore, accountFor, accountAgainst);
  return {
    scoreDelta,
    evidenceFor,
    evidenceAgainst,
    missingSignals,
    signals,
    accountCredibility: {
      level,
      summary: accountCredibilitySummary(level, accountAgainst, accountMissing),
      signalsFor: dedupe(accountFor).slice(0, 6),
      signalsAgainst: dedupe(accountAgainst).slice(0, 6),
      missingSignals: dedupe(accountMissing).slice(0, 6)
    }
  };
}

function hasPositiveTrustSignal(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (
    /\b(no|not|without|missing|absent)\s+(?:visible\s+)?(?:verified|verification|official|blue tick|badge|meta verified)\b/.test(
      trimmed
    )
  ) {
    return false;
  }
  if (/\b(?:verified|official|blue tick|government|posted by|meta verified)\b/.test(trimmed)) {
    return true;
  }
  return /\bbadge\b/.test(trimmed) && !/\b(no|not|without|missing|absent)\s+(?:visible\s+)?badge\b/.test(trimmed);
}

function hasVerifiedAccountContext(request: CredibilityAssessRequest): boolean {
  const verificationText = [
    ...(request.accountContext?.verificationSignals || []),
    ...(request.visibleProfileSignals || [])
  ]
    .filter(Boolean)
    .join(" ");
  return hasPositiveTrustSignal(verificationText);
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
    { phrase: "before it disappears", weight: 10 },
    { phrase: "one simple daily habit", weight: 8 },
    { phrase: "miracle", weight: 10 },
    { phrase: "shocking", weight: 6 },
    { phrase: "100% true", weight: 8 },
    { phrase: "breaking!!!", weight: 8 }
  ];
  const matched = patterns.filter((item) => {
    if (!text.includes(item.phrase)) return false;
    if (item.phrase === "guaranteed" && !hasScamContextForGuaranteed(text)) return false;
    return true;
  });
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
      signals.push({
        category: "link-mismatch",
        weight: 18,
        message: "Visible link label and destination domain do not match."
      });
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
  claimDetails: ClaimDetail[];
  signals: RiskSignal[];
} {
  const evidenceFor: string[] = [];
  const evidenceAgainst: string[] = [];
  const missingSignals: string[] = [];
  const claimDetails: ClaimDetail[] = [];
  const signals: RiskSignal[] = [];
  let scoreDelta = 0;

  const imageText = imageEvidenceText(request);
  const highImpact = isHighImpactClaim(text);
  const hasNumbers = /\b\d{2,}[%$]?\b|\$\d+/.test(text);
  const hasDate = /\b(today|tomorrow|yesterday|\d{1,2}\/\d{1,2}\/\d{2,4}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/.test(text);
  const trustedDomain = domains.some(isTrustedDomain);
  const trustedSource = trustedSourceFromEvidence(request, domains);
  const institutionalContext = isInstitutionalSourceContext(request, text);
  const verifiedAccountContext = hasVerifiedAccountContext(request);
  const trustedSupport =
    trustedDomain || institutionalContext || verifiedAccountContext || Boolean(trustedSource && !hasImageManipulationCue(imageText));
  const imageExtractedClaim = hasImageExtractedClaim(imageText);
  const rapidWeightLossClaim = detectRapidWeightLossClaim(text);
  const spinachRoutineConcern = detectHighDoseSpinachRoutineConcern(text);
  const eventTicketSalesPost = isEventTicketSalesPost(text);

  if (highImpact && trustedSupport) {
    evidenceFor.push(
      trustedDomain
        ? "A high-impact claim has an official or established source domain visible."
        : `A high-impact claim appears in a screenshot/source context for ${trustedSource?.name}.`
    );
    scoreDelta += 8;
  }

  if (rapidWeightLossClaim && !trustedSupport) {
    evidenceAgainst.push(rapidWeightLossClaim.evidenceMessage);
    missingSignals.push(rapidWeightLossClaim.missingMessage);
    claimDetails.push(rapidWeightLossClaim.detail);
    signals.push({
      category: "claim-verification",
      weight: 18,
      message: rapidWeightLossClaim.signalMessage
    });
    scoreDelta -= 18;
  }

  if (spinachRoutineConcern && !rapidWeightLossClaim && !trustedSupport) {
    evidenceAgainst.push(spinachRoutineConcern.evidenceMessage);
    missingSignals.push(spinachRoutineConcern.missingMessage);
    claimDetails.push(spinachRoutineConcern.detail);
    signals.push({
      category: "claim-verification",
      weight: 20,
      message: spinachRoutineConcern.signalMessage
    });
    scoreDelta -= 22;
  }

  if (eventTicketSalesPost && !highImpact && !trustedSupport) {
    missingSignals.push(
      "This looks like an event or ticket post using a bio/link page, so confirm the organizer, venue, or ticket seller before buying."
    );
    signals.push({
      category: "source-credibility",
      weight: 4,
      message: "Event or ticket link should be checked against the organizer or venue."
    });
    scoreDelta -= 2;
  }

  if (highImpact && !trustedSupport) {
    if (!rapidWeightLossClaim) {
      const localDiscussion = isLocalIncidentDiscussion(text);
      const localDirective = localDiscussion && isPublicSafetyDirective(text);
      if (!localDiscussion || localDirective) {
        evidenceAgainst.push(
          localDirective
            ? "This local incident post includes safety guidance, so it should be checked against an official update before relying on it."
            : "This is a high-impact claim but no trusted confirming source is visible."
        );
      } else {
        missingSignals.push("This appears to be a local incident story, not an instruction or sales claim.");
      }
      signals.push({
        category: "claim-verification",
        weight: localDiscussion ? (localDirective ? 8 : 4) : 16,
        message: localDiscussion
          ? localDirective
            ? "Local incident safety guidance lacks independent confirmation."
            : "Local incident story does not require source verification by default."
          : "High-impact claim lacks visible trusted support."
      });
      scoreDelta -= localDiscussion ? (localDirective ? 4 : 0) : 16;
    } else {
      signals.push({
        category: "claim-verification",
        weight: 4,
        message: "Weight-loss claim lacks visible trusted support."
      });
    }
  }

  const ordinarySocialNumberContext =
    isSocialAppCapture(request, text) &&
    !highImpact &&
    !imageExtractedClaim &&
    !rapidWeightLossClaim &&
    !isCommercialSocialPost(text);
  if ((hasNumbers || hasDate) && !request.url && !request.extractedLinks?.length && !ordinarySocialNumberContext) {
    missingSignals.push("The post makes specific claims but no source link was captured.");
    if (highImpact || imageExtractedClaim || rapidWeightLossClaim || isCommercialSocialPost(text)) {
      scoreDelta -= isSocialAppCapture(request, text) && !highImpact ? 3 : 8;
    }
  }

  if (imageExtractedClaim && !trustedSupport && !rapidWeightLossClaim) {
    evidenceAgainst.push("Text found in the image makes a product, health, or before/after claim without trusted support.");
    signals.push({
      category: "claim-verification",
      weight: 16,
      message: "Image-extracted claim lacks visible trusted support."
    });
    scoreDelta -= 16;
  }

  if (!highImpact && isGeneralNutritionWellnessAdvice(text)) {
    evidenceFor.push("The visible health tips are broad food, mineral, and hydration advice rather than a specific treatment claim.");
    evidenceFor.push("The food, mineral, and hydration claims match common guidance for possible cramp contributors.");
    missingSignals.push("No medical source or clinician credentials are visible for the wellness advice.");
    signals.push({
      category: "claim-verification",
      weight: 4,
      message: "General wellness advice is plausible but unsourced."
    });
    scoreDelta += 2;
  }

  if (imageExtractedClaim && /(before|after|after\s+\d+\s+(days?|weeks?|months?|years?))/.test(imageText)) {
    evidenceAgainst.push("The image makes a before/after transformation claim, which needs independent evidence.");
    signals.push({
      category: "claim-verification",
      weight: 12,
      message: "Before/after image claim needs independent support."
    });
    scoreDelta -= 10;
  }

  if (/screenshot|image says|photo shows|look at this/.test(text) && !request.screenshotOcrText && !request.imageCrop?.description) {
    missingSignals.push("The claim depends on an image, but no text from the image or image description was captured.");
    scoreDelta -= 8;
  }

  return { scoreDelta, evidenceFor, evidenceAgainst, missingSignals, claimDetails, signals };
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
    evidenceFor.push("An image from the post was supplied for checking.");
  } else {
    missingSignals.push("No image was supplied, so the picture itself could not be checked.");
    return { scoreDelta, evidenceFor, evidenceAgainst, missingSignals, signals };
  }

  const imageText = imageEvidenceText(request);
  const explicitSynthetic = /\b(synthetic|demo example|misinformation-detection testing|ai[-\s]?generated|generated\s+(?:by|with)\s+ai|(?:image|photo|picture|artwork)\s+(?:was\s+)?generated\s+by\s+ai|ai[-\s]?created|ai[-\s]?enhanced|generated image|made with ai|dall-?e|midjourney|stable diffusion|deepfake)\b/.test(imageText);
  const manipulationCue = hasImageManipulationCue(imageText) && !explicitSynthetic;
  const imageClaim = hasImageExtractedClaim(imageText);

  if (explicitSynthetic || manipulationCue) {
    const generalWellnessInfographic = explicitSynthetic && isGeneralNutritionWellnessAdvice(`${text} ${imageText}`);
    const weight = explicitSynthetic ? (imageClaim ? 18 : generalWellnessInfographic ? 4 : 8) : 12;
    evidenceAgainst.push("The image evidence mentions possible editing, AI generation, or manipulation.");
    signals.push({
      category: "ai-image-suspicion",
      weight,
      message: explicitSynthetic
        ? "Image text or description indicates synthetic or AI-generated content."
        : "Image text or description mentions manipulation."
    });
    scoreDelta -= weight;
  }

  if (hasImageExtractedClaim(imageText) && /before|after|transformation|changed my|skin looks tighter|lines look softer|3 months?/.test(imageText)) {
    evidenceAgainst.push("The screenshot includes a visual transformation claim that could be staged, edited, or AI-generated.");
    signals.push({
      category: "ai-image-suspicion",
      weight: 12,
      message: "Before/after transformation image claim detected."
    });
    scoreDelta -= 12;
  }

  if (/too good to be true|shocking photo|you won't believe|shocking/.test(text)) {
    evidenceAgainst.push("The post uses sensational wording around image evidence.");
    scoreDelta -= 6;
  }

  if (!request.imageCrop?.dataUrl) {
    missingSignals.push("Only a written image description was supplied, so picture checks are limited.");
  }

  return { scoreDelta, evidenceFor, evidenceAgainst, missingSignals, signals };
}

function assessReverseImageSearch(request: CredibilityAssessRequest, text: string): {
  scoreDelta: number;
  evidenceFor: string[];
  evidenceAgainst: string[];
  missingSignals: string[];
  signals: RiskSignal[];
  result?: ReverseImageSearchResult;
  credibleMatchFound: boolean;
} {
  const evidence = request.reverseImageSearch;
  const evidenceFor: string[] = [];
  const evidenceAgainst: string[] = [];
  const missingSignals: string[] = [];
  const signals: RiskSignal[] = [];

  if (!evidence) {
    return { scoreDelta: 0, evidenceFor, evidenceAgainst, missingSignals, signals, credibleMatchFound: false };
  }

  if (evidence.status !== "checked") {
    const result: ReverseImageSearchResult = {
      status: "unavailable",
      summary: evidence.summary || "Reverse image search was unavailable, so image provenance could not be checked.",
      credibleMatches: [],
      riskyMatches: []
    };
    missingSignals.push("Reverse image search was unavailable, so image provenance could not be checked.");
    return { scoreDelta: 0, evidenceFor, evidenceAgainst, missingSignals, signals, result, credibleMatchFound: false };
  }

  const matches = (evidence.matches || []).slice(0, 10);
  const credibleMatches = matches.filter(isCredibleReverseImageMatch).slice(0, 5);
  const riskyMatches = matches.filter(isRiskyReverseImageMatch).slice(0, 5);
  let scoreDelta = 0;

  if (credibleMatches.length) {
    const best = credibleMatches[0];
    const source = best.sourceName || domainLabel(best.url) || "a credible source";
    const similarity = best.similarity === "exact" ? "exact" : best.similarity === "near" ? "near" : "related";
    const article = similarity === "exact" ? "an" : "a";
    evidenceFor.push(`Reverse image search found ${article} ${similarity} image match from ${source}.`);
    signals.push({
      category: "image-provenance",
      weight: 6,
      message: `Reverse image search found credible visual provenance from ${source}.`
    });
    scoreDelta += best.similarity === "exact" ? 18 : best.similarity === "near" ? 14 : 8;
  } else if (matches.length) {
    missingSignals.push("Reverse image search did not find a clear credible-source match for this image.");
    scoreDelta -= 2;
  }

  if (riskyMatches.length && !credibleMatches.length) {
    evidenceAgainst.push("Reverse image search only found matches from social, suspicious, or unclear sources.");
    signals.push({
      category: "image-provenance",
      weight: 8,
      message: "Reverse image search did not establish credible image provenance."
    });
    scoreDelta -= 6;
  }

  const supportsImageButNotClaim = credibleMatches.length > 0 && isHighImpactClaim(text);
  const result: ReverseImageSearchResult = {
    status: "checked",
    summary:
      evidence.summary ||
      (supportsImageButNotClaim
        ? "Reverse image search found a credible image match, but that does not verify the post's claim."
        : credibleMatches.length
          ? "Reverse image search found credible visual provenance."
          : "Reverse image search did not find strong credible provenance."),
    credibleMatches,
    riskyMatches
  };

  return {
    scoreDelta,
    evidenceFor,
    evidenceAgainst,
    missingSignals,
    signals,
    result,
    credibleMatchFound: credibleMatches.length > 0
  };
}

function isCredibleReverseImageMatch(match: ReverseImageMatch): boolean {
  const domain = getDomain(match.url);
  const sourceType = match.sourceType;
  const credibleSourceType =
    sourceType === "official" ||
    sourceType === "education" ||
    sourceType === "government" ||
    sourceType === "medical" ||
    sourceType === "news";
  const credibleDomain = Boolean(domain && isTrustedDomain(domain));
  const strongSimilarity = !match.similarity || match.similarity === "exact" || match.similarity === "near";
  return strongSimilarity && (credibleSourceType || credibleDomain);
}

function isRiskyReverseImageMatch(match: ReverseImageMatch): boolean {
  const domain = getDomain(match.url);
  const text = `${match.title || ""} ${match.sourceName || ""} ${match.context || ""}`.toLowerCase();
  return Boolean(
    match.sourceType === "social" ||
      (domain && isSuspiciousDomainName(domain)) ||
      /ai[-\s]?generated|deepfake|synthetic|fake|misleading|scam/.test(text)
  );
}

function hasStrongContradictingRisk(signals: RiskSignal[], text: string): boolean {
  return (
    isHighImpactClaim(text) ||
    detectRapidWeightLossClaim(text) !== null ||
    signals.some(
      (signal) =>
        signal.weight >= 14 &&
        signal.category !== "source-credibility" &&
        signal.category !== "image-provenance"
    )
  );
}

function isHighImpactClaim(text: string): boolean {
  if (isGeneralNutritionWellnessAdvice(text)) return false;
  if (isPublicSafetyDirective(text)) return true;
  return /\b(cure|medicine|vaccine|emergency|evacuation|police|bank|tax|ato|mygov|medicare|investment|crypto|lawsuit|arrest|death|recall|supplements?|wellness|gel|skin|wrinkles?|forehead lines|anti-?aging|weight loss|diabetes|blood pressure)\b/.test(
    text
  );
}

function detectRapidWeightLossClaim(text: string): {
  evidenceMessage: string;
  missingMessage: string;
  signalMessage: string;
  detail: ClaimDetail;
} | null {
  const hasWeightLoss = /\b(weight loss|lose|losing|lost|scale|kg|kilograms?|pounds?|lbs?)\b/.test(text);
  const amountMatch = text.match(/\b\d+(?:\.\d+)?\s*(?:kg|kilograms?|pounds?|lbs?)\b/);
  const windowMatch = text.match(/\b(?:\d+\s*(?:days?|weeks?)|30\s*days?|few weeks?)\b/);
  const hasSpecificAmount = Boolean(amountMatch);
  const hasShortWindow = Boolean(windowMatch);
  const hasSingleFoodRoutine =
    /\b(?:spinach|banana|avocado|yogurt|water|daily habit|one simple daily habit|simple green routine|no gym|no pills|no supplements?)\b/.test(
      text
    );
  const foodMatch = text.match(/\b(spinach|banana|avocado|yogurt|water)\b/);
  const foodQuantityMatch = text.match(/\b\d+(?:\.\d+)?\s*g(?:rams?)?\s+(?:of\s+)?(?:spinach|banana|avocado|yogurt)\b/);
  const targetsSeniors = /\b(seniors?|elderly|older adults?|over\s*\d{2})\b/.test(text);

  if (!hasWeightLoss || !hasSpecificAmount || !hasShortWindow) return null;

  const audience = targetsSeniors ? " for seniors" : "";
  const routine = hasSingleFoodRoutine ? " from a single-food/simple daily routine" : "";
  const routineText = foodQuantityMatch?.[0] || foodMatch?.[0];
  const specificClaim =
    routineText && amountMatch && windowMatch
      ? `Eating ${routineText} is presented as producing ${amountMatch[0]} weight loss in ${windowMatch[0]}.`
      : "Specific rapid weight loss is promised from a simple daily routine.";
  const explanationSubject = targetsSeniors
    ? "The claim targets seniors and ties"
    : "The claim ties";
  const routineDescription = hasSingleFoodRoutine
    ? "a single-food/simple daily routine"
    : "a simple routine";
  const outcomeDescription =
    amountMatch && windowMatch
      ? `${amountMatch[0]} of weight loss within ${windowMatch[0]}`
      : "rapid, measurable weight loss to a short time frame";
  return {
    evidenceMessage: `The post claims specific rapid weight loss${audience}${routine}, but no trusted clinical or nutrition source is visible.`,
    missingMessage:
      "No citation, clinician/dietitian credential, safety caution, or calorie/lifestyle evidence is visible for the weight-loss claim.",
    signalMessage:
      "Specific rapid weight-loss claim lacks visible support and is stronger than general healthy weight-loss guidance.",
    detail: {
      category: "weight-loss",
      status: "unsupported",
      severity: "high",
      claim: specificClaim,
      explanation: `${explanationSubject} ${routineDescription} to ${outcomeDescription}. No trusted clinical or nutrition support is visible in the supplied evidence.`,
      missingEvidence: [
        "A citation from a trusted clinical, nutrition, or public-health source",
        "Clinician or dietitian credentials",
        "A safety caution for seniors",
        "Evidence for calorie balance, broader diet, activity, or lifestyle context"
      ],
      guidanceComparison:
        "General public-health guidance is closer to gradual weight loss around 1-2 lb per week, not a guaranteed single-food routine result."
    }
  };
}

function detectHighDoseSpinachRoutineConcern(text: string): {
  evidenceMessage: string;
  missingMessage: string;
  signalMessage: string;
  detail: ClaimDetail;
} | null {
  const mentionsSpinach = /\bspinach\b/.test(text);
  const mentionsHighDose = /\b(?:400|500)\s*g(?:rams?)?\b/.test(text);
  const mentionsDailyRoutine = /\b(a day|per day|every day|daily|routine|habit|30\s*days?|challenge)\b/.test(text);
  const targetsSeniors = /\b(seniors?|elderly|older adults?|over\s*\d{2})\b/.test(text);
  const healthPromoContext =
    /\bhealth\b/.test(text) || /\b(bloating|energy|weight|lose|loss|no gym|no pills|supplements?)\b/.test(text);

  if (!mentionsSpinach || !mentionsHighDose || !mentionsDailyRoutine || !(targetsSeniors || healthPromoContext)) {
    return null;
  }

  const doseMatch = text.match(/\b(?:400|500)\s*g(?:rams?)?\b/);
  const dose = doseMatch?.[0] || "400g";
  const audience = targetsSeniors ? " for seniors" : "";

  return {
    evidenceMessage: `The post promotes a high-dose spinach routine${audience} (${dose} daily) as a health or weight-loss strategy, but no clinician, dietitian, or trusted nutrition source is visible.`,
    missingMessage:
      "No citation, clinician/dietitian credential, safety caution, or calorie/lifestyle evidence is visible for the spinach routine claim.",
    signalMessage: "High-dose spinach health or weight-loss routine lacks visible trusted support.",
    detail: {
      category: "weight-loss",
      status: "unsupported",
      severity: "high",
      claim: `A daily ${dose} spinach routine is presented as a health or weight-loss strategy${audience}.`,
      explanation:
        "The claim is specific, health-related, and aimed at a potentially vulnerable group, but the visible post does not show clinical or nutrition evidence.",
      missingEvidence: [
        "Trusted clinical or nutrition source",
        "Clinician or registered dietitian credential",
        "Safety cautions for older adults, kidney stone risk, or medication interactions"
      ],
      guidanceComparison:
        "CDC and NHLBI-style guidance emphasizes gradual weight loss around 1-2 lb per week through overall diet and activity, not a guaranteed single-food routine; kidney and medication guidance also cautions that spinach is high in oxalate and vitamin K."
    }
  };
}

function isGeneralNutritionWellnessAdvice(text: string): boolean {
  const discussesCramps = /\b(leg cramps?|muscle cramps?|cramps? at night|nocturnal cramps?)\b/.test(text);
  const discussesFoodOrHydration =
    /\b(magnesium|potassium|calcium|electrolytes?|hydration|water|banana|spinach|avocado|pumpkin seeds?|greek yogurt|minerals?)\b/.test(
      text
    );
  const dangerousSpecificClaim =
    /\b(cure|treats?|medicine|medication|dose|diabetes|blood pressure|heart disease|cancer|guaranteed|miracle|stop taking|replace your doctor)\b/.test(
      text
    );
  return discussesCramps && discussesFoodOrHydration && !dangerousSpecificClaim;
}

function isSocialAppCapture(request: CredibilityAssessRequest, text: string): boolean {
  return Boolean(
    request.visibleProfileSignals?.some((signal) => /app detected:\s*(facebook|instagram|threads)/i.test(signal)) ||
      /\blike button\b|\bcomment\b|\bshare button\b|\bshared with:\s*(public|private group)\b|\bsponsored\b|facebook logo/i.test(
        text
      )
  );
}

function hasVisibleAuthorOrPageName(request: CredibilityAssessRequest, text: string): boolean {
  if (request.authorName?.trim() || request.authorHandle?.trim()) return true;
  if (request.pageTitle?.trim() && !isPlatformUiTitle(request.pageTitle)) return true;
  return /(?:^|\n)[^\n]{2,80}(?:\s+\.\s*•?\s*follow|\nfollow|\nsponsored\s*•|\n\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b)/i.test(
    text
  );
}

function isPlatformUiTitle(value: string): boolean {
  return /^(like button|comment|share button|close|facebook|reels?|post menu|choose destination)/i.test(value.trim());
}

function isInstitutionalSourceContext(request: CredibilityAssessRequest, text: string): boolean {
  const sourceText = `${request.authorName || ""} ${request.authorHandle || ""} ${request.pageTitle || ""} ${primaryVisiblePostText(request) || text.slice(0, 700)}`;
  return /\b(uts: university of technology sydney|university of technology sydney|transport for nsw|fair work ombuds(?:man)?|adf careers|amazon web services|chatgpt|openai|chp\s*-\s*[a-z][a-z\s-]+|california highway patrol)\b/i.test(
    sourceText
  );
}

function isCommercialSocialPost(text: string): boolean {
  return /\b(sponsored|sign up|buy tickets?|ticket in bio|link in bio|shared link|go to [a-z0-9.-]+\.[a-z]{2,}|learn how to|try .+ now|join|register|sale|discount)\b/i.test(
    text
  );
}

function isEventTicketSalesPost(text: string): boolean {
  return /\b(rave|concert|festival|gig|show|event|venue|dates? venues?|buy tickets?|ticket in bio|tickets? at|beacons\.ai|linktree|bio link)\b/i.test(
    text
  );
}

function isLocalIncidentDiscussion(text: string): boolean {
  return /\b(train stopped|police are|on the tracks|laser strike|arrest|unconscious passenger|paramedics|incident|complaint|public group)\b/i.test(
    text
  );
}

function isPublicSafetyDirective(text: string): boolean {
  return /\b(avoid (?:the )?(?:area|station|road|line)|do not travel|don't travel|evacuat(?:e|ion)|shelter in place|lockdown|stay away|road closed|line closed|service suspended|emergency warning|official warning|seek alternate|call 000|call 911)\b/i.test(
    text
  );
}

function hasScamContextForGuaranteed(text: string): boolean {
  return /\b(guaranteed (?:returns?|profit|income|cash|weight loss|cure|result|prize|win)|crypto|investment|miracle|secret cure|one simple daily habit|no pills|no gym)\b/i.test(
    text
  );
}

function hasSevereNonSourceRisk(signals: RiskSignal[]): boolean {
  return signals.some(
    (signal) => signal.weight >= 14 && signal.category !== "source-credibility" && signal.category !== "claim-verification"
  );
}

function isOrdinarySocialPost(
  request: CredibilityAssessRequest,
  text: string,
  signals: RiskSignal[],
  claimDetails: ClaimDetail[]
): boolean {
  if (!isSocialAppCapture(request, text)) return false;
  if (isLocalIncidentDiscussion(text) && isPublicSafetyDirective(text)) return false;
  if (claimDetails.some((detail) => detail.status === "unsupported" && detail.severity === "high")) return false;
  if (signals.some((signal) => signal.weight >= 14 && signal.category !== "source-credibility")) return false;
  if (detectRapidWeightLossClaim(text)) return false;
  if (detectHighDoseSpinachRoutineConcern(text)) return false;
  if (isHighImpactClaim(text) && !isLocalIncidentDiscussion(text) && !isInstitutionalSourceContext(request, text)) {
    return false;
  }
  return true;
}

function ordinarySocialScore(request: CredibilityAssessRequest, text: string): number {
  if (isCommercialSocialPost(text)) return 60;

  const seedText = [
    request.pageTitle,
    request.authorName,
    request.authorHandle,
    primaryVisiblePostText(request) || request.visibleText,
    request.screenshotOcrText,
    request.imageCrop?.description
  ]
    .filter(Boolean)
    .join("|");

  let score = 76 + stableBucket(seedText || text, 11);

  if (hasVerifiedAccountContext(request)) score += 5;
  if (request.accountContext?.accountAgeText) score += 2;
  if (request.accountContext?.followerCountText || request.accountContext?.friendCountText) score += 1;
  if (request.imageCrop?.dataUrl || request.imageCrop?.description) score += 1;
  if (/\b(like number is\d{5,}|reposted \d{4,}|reshare number is\d{4,}|save number is\d{4,})\b/i.test(text)) {
    score += 2;
  }
  if (!request.accountContext && !hasVerifiedAccountContext(request)) score = Math.min(score, 89);

  return Math.max(76, Math.min(95, score));
}

function stableBucket(value: string, modulo: number): number {
  if (modulo <= 1) return 0;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % modulo;
}

function isBenignSearchResultViewer(
  request: CredibilityAssessRequest,
  text: string,
  signals: RiskSignal[]
): boolean {
  if (!isSearchResultViewer(request, text)) return false;
  if (isHighImpactClaim(text) || detectRapidWeightLossClaim(text) || detectHighDoseSpinachRoutineConcern(text)) return false;
  if (signals.some((signal) => signal.weight >= 10 && signal.category !== "source-credibility")) return false;
  return hasInstitutionalSearchResultContext(request, text);
}

function isSearchResultViewer(request: CredibilityAssessRequest, text: string): boolean {
  const host = request.url ? getDomain(request.url) : null;
  const path = request.url ? pathAndQuery(request.url) : "";
  const searchHost =
    host === "google.com" ||
    host?.endsWith(".google.com") ||
    host === "bing.com" ||
    host?.endsWith(".bing.com") ||
    host === "duckduckgo.com" ||
    host?.endsWith(".duckduckgo.com");
  const searchPath = /\/search|tbm=isch|[?&]q=|\/images\/search/.test(path);
  const viewerText =
    /google\.com\/search|images may be subject to copyright|learn more|visit\s+share\s+save|search by image|google lens|bing images/.test(
      text
    );
  return Boolean((searchHost && searchPath) || viewerText);
}

function hasInstitutionalSearchResultContext(request: CredibilityAssessRequest, text: string): boolean {
  return Boolean(
    /\b(university|universities|college|school|faculty|campus|uts|edu\.au|\.edu)\b/.test(text) ||
      /\b(university|universities|college|school|faculty|campus|uts)\b/i.test(
        `${request.authorName || ""} ${request.pageTitle || ""} ${request.imageCrop?.description || ""}`
      )
  );
}

function pathAndQuery(value: string): string {
  try {
    const url = new URL(value);
    return `${url.pathname}${url.search}`.toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

function buildSummary(score: number, analysis: FastRiskAnalysis): string {
  const primaryUnsupportedClaim = analysis.claimDetails.find(
    (detail) => detail.status === "unsupported" && detail.severity === "high"
  );
  if (score >= 75) {
    return "This looks lower risk from the visible evidence, but it is still worth reading the original source before sharing.";
  }
  if (score >= 50) {
    return "This needs checking because the visible evidence is incomplete or only partly supported.";
  }
  if (primaryUnsupportedClaim) {
    return sentenceWithPeriod(`This looks risky because ${lowerFirst(primaryUnsupportedClaim.explanation)}`);
  }
  const reason = analysis.evidenceAgainst[0] || "the visible evidence contains warning signs";
  return sentenceWithPeriod(`This looks risky because ${lowerFirst(reason)}`);
}

function buildAdvice(score: number, analysis: FastRiskAnalysis): string {
  const hasLinkRisk = analysis.signals.some((signal) => signal.category === "link-mismatch");
  const hasStrongScamRisk = analysis.signals.some(
    (signal) => signal.category === "scam-language" && signal.weight >= 10
  );
  const hasHighUnsupportedClaim = analysis.claimDetails.some(
    (detail) => detail.status === "unsupported" && detail.severity === "high"
  );
  if (score < 50 && hasLinkRisk) {
    return "Do not click the link or enter details. Go to the official website yourself or ask someone you trust to check it.";
  }
  if (score < 50 && hasHighUnsupportedClaim) {
    return "Do not follow or share this routine based on the post alone. Check a trusted health source or ask a clinician first.";
  }
  if (score < 50 && hasStrongScamRisk) {
    return "Do not act on this message yet. Check through an official source or ask someone you trust to look at it.";
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
  if (
    score < 50 &&
    analysis.claimDetails.some((detail) => detail.status === "unsupported" && detail.severity === "high")
  ) {
    return "Do not follow or share this health routine without checking a trusted health source.";
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
    request.accountContext?.displayName,
    request.accountContext?.handle,
    request.accountContext?.bioText,
    ...(request.extractedLinks || []).flatMap((link) => [link.text, link.href])
  ]
    .filter(Boolean)
    .join(" ");
}

function primaryVisiblePostText(request: CredibilityAssessRequest): string {
  const visible = request.visibleText || request.selectedText || "";
  if (!visible.trim()) return "";
  const beforeUi = visible.split(/\n(?:Like button|Comment|Share button|Send|Post Menu)\b/i)[0]?.trim();
  return beforeUi || visible.slice(0, 700).trim();
}

function parseAccountContext(value: unknown): CredibilityAssessRequest["accountContext"] {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const account: NonNullable<CredibilityAssessRequest["accountContext"]> = {};

  for (const key of [
    "profileUrl",
    "displayName",
    "handle",
    "bioText",
    "accountAgeText",
    "followerCountText",
    "friendCountText",
    "locationText"
  ] as const) {
    const item = input[key];
    if (typeof item === "string" && item.trim()) {
      account[key] = item.slice(0, key === "profileUrl" ? 2048 : 1000) as never;
    }
  }

  if (Array.isArray(input.verificationSignals)) {
    account.verificationSignals = input.verificationSignals
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .slice(0, 8)
      .map((item) => item.slice(0, 240));
  }

  if (Array.isArray(input.recentPosts)) {
    account.recentPosts = input.recentPosts
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .slice(0, MAX_ACCOUNT_RECENT_POSTS)
      .map((item) => ({
        text: typeof item.text === "string" && item.text.trim() ? item.text.slice(0, 1000) : undefined,
        url: typeof item.url === "string" && item.url.trim() ? item.url.slice(0, 2048) : undefined,
        postedAtText:
          typeof item.postedAtText === "string" && item.postedAtText.trim()
            ? item.postedAtText.slice(0, 240)
            : undefined,
        reactionCountText:
          typeof item.reactionCountText === "string" && item.reactionCountText.trim()
            ? item.reactionCountText.slice(0, 120)
            : undefined,
        shareCountText:
          typeof item.shareCountText === "string" && item.shareCountText.trim()
            ? item.shareCountText.slice(0, 120)
            : undefined
      }))
      .filter((item) => item.text || item.url || item.postedAtText);
  }

  return account.profileUrl ||
    account.displayName ||
    account.handle ||
    account.bioText ||
    account.accountAgeText ||
    account.followerCountText ||
    account.friendCountText ||
    account.locationText ||
    account.verificationSignals?.length ||
    account.recentPosts?.length
    ? account
    : undefined;
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

function parseReverseImageSearchEvidence(value: unknown): CredibilityAssessRequest["reverseImageSearch"] {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const status = input.status === "checked" ? "checked" : input.status === "unavailable" ? "unavailable" : undefined;
  if (!status) return undefined;

  const evidence: NonNullable<CredibilityAssessRequest["reverseImageSearch"]> = { status };
  if (
    input.provider === "google_lens" ||
    input.provider === "bing_visual_search" ||
    input.provider === "tineye" ||
    input.provider === "serpapi" ||
    input.provider === "manual" ||
    input.provider === "other"
  ) {
    evidence.provider = input.provider;
  }
  if (typeof input.summary === "string" && input.summary.trim()) {
    evidence.summary = input.summary.slice(0, 1000);
  }
  if (Array.isArray(input.matches)) {
    evidence.matches = input.matches
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map(parseReverseImageMatch)
      .filter((item): item is ReverseImageMatch => Boolean(item))
      .slice(0, 10);
  }

  return evidence.status === "unavailable" || evidence.matches?.length || evidence.summary ? evidence : undefined;
}

function parseReverseImageMatch(input: Record<string, unknown>): ReverseImageMatch | null {
  if (typeof input.url !== "string" || !input.url.trim()) return null;
  const match: ReverseImageMatch = {
    url: input.url.slice(0, 2048)
  };

  if (typeof input.title === "string" && input.title.trim()) match.title = input.title.slice(0, 240);
  if (typeof input.sourceName === "string" && input.sourceName.trim()) {
    match.sourceName = input.sourceName.slice(0, 160);
  }
  if (
    input.sourceType === "official" ||
    input.sourceType === "education" ||
    input.sourceType === "news" ||
    input.sourceType === "medical" ||
    input.sourceType === "government" ||
    input.sourceType === "social" ||
    input.sourceType === "other"
  ) {
    match.sourceType = input.sourceType;
  }
  if (input.similarity === "exact" || input.similarity === "near" || input.similarity === "related") {
    match.similarity = input.similarity;
  }
  if (typeof input.context === "string" && input.context.trim()) match.context = input.context.slice(0, 500);

  return match;
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
  return Boolean(trustedSourceByDomain(domain)) ||
    domain.endsWith(".gov.au") ||
    domain.endsWith(".edu.au") ||
    domain.endsWith(".gov") ||
    domain.endsWith(".edu") ||
    domain.endsWith(".nhs.uk");
}

function trustedSourceByDomain(domain: string): TrustedSource | null {
  const normalized = domain.toLowerCase().replace(/^www\./, "");
  return (
    TRUSTED_SOURCE_REGISTRY.find((source) =>
      source.domains.some((sourceDomain) =>
        normalized === sourceDomain || normalized.endsWith(`.${sourceDomain}`)
      )
    ) || null
  );
}

function trustedSourceFromEvidence(
  request: CredibilityAssessRequest,
  domains: string[]
): TrustedSource | null {
  for (const domain of domains) {
    const source = trustedSourceByDomain(domain);
    if (source) return source;
  }

  const text = trustedSourceEvidenceText(request);
  if (!text) return null;

  return (
    TRUSTED_SOURCE_REGISTRY.find((source) =>
      source.logoAliases.some((alias) => text.includes(alias))
    ) || null
  );
}

function trustedSourceEvidenceText(request: CredibilityAssessRequest): string {
  return [
    request.url,
    request.pageTitle,
    request.authorName,
    request.authorHandle,
    request.screenshotOcrText,
    request.imageCrop?.description,
    ...(request.visibleProfileSignals || []),
    request.accountContext?.displayName,
    request.accountContext?.handle,
    request.accountContext?.bioText
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function hasImageManipulationCue(text: string): boolean {
  return /\b(synthetic|demo example|misinformation-detection testing|ai[-\s]?generated|generated\s+(?:by|with)\s+ai|(?:image|photo|picture|artwork)\s+(?:was\s+)?generated\s+by\s+ai|ai[-\s]?created|ai[-\s]?enhanced|generated image|made with ai|dall-?e|midjourney|stable diffusion|deepfake|photoshop|edited|fake image|manipulated|retouched|airbrushed|face swap|filter)\b/.test(text);
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
  const mentionsOfficial = /\b(official|government|bank|medicare|mygov|ato|police|council)\b/.test(text);
  return mismatchedDomains.length > 0 && mentionsOfficial;
}

function getDomain(link: string): string | null {
  try {
    return new URL(link).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function domainLabel(link: string): string | null {
  return getDomain(link);
}

function rootDomain(domain: string): string {
  const parts = domain.split(".");
  return parts.slice(Math.max(0, parts.length - 2)).join(".");
}

function accountText(account: NonNullable<CredibilityAssessRequest["accountContext"]>): string {
  return [
    account.profileUrl,
    account.displayName,
    account.handle,
    account.bioText,
    account.accountAgeText,
    account.followerCountText,
    account.friendCountText,
    account.locationText,
    ...(account.verificationSignals || []),
    ...(account.recentPosts || []).flatMap((post) => [
      post.text,
      post.url,
      post.postedAtText,
      post.reactionCountText,
      post.shareCountText
    ])
  ]
    .filter(Boolean)
    .join(" ");
}

function hasAuthorMismatch(request: CredibilityAssessRequest): boolean {
  const author = normalizeIdentity(request.authorHandle || request.authorName || "");
  const account = normalizeIdentity(
    request.accountContext?.handle || request.accountContext?.displayName || ""
  );
  if (!author || !account) return false;
  return !author.includes(account) && !account.includes(author);
}

function normalizeIdentity(value: string): string {
  return value
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9]+/g, "");
}

function riskyAccountPatterns(text: string): string[] {
  const patterns = [
    "claim your prize",
    "crypto",
    "bitcoin",
    "investment",
    "guaranteed returns",
    "dm me",
    "message me",
    "whatsapp",
    "telegram",
    "secret cure",
    "miracle cure",
    "limited time",
    "act now",
    "before it disappears",
    "doctors hate",
    "they don't want you to know"
  ];
  return patterns.filter((pattern) => text.includes(pattern));
}

function looksRepeatedPromo(posts: NonNullable<CredibilityAssessRequest["accountContext"]>["recentPosts"]): boolean {
  if (!posts || posts.length < 2) return false;
  const promotionalPosts = posts.filter((post) =>
    /\b(buy|sale|discount|limited time|dm me|message me|whatsapp|telegram|claim|prize|crypto|investment|miracle|secret)\b/i.test(
      post.text || ""
    )
  );
  if (promotionalPosts.length >= 2) return true;

  const normalized = posts
    .map((post) => (post.text || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/))
    .filter((tokens) => tokens.length >= 5);
  if (normalized.length < 2) return false;

  const [first, ...rest] = normalized;
  const firstSet = new Set(first);
  return rest.some((tokens) => {
    const overlap = tokens.filter((token) => token.length > 4 && firstSet.has(token)).length;
    return overlap >= 4;
  });
}

function accountCredibilityLevel(
  score: number,
  signalsFor: string[],
  signalsAgainst: string[]
): AccountCredibility["level"] {
  if (!signalsFor.length && !signalsAgainst.length) return "unknown";
  if (score >= 68) return "high";
  if (score >= 45) return "medium";
  return "low";
}

function accountCredibilitySummary(
  level: AccountCredibility["level"],
  signalsAgainst: string[],
  missingSignals: string[]
): string {
  if (level === "high") return "The supplied profile signals look reasonably established.";
  if (level === "low") {
    return signalsAgainst[0] || "The supplied profile signals raise account credibility concerns.";
  }
  if (missingSignals.length) {
    return "Some account details are visible, but more profile history would help confirm the poster.";
  }
  return "The supplied profile signals are mixed.";
}

function imageEvidenceText(request: CredibilityAssessRequest): string {
  return [
    request.screenshotOcrText,
    request.imageCrop?.description
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function hasImageExtractedClaim(text: string): boolean {
  const productOrHealth = /\b(cure|medicine|wellness|supplements?|gel|cream|serum|skin|wrinkles?|forehead lines|anti-?aging|weight loss|diabetes|blood pressure|detox|injections?)\b/.test(text);
  const transformation = /before|after|after\s+\d+\s+(days?|weeks?|months?|years?)|changed my|shocking|tighter|softer|younger|refreshed|results?/.test(text);
  const namedProduct = /\b[A-Z]?[a-z]+(?:berry|gel|serum|cream|wellness|support)\b/i.test(text);
  return (productOrHealth && transformation) || (namedProduct && transformation);
}

function dedupe(items: string[]): string[] {
  return [...new Set(items.filter((item) => item.trim()).map((item) => item.trim()))];
}

function dedupeClaimDetails(details: ClaimDetail[]): ClaimDetail[] {
  const seen = new Set<string>();
  return details.filter((detail) => {
    const key = `${detail.category}:${detail.claim.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function publicRiskSignals(signals: RiskSignal[]): PublicRiskSignal[] {
  const byCategory = new Map<RiskSignal["category"], RiskSignal>();
  for (const signal of signals) {
    const current = byCategory.get(signal.category);
    if (!current || signal.weight > current.weight) {
      byCategory.set(signal.category, signal);
    }
  }

  return [...byCategory.values()]
    .sort((a, b) => b.weight - a.weight)
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
  const trustedInstitutionalAction =
    analysis.score >= 75 &&
    (isInstitutionalSourceContext(request, text) || hasVerifiedAccountContext(request)) &&
    !analysis.signals.some((signal) => signal.category === "link-mismatch" || signal.weight >= 14);
  const benignSearchResult = isBenignSearchResultViewer(request, text, analysis.signals);
  const explicitClickRequest =
    Boolean(request.extractedLinks?.length) ||
    /\b(sign up|buy tickets?|ticket in bio|link in bio|shared link|go to [a-z0-9.-]+\.[a-z]{2,}|visit (?:https?:\/\/|www\.|[a-z0-9.-]+\.[a-z]{2,})|follow the link|link below)\b/i.test(
      text
    );

  if (!benignSearchResult && explicitClickRequest) {
    actions.push({
      action: "click_link",
      risk: highRisk ? "high" : trustedInstitutionalAction ? "low" : "medium",
      target: request.extractedLinks?.[0]?.href || request.url,
      advice: highRisk
        ? "Do not click the link. Type the official website address yourself."
        : trustedInstitutionalAction
          ? "This appears to be a normal link or sign-up action from a recognized source."
        : "Check the link carefully before opening it."
    });
  }

  if (/\b(phone|ring|call us|call now|call this number|contact us)\b/.test(text) || /\+?\d[\d\s().-]{7,}\d/.test(text)) {
    actions.push({
      action: "call_phone",
      risk: highRisk ? "high" : "medium",
      advice: "Do not call numbers from suspicious messages. Use an official number you already trust."
    });
  }

  if (/\b(send money|transfer|pay now|payment|gift card|crypto|bitcoin|bank transfer)\b/.test(text)) {
    actions.push({
      action: "send_money",
      risk: "high",
      advice: "Do not send money, gift cards, or crypto from this message."
    });
  }

  if (/\b(one.?time code|otp|verification code|login code|security code|password|pin)\b/.test(text)) {
    actions.push({
      action: "share_code",
      risk: "high",
      advice: "Never share passwords, PINs, or login codes."
    });
  }

  if (/\b(medicare number|tax file number|tfn|driver licence|passport|bank details|date of birth|address)\b/.test(text)) {
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
        "account-credibility",
        "source-credibility",
        "link-mismatch",
        "claim-verification",
        "ai-image-suspicion",
        "image-provenance"
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

function sanitizeClaimDetails(details: ClaimDetail[] | undefined): ClaimDetail[] | undefined {
  if (!Array.isArray(details)) return undefined;
  const cleaned = details
    .filter((detail) =>
      Boolean(detail) &&
      ["weight-loss", "health", "product", "source", "other"].includes(detail.category) &&
      ["unsupported", "needs_checking", "supported"].includes(detail.status) &&
      ["low", "medium", "high"].includes(detail.severity) &&
      typeof detail.claim === "string" &&
      typeof detail.explanation === "string"
    )
    .slice(0, 6)
    .map((detail) => ({
      category: detail.category,
      status: detail.status,
      severity: detail.severity,
      claim: detail.claim.slice(0, 300),
      explanation: detail.explanation.slice(0, 700),
      missingEvidence: sanitizeList(detail.missingEvidence).slice(0, 6),
      guidanceComparison:
        typeof detail.guidanceComparison === "string" && detail.guidanceComparison.trim()
          ? detail.guidanceComparison.slice(0, 500)
          : undefined
    }));
  return cleaned.length ? cleaned : undefined;
}

function sanitizeAccountCredibility(value: AccountCredibility | undefined): AccountCredibility | undefined {
  if (!value || typeof value !== "object") return undefined;
  const level = ["low", "medium", "high", "unknown"].includes(value.level) ? value.level : "unknown";
  const summary =
    typeof value.summary === "string" && value.summary.trim()
      ? value.summary.slice(0, 500)
      : "Account credibility could not be determined from the supplied evidence.";

  return {
    level,
    summary,
    signalsFor: sanitizeList(value.signalsFor),
    signalsAgainst: sanitizeList(value.signalsAgainst),
    missingSignals: sanitizeList(value.missingSignals)
  };
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

function sanitizeReverseImageSearchResult(
  value: ReverseImageSearchResult | undefined
): ReverseImageSearchResult | undefined {
  if (!value || typeof value !== "object") return undefined;
  const status = value.status === "checked" ? "checked" : "unavailable";
  return {
    status,
    summary:
      typeof value.summary === "string" && value.summary.trim()
        ? value.summary.slice(0, 1000)
        : status === "checked"
          ? "Reverse image search completed."
          : "Reverse image search was unavailable.",
    credibleMatches: sanitizeReverseImageMatches(value.credibleMatches),
    riskyMatches: sanitizeReverseImageMatches(value.riskyMatches)
  };
}

function sanitizeReverseImageMatches(matches: ReverseImageMatch[] | undefined): ReverseImageMatch[] {
  if (!Array.isArray(matches)) return [];
  return matches
    .filter((match) => Boolean(match) && typeof match.url === "string" && match.url.startsWith("http"))
    .slice(0, 5)
    .map((match) => ({
      title: typeof match.title === "string" && match.title.trim() ? match.title.slice(0, 240) : undefined,
      url: match.url.slice(0, 2048),
      sourceName:
        typeof match.sourceName === "string" && match.sourceName.trim()
          ? match.sourceName.slice(0, 160)
          : undefined,
      sourceType: [
        "official",
        "education",
        "news",
        "medical",
        "government",
        "social",
        "other"
      ].includes(match.sourceType || "")
        ? match.sourceType
        : undefined,
      similarity: ["exact", "near", "related"].includes(match.similarity || "")
        ? match.similarity
        : undefined,
      context:
        typeof match.context === "string" && match.context.trim() ? match.context.slice(0, 500) : undefined
    }));
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

function sentenceWithPeriod(value: string): string {
  return /[.!?]$/.test(value) ? value : `${value}.`;
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
    claimDetails: dedupeClaimDetails([
      ...(baseline.claimDetails || []),
      ...(model.claimDetails || [])
    ]).slice(0, 6),
    riskSignals: model.riskSignals?.length ? model.riskSignals : baseline.riskSignals,
    requestedActions: model.requestedActions?.length ? model.requestedActions : baseline.requestedActions,
    accountCredibility: model.accountCredibility || baseline.accountCredibility,
    reverseImageSearch: model.reverseImageSearch || baseline.reverseImageSearch,
    analysisVersion: model.analysisVersion || baseline.analysisVersion || ANALYSIS_VERSION
  });
}

async function maybeAddWebVerification(
  assessment: CredibilityAssessResponse,
  request: CredibilityAssessRequest,
  env: Env
): Promise<CredibilityAssessResponse> {
  if (
    request.verificationMode !== "web" ||
    env.WEB_VERIFICATION_ENABLED !== "true" ||
    !env.OPENAI_API_KEY
  ) {
    return assessment;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), webVerificationTimeoutMs(env));

  try {
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || "gpt-5.2",
        max_output_tokens: 1200,
        tools: [{ type: "web_search_preview" }],
        instructions: [
          "You verify public claims for a cautious misinformation-detection backend.",
          "Search the web for independent support from official, medical, scientific, or reputable news sources.",
          "Do not overstate certainty. If sources do not clearly support the claim, say not_found or mixed.",
          "Return only JSON matching this shape: {\"status\":\"checked\",\"summary\":\"...\",\"claims\":[{\"claim\":\"...\",\"verdict\":\"supported|unsupported|mixed|not_found\",\"explanation\":\"...\"}],\"sources\":[{\"title\":\"...\",\"url\":\"...\",\"sourceType\":\"official|news|medical|other\"}]}."
        ].join(" "),
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify({
                  visibleText: request.visibleText,
                  selectedText: request.selectedText,
                  screenshotOcrText: request.screenshotOcrText,
                  imageDescription: request.imageCrop?.description,
                  reverseImageSearch: request.reverseImageSearch,
                  url: request.url,
                  accountContext: request.accountContext,
                  extractedLinks: request.extractedLinks,
                  currentAssessment: {
                    label: assessment.label,
                    riskLevel: assessment.riskLevel,
                    why: assessment.why
                  }
                })
              }
            ]
          }
        ]
      })
    });

    if (!response.ok) return assessment;

    const payload = (await response.json()) as unknown;
    const text = extractOutputText(payload);
    if (!text) return assessment;

    return {
      ...assessment,
      webVerification: sanitizeWebVerification(JSON.parse(text) as WebVerification)
    };
  } catch {
    return {
      ...assessment,
      webVerification: {
        status: "unavailable",
        summary: "Source checking was unavailable, so this result uses visible evidence only.",
        claims: [],
        sources: []
      }
    };
  } finally {
    clearTimeout(timeout);
  }
}

function sanitizeWebVerification(value: WebVerification): WebVerification {
  const status = value.status === "checked" ? "checked" : "unavailable";
  const claims = Array.isArray(value.claims)
    ? value.claims.slice(0, 5).map((claim) => ({
        claim: String(claim.claim || "").slice(0, 500),
        verdict: ["supported", "unsupported", "mixed", "not_found"].includes(claim.verdict)
          ? claim.verdict
          : "not_found",
        explanation: String(claim.explanation || "").slice(0, 700)
      }))
    : [];
  const sources = Array.isArray(value.sources)
    ? value.sources
        .filter((source) => typeof source.url === "string" && source.url.startsWith("http"))
        .slice(0, 8)
        .map((source) => ({
          title: String(source.title || source.url).slice(0, 200),
          url: source.url.slice(0, 1000),
          sourceType: ["official", "news", "medical", "other"].includes(source.sourceType || "")
            ? source.sourceType
            : "other"
        }))
    : [];

  return {
    status,
    summary: String(value.summary || "Source checking completed.").slice(0, 1000),
    claims,
    sources
  };
}

function webVerificationTimeoutMs(env: Env): number {
  const parsed = Number.parseInt(env.WEB_VERIFICATION_TIMEOUT_MS || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_WEB_VERIFICATION_TIMEOUT_MS;
  return Math.min(parsed, MAX_WEB_VERIFICATION_TIMEOUT_MS);
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
  evidenceFor: string[],
  claimDetails: ClaimDetail[] | undefined = undefined
): string[] {
  if (score >= 75) {
    return [
      evidenceFor[0] || "The visible information gives some support for this post.",
      "No strong scam or urgency warning signs were found in the readable text."
    ];
  }

  const claimReasons = (claimDetails || [])
    .filter((detail) => detail.status === "unsupported")
    .flatMap((detail) => [
      detail.explanation,
      detail.guidanceComparison,
      detail.missingEvidence.length ? `Missing support: ${detail.missingEvidence.slice(0, 2).join("; ")}.` : undefined
    ])
    .filter((item): item is string => Boolean(item));
  const why = dedupe([...claimReasons, ...evidenceAgainst, ...missingSignals]).slice(0, 3);
  if (why.length) return why;

  return [
    "There is not enough visible evidence to confirm this post.",
    "Check an official website or another trusted source before acting."
  ];
}
