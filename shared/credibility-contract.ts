export type CredibilityClient = "android" | "chrome";
export type CredibilityBand = "green" | "yellow" | "red";
export type CredibilityConfidence = "low" | "medium" | "high";
export type CredibilityRiskLevel = "low" | "medium" | "high" | "unknown";
export type CredibilityLabel =
  | "Likely safe"
  | "Needs checking"
  | "Suspicious"
  | "Cannot verify";

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
  riskLevel: CredibilityRiskLevel;
  label: CredibilityLabel;
  confidence: CredibilityConfidence;
  plainLanguageSummary: string;
  why: string[];
  advice: string;
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
    "riskLevel",
    "label",
    "confidence",
    "plainLanguageSummary",
    "why",
    "advice",
    "evidenceFor",
    "evidenceAgainst",
    "missingSignals",
    "recommendedAction"
  ],
  properties: {
    score: { type: "integer", minimum: 0, maximum: 100 },
    band: { type: "string", enum: ["green", "yellow", "red"] },
    riskLevel: { type: "string", enum: ["low", "medium", "high", "unknown"] },
    label: {
      type: "string",
      enum: ["Likely safe", "Needs checking", "Suspicious", "Cannot verify"]
    },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    plainLanguageSummary: { type: "string", minLength: 1 },
    why: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 4
    },
    advice: { type: "string", minLength: 1 },
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

export function riskLevelForScore(score: number): CredibilityRiskLevel {
  if (score >= 75) return "low";
  if (score >= 50) return "medium";
  return "high";
}

export function labelForScore(score: number, confidence: CredibilityConfidence): CredibilityLabel {
  if (confidence === "low" && score >= 50 && score < 75) return "Cannot verify";
  if (score >= 75) return "Likely safe";
  if (score >= 50) return "Needs checking";
  return "Suspicious";
}
