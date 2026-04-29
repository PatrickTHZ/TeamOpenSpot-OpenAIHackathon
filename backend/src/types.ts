import type {
  CredibilityAssessRequest,
  CredibilityAssessResponse
} from "../../shared/credibility-contract";

export type { CredibilityAssessRequest, CredibilityAssessResponse };

export interface Env {
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
}

