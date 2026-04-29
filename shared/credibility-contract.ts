export type CredibilityClient = "android" | "chrome";
export type CredibilityBand = "green" | "yellow" | "red";
export type CredibilityConfidence = "low" | "medium" | "high";

export interface CredibilityAssessRequest {
  client: CredibilityClient;
  url?: string;
  pageTitle?: string;
  visibleText?: string;
  authorName?: string;
  authorHandle?: string;
  visibleProfileSignals?: string[];
  selectedText?: string;
  locale?: string;
  screenshotOcrText?: string;
  contentType?: "post" | "article" | "reel" | "unknown";
}

export interface CredibilityAssessResponse {
  score: number;
  band: CredibilityBand;
  confidence: CredibilityConfidence;
  plainLanguageSummary: string;
  evidenceFor: string[];
  evidenceAgainst: string[];
  missingSignals: string[];
  recommendedAction: string;
}

export const credibilityResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "score",
    "band",
    "confidence",
    "plainLanguageSummary",
    "evidenceFor",
    "evidenceAgainst",
    "missingSignals",
    "recommendedAction"
  ],
  properties: {
    score: { type: "integer", minimum: 0, maximum: 100 },
    band: { type: "string", enum: ["green", "yellow", "red"] },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    plainLanguageSummary: { type: "string", minLength: 1 },
    evidenceFor: {
      type: "array",
      items: { type: "string" },
      maxItems: 6
    },
    evidenceAgainst: {
      type: "array",
      items: { type: "string" },
      maxItems: 6
    },
    missingSignals: {
      type: "array",
      items: { type: "string" },
      maxItems: 6
    },
    recommendedAction: { type: "string", minLength: 1 }
  }
} as const;

export function bandForScore(score: number): CredibilityBand {
  if (score >= 75) return "green";
  if (score >= 50) return "yellow";
  return "red";
}

