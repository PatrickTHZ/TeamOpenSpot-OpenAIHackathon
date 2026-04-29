import type {
  CredibilityAssessRequest,
  CredibilityAssessResponse
} from "../../shared/credibility-contract.ts";

export type { CredibilityAssessRequest, CredibilityAssessResponse };

export interface Env {
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
}
