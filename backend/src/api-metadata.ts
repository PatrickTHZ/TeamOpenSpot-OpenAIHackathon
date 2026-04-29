import type { Env } from "./types";

export const API_VERSION = "2026-04-29.2";

export function publicRuntimeConfig(
  env: Pick<
    Env,
    | "OPENAI_TIMEOUT_MS"
    | "OPENAI_ENABLE_VISION"
    | "MAX_REQUEST_BYTES"
    | "OCR_ENABLED"
    | "OCR_ENGINE"
    | "OCR_TIMEOUT_MS"
    | "EVIDENCE_STORAGE_ENABLED"
  >
) {
  return {
    apiVersion: API_VERSION,
    openAiTimeoutMs: Number.parseInt(env.OPENAI_TIMEOUT_MS || "2500", 10),
    openAiVisionEnabled: env.OPENAI_ENABLE_VISION === "true",
    maxRequestBytes: Number.parseInt(env.MAX_REQUEST_BYTES || "3500000", 10),
    ocrEnabled: env.OCR_ENABLED === "true",
    ocrEngine: env.OCR_ENGINE || "tesseract",
    ocrTimeoutMs: Number.parseInt(env.OCR_TIMEOUT_MS || "3000", 10),
    evidenceStorageEnabled: env.EVIDENCE_STORAGE_ENABLED === "true"
  };
}

export function assessSchema() {
  return {
    endpoint: "POST /v1/assess",
    required: {
      client: "'android' or 'chrome'",
      evidence: "At least one of url, visibleText, selectedText, screenshotOcrText, extractedLinks, or imageCrop"
    },
    inputs: {
      client: "android | chrome",
      url: "Source/page URL",
      pageTitle: "Visible page title",
      visibleText: "Visible post/page text",
      selectedText: "User-selected text",
      screenshotOcrText: "OCR text from screenshot or image crop",
      authorName: "Visible source/account name",
      authorHandle: "Visible source/account handle",
      visibleProfileSignals: "Array of visible account/source signals",
      extractedLinks: "Array of { text?, href, source? }",
      imageCrop: "Optional { dataUrl?, mediaType?, description?, crop? }",
      contentType: "post | article | reel | unknown",
      locale: "BCP-47 locale hint, for example en-AU",
      consentToStoreEvidence: "true only when user agrees to training/QA storage",
      consentLabel: "Short consent/audit label"
    },
    outputs: {
      score: "0-100 credibility score",
      band: "green | yellow | red",
      riskLevel: "low | medium | high | unknown",
      label: "Likely safe | Needs checking | Suspicious | Cannot verify",
      confidence: "low | medium | high",
      plainLanguageSummary: "Short summary",
      why: "1-4 explanation bullets",
      advice: "Elderly-friendly next step",
      evidenceFor: "Supporting signals",
      evidenceAgainst: "Risk signals",
      missingSignals: "Evidence gaps",
      recommendedAction: "Short action CTA",
      riskSignals: "Category-level risk trace for frontend/debug use",
      requestedActions: "Detected actions the content asks the user to take",
      analysisVersion: "Version of deterministic risk rules",
      evidenceId: "Only present when opt-in storage succeeds",
      storedEvidenceUrl: "Only present when opt-in storage succeeds"
    }
  };
}
