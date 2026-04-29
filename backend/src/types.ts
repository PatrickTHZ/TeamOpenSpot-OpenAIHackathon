import type {
  CredibilityAssessRequest,
  CredibilityAssessResponse
} from "../../shared/credibility-contract.ts";

export type { CredibilityAssessRequest, CredibilityAssessResponse };

export interface Env {
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  OPENAI_TIMEOUT_MS?: string;
  OPENAI_ENABLE_VISION?: string;
  MAX_REQUEST_BYTES?: string;
  OCR_ENABLED?: string;
  OCR_ENGINE?: string;
  OCR_LANG?: string;
  OCR_TIMEOUT_MS?: string;
  WEB_VERIFICATION_ENABLED?: string;
  WEB_VERIFICATION_TIMEOUT_MS?: string;
  EVIDENCE_STORAGE_ENABLED?: string;
  EVIDENCE_STORAGE_DIR?: string;
  EVIDENCE_STORE_RAW_TEXT?: string;
  EVIDENCE_HASH_SALT?: string;
  EVIDENCE_ADMIN_TOKEN?: string;
  TRAINING_ACCESS_TOKEN?: string;
  ASSESSMENT_LOG_DETAIL?: string;
  ASSESSMENT_LOG_INPUT?: string;
}
