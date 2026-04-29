import {
  bandForScore,
  credibilityResponseJsonSchema,
  labelForScore,
  riskLevelForScore
} from "./contract.ts";
import type {
  CredibilityAssessRequest,
  CredibilityAssessResponse
} from "../../shared/credibility-contract.ts";
import type { Env } from "./types";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const MAX_TEXT_LENGTH = 6000;

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
    "screenshotOcrText",
    "contentType"
  ] as const) {
    const item = input[key];
    if (typeof item === "string" && item.trim()) {
      request[key] = item.slice(0, MAX_TEXT_LENGTH) as never;
    }
  }

  if (Array.isArray(input.visibleProfileSignals)) {
    request.visibleProfileSignals = input.visibleProfileSignals
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .slice(0, 12)
      .map((item) => item.slice(0, 280));
  }

  if (!hasUsefulEvidence(request)) {
    throw new Error("Provide at least visibleText, selectedText, screenshotOcrText, or url.");
  }

  return request;
}

export function hasUsefulEvidence(request: CredibilityAssessRequest): boolean {
  return Boolean(
    request.visibleText?.trim() ||
      request.selectedText?.trim() ||
      request.screenshotOcrText?.trim() ||
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
      "Check the source and look for another reliable report before sharing."
  };
}

export function heuristicAssessment(request: CredibilityAssessRequest): CredibilityAssessResponse {
  const text = [
    request.pageTitle,
    request.selectedText,
    request.visibleText,
    request.screenshotOcrText
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  let score = 55;
  const evidenceFor: string[] = [];
  const evidenceAgainst: string[] = [];
  const missingSignals: string[] = [];

  if (request.url) {
    evidenceFor.push("A link or page address is available for checking.");
    score += 5;
  } else {
    missingSignals.push("No source link is visible.");
    score -= 8;
  }

  if (request.authorName || request.authorHandle) {
    evidenceFor.push("A visible author or account name is present.");
    score += 4;
  } else {
    missingSignals.push("No clear author or account name is visible.");
    score -= 8;
  }

  if (request.visibleProfileSignals?.length) {
    evidenceFor.push("Some visible profile or account signals were captured.");
    score += 4;
  } else {
    missingSignals.push("No account age, verification, or profile history is visible.");
  }

  const riskyPhrases = [
    "shocking",
    "they don't want you to know",
    "secret cure",
    "guaranteed",
    "urgent share",
    "breaking!!!",
    "100% true"
  ];
  const matchedRisk = riskyPhrases.filter((phrase) => text.includes(phrase));
  if (matchedRisk.length) {
    evidenceAgainst.push("The wording uses urgency or sensational claims.");
    score -= 18;
  }

  if (request.contentType === "reel") {
    missingSignals.push("Video and audio content were not fully analyzed in this prototype.");
    score -= 5;
  }

  if (text.length < 80) {
    missingSignals.push("There is not much readable text to assess.");
    score -= 10;
  }

  return normalizeAssessment({
    score,
    band: bandForScore(score),
    riskLevel: riskLevelForScore(score),
    label: labelForScore(score, "low"),
    confidence: "low",
    plainLanguageSummary:
      "This is a basic estimate from visible evidence only. Use it as a prompt to double-check before trusting or sharing.",
    why: buildWhy(score, evidenceAgainst, missingSignals, evidenceFor),
    advice:
      score >= 75
        ? "It looks safer, but still read the full source before sharing."
        : score >= 50
          ? "Check another reliable source or ask someone you trust before sharing."
          : "Do not click the link or share yet. Check the official website or ask someone you trust.",
    evidenceFor,
    evidenceAgainst,
    missingSignals,
    recommendedAction:
      score >= 75
        ? "Still read the full source before sharing."
        : score >= 50
          ? "Look for another reliable source before sharing."
          : "Do not share yet. Check a trusted source first."
  });
}

export async function assessCredibility(
  request: CredibilityAssessRequest,
  env: Env
): Promise<CredibilityAssessResponse> {
  if (!env.OPENAI_API_KEY) {
    return heuristicAssessment(request);
  }

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-5",
      instructions: [
        "You are a careful credibility assistant for elderly users.",
        "Estimate credibility from only the supplied public/visible evidence.",
        "Do not claim to verify private account creation dates unless they are supplied.",
        "Do not present the score as a final fact-check verdict.",
        "Keep the summary plain, calm, and short."
      ].join(" "),
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify(request)
            }
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

  return normalizeAssessment(JSON.parse(text) as CredibilityAssessResponse);
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
