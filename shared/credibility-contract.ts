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
  accountContext?: AccountContext;
  selectedText?: string;
  locale?: string;
  screenshotOcrText?: string;
  extractedLinks?: LinkEvidence[];
  imageCrop?: ImageCropEvidence;
  reverseImageSearch?: ReverseImageSearchEvidence;
  consentToStoreEvidence?: boolean;
  consentLabel?: string;
  verificationMode?: "fast" | "web";
  contentType?: "post" | "article" | "reel" | "unknown";
}

export interface LinkEvidence {
  text?: string;
  href: string;
  source?: "visible" | "ocr" | "dom" | "manual";
}

export interface ImageCropEvidence {
  dataUrl?: string;
  mediaType?: "image/png" | "image/jpeg" | "image/webp";
  description?: string;
  crop?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface ReverseImageSearchEvidence {
  status: "checked" | "unavailable";
  provider?: "google_lens" | "bing_visual_search" | "tineye" | "serpapi" | "manual" | "other";
  summary?: string;
  matches?: ReverseImageMatch[];
}

export interface ReverseImageMatch {
  title?: string;
  url: string;
  sourceName?: string;
  sourceType?: "official" | "education" | "news" | "medical" | "government" | "social" | "other";
  similarity?: "exact" | "near" | "related";
  context?: string;
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
  claimDetails?: ClaimDetail[];
  recommendedAction: string;
  riskSignals?: PublicRiskSignal[];
  requestedActions?: RequestedAction[];
  accountCredibility?: AccountCredibility;
  analysisVersion?: string;
  reverseImageSearch?: ReverseImageSearchResult;
  webVerification?: WebVerification;
  evidenceId?: string;
  storedEvidenceUrl?: string;
}

export interface PublicRiskSignal {
  category:
    | "scam-language"
    | "account-credibility"
    | "source-credibility"
    | "link-mismatch"
    | "claim-verification"
    | "ai-image-suspicion"
    | "image-provenance";
  severity: "low" | "medium" | "high";
  message: string;
}

export interface ClaimDetail {
  category: "weight-loss" | "health" | "product" | "source" | "other";
  status: "unsupported" | "needs_checking" | "supported";
  severity: "low" | "medium" | "high";
  claim: string;
  explanation: string;
  missingEvidence: string[];
  guidanceComparison?: string;
  sourceReferences?: ClaimSourceReference[];
}

export interface ClaimSourceReference {
  title: string;
  url: string;
  sourceType: "official" | "medical" | "government" | "food-safety" | "other";
  relevance: string;
}

export interface AccountContext {
  profileUrl?: string;
  displayName?: string;
  handle?: string;
  bioText?: string;
  accountAgeText?: string;
  followerCountText?: string;
  friendCountText?: string;
  locationText?: string;
  verificationSignals?: string[];
  recentPosts?: AccountPostEvidence[];
}

export interface AccountPostEvidence {
  text?: string;
  url?: string;
  postedAtText?: string;
  reactionCountText?: string;
  shareCountText?: string;
}

export interface AccountCredibility {
  level: "low" | "medium" | "high" | "unknown";
  summary: string;
  signalsFor: string[];
  signalsAgainst: string[];
  missingSignals: string[];
}

export interface RequestedAction {
  action:
    | "click_link"
    | "call_phone"
    | "send_money"
    | "share_code"
    | "share_personal_info"
    | "download_file"
    | "reply_message";
  risk: "low" | "medium" | "high";
  target?: string;
  advice: string;
}

export interface WebVerification {
  status: "checked" | "unavailable";
  summary: string;
  claims: VerifiedClaim[];
  sources: VerificationSource[];
}

export interface ReverseImageSearchResult {
  status: "checked" | "unavailable";
  summary: string;
  credibleMatches: ReverseImageMatch[];
  riskyMatches: ReverseImageMatch[];
}

export interface VerifiedClaim {
  claim: string;
  verdict: "supported" | "unsupported" | "mixed" | "not_found";
  explanation: string;
}

export interface VerificationSource {
  title: string;
  url: string;
  sourceType?: "official" | "news" | "medical" | "other";
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
    claimDetails: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["category", "status", "severity", "claim", "explanation", "missingEvidence"],
        properties: {
          category: { type: "string", enum: ["weight-loss", "health", "product", "source", "other"] },
          status: { type: "string", enum: ["unsupported", "needs_checking", "supported"] },
          severity: { type: "string", enum: ["low", "medium", "high"] },
          claim: { type: "string" },
          explanation: { type: "string" },
          missingEvidence: { type: "array", items: { type: "string" }, maxItems: 6 },
          guidanceComparison: { type: "string" },
          sourceReferences: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["title", "url", "sourceType", "relevance"],
              properties: {
                title: { type: "string" },
                url: { type: "string" },
                sourceType: {
                  type: "string",
                  enum: ["official", "medical", "government", "food-safety", "other"]
                },
                relevance: { type: "string" }
              }
            },
            maxItems: 5
          }
        }
      },
      maxItems: 6
    },
    recommendedAction: { type: "string", minLength: 1 },
    riskSignals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["category", "severity", "message"],
        properties: {
          category: {
            type: "string",
            enum: [
              "scam-language",
              "account-credibility",
              "source-credibility",
              "link-mismatch",
              "claim-verification",
              "ai-image-suspicion",
              "image-provenance"
            ]
          },
          severity: { type: "string", enum: ["low", "medium", "high"] },
          message: { type: "string" }
        }
      },
      maxItems: 8
    },
    requestedActions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["action", "risk", "advice"],
        properties: {
          action: {
            type: "string",
            enum: [
              "click_link",
              "call_phone",
              "send_money",
              "share_code",
              "share_personal_info",
              "download_file",
              "reply_message"
            ]
          },
          risk: { type: "string", enum: ["low", "medium", "high"] },
          target: { type: "string" },
          advice: { type: "string" }
        }
      },
      maxItems: 6
    },
    accountCredibility: {
      type: "object",
      additionalProperties: false,
      required: ["level", "summary", "signalsFor", "signalsAgainst", "missingSignals"],
      properties: {
        level: { type: "string", enum: ["low", "medium", "high", "unknown"] },
        summary: { type: "string" },
        signalsFor: { type: "array", items: { type: "string" }, maxItems: 6 },
        signalsAgainst: { type: "array", items: { type: "string" }, maxItems: 6 },
        missingSignals: { type: "array", items: { type: "string" }, maxItems: 6 }
      }
    },
    analysisVersion: { type: "string" },
    reverseImageSearch: {
      type: "object",
      additionalProperties: false,
      required: ["status", "summary", "credibleMatches", "riskyMatches"],
      properties: {
        status: { type: "string", enum: ["checked", "unavailable"] },
        summary: { type: "string" },
        credibleMatches: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["url"],
            properties: {
              title: { type: "string" },
              url: { type: "string" },
              sourceName: { type: "string" },
              sourceType: {
                type: "string",
                enum: ["official", "education", "news", "medical", "government", "social", "other"]
              },
              similarity: { type: "string", enum: ["exact", "near", "related"] },
              context: { type: "string" }
            }
          },
          maxItems: 5
        },
        riskyMatches: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["url"],
            properties: {
              title: { type: "string" },
              url: { type: "string" },
              sourceName: { type: "string" },
              sourceType: {
                type: "string",
                enum: ["official", "education", "news", "medical", "government", "social", "other"]
              },
              similarity: { type: "string", enum: ["exact", "near", "related"] },
              context: { type: "string" }
            }
          },
          maxItems: 5
        }
      }
    },
    webVerification: {
      type: "object",
      additionalProperties: false,
      required: ["status", "summary", "claims", "sources"],
      properties: {
        status: { type: "string", enum: ["checked", "unavailable"] },
        summary: { type: "string" },
        claims: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["claim", "verdict", "explanation"],
            properties: {
              claim: { type: "string" },
              verdict: { type: "string", enum: ["supported", "unsupported", "mixed", "not_found"] },
              explanation: { type: "string" }
            }
          },
          maxItems: 5
        },
        sources: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["title", "url"],
            properties: {
              title: { type: "string" },
              url: { type: "string" },
              sourceType: { type: "string", enum: ["official", "news", "medical", "other"] }
            }
          },
          maxItems: 8
        }
      }
    },
    evidenceId: { type: "string" },
    storedEvidenceUrl: { type: "string" }
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
