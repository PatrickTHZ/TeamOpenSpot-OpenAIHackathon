import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { API_VERSION, assessSchema, publicRuntimeConfig } from "./api-metadata.ts";
import { landingPageHtml } from "./landing-page.ts";
import {
  assessCredibility,
  heuristicAssessment,
  validateAssessRequest
} from "./scoring.ts";
import { enrichWithOcr } from "./selfhost-ocr.ts";
import {
  canStoreEvidence,
  hasTrainingAccess,
  listEvidence,
  readEvidence,
  readEvidenceImage,
  storeEvidence
} from "./selfhost-storage.ts";

interface SelfHostEnv {
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

const port = Number.parseInt(process.env.PORT || "5072", 10);
const host = process.env.HOST || "0.0.0.0";
const maxRequestBytes = Number.parseInt(process.env.MAX_REQUEST_BYTES || "3500000", 10);

const corsHeaders = {
  "Access-Control-Allow-Origin": process.env.CORS_ORIGIN || "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400"
};

const env: SelfHostEnv = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_MODEL: process.env.OPENAI_MODEL || "gpt-5.2",
  OPENAI_TIMEOUT_MS: process.env.OPENAI_TIMEOUT_MS,
  OPENAI_ENABLE_VISION: process.env.OPENAI_ENABLE_VISION,
  MAX_REQUEST_BYTES: process.env.MAX_REQUEST_BYTES,
  OCR_ENABLED: process.env.OCR_ENABLED,
  OCR_ENGINE: process.env.OCR_ENGINE,
  OCR_LANG: process.env.OCR_LANG,
  OCR_TIMEOUT_MS: process.env.OCR_TIMEOUT_MS,
  WEB_VERIFICATION_ENABLED: process.env.WEB_VERIFICATION_ENABLED,
  WEB_VERIFICATION_TIMEOUT_MS: process.env.WEB_VERIFICATION_TIMEOUT_MS,
  EVIDENCE_STORAGE_ENABLED: process.env.EVIDENCE_STORAGE_ENABLED,
  EVIDENCE_STORAGE_DIR: process.env.EVIDENCE_STORAGE_DIR,
  EVIDENCE_STORE_RAW_TEXT: process.env.EVIDENCE_STORE_RAW_TEXT,
  EVIDENCE_HASH_SALT: process.env.EVIDENCE_HASH_SALT,
  EVIDENCE_ADMIN_TOKEN: process.env.EVIDENCE_ADMIN_TOKEN,
  TRAINING_ACCESS_TOKEN: process.env.TRAINING_ACCESS_TOKEN,
  ASSESSMENT_LOG_DETAIL: process.env.ASSESSMENT_LOG_DETAIL,
  ASSESSMENT_LOG_INPUT: process.env.ASSESSMENT_LOG_INPUT
};

const server = createServer(async (request, response) => {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();

  try {
    if (request.method === "OPTIONS") {
      writeJson(response, 204, null, requestId);
      return;
    }

    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (request.method === "GET" && url.pathname === "/") {
      writeHtml(response, 200, landingPageHtml());
      return;
    }

    if (request.method === "GET" && url.pathname === "/health") {
      writeJson(response, 200, {
        ok: true,
        service: "trustlens-backend",
        apiVersion: API_VERSION,
        endpoints: ["/", "/v1/assess", "/v1/schema", "/v1/evidence"],
        config: publicRuntimeConfig(env)
      }, requestId);
      return;
    }

    if (request.method === "GET" && url.pathname === "/v1/schema") {
      writeJson(response, 200, {
        ...assessSchema(),
        config: publicRuntimeConfig(env)
      }, requestId);
      return;
    }

    if (request.method === "GET" && url.pathname === "/v1/evidence") {
      if (!hasTrainingAccess(request.headers.authorization, env)) {
        writeJson(response, 401, { error: "Training access token required.", requestId }, requestId);
        return;
      }
      writeJson(response, 200, { items: await listEvidence(env) }, requestId);
      return;
    }

    const evidenceMatch = url.pathname.match(/^\/v1\/evidence\/([^/]+)(?:\/(?:image|crop))?$/);
    if (request.method === "GET" && evidenceMatch) {
      if (!hasTrainingAccess(request.headers.authorization, env)) {
        writeJson(response, 401, { error: "Training access token required.", requestId }, requestId);
        return;
      }

      if (url.pathname.endsWith("/image")) {
        const image = await readEvidenceImage(evidenceMatch[1], env);
        if (!image) {
          writeJson(response, 404, { error: "Image not found.", requestId }, requestId);
          return;
        }
        writeBytes(response, 200, image.bytes, image.contentType);
        return;
      }

      const evidence = await readEvidence(evidenceMatch[1], env);
      writeJson(response, evidence ? 200 : 404, evidence || { error: "Evidence not found.", requestId }, requestId);
      return;
    }

    if (request.method !== "POST" || url.pathname !== "/v1/assess") {
      writeJson(response, 404, { error: "Not found", requestId }, requestId);
      return;
    }

    if (!request.headers["content-type"]?.toLowerCase().includes("application/json")) {
      writeJson(response, 400, { error: "Content-Type must be application/json.", requestId }, requestId);
      return;
    }

    const contentLength = Number.parseInt(request.headers["content-length"] || "0", 10);
    if (contentLength > maxRequestBytes) {
      writeJson(response, 413, { error: "Request body too large.", requestId }, requestId);
      return;
    }

    const body = await readJsonBody(request, maxRequestBytes);
    let assessmentRequest = validateAssessRequest(body);
    const ocr = await enrichWithOcr(assessmentRequest, env);
    assessmentRequest = ocr.request;
    let assessment: Awaited<ReturnType<typeof assessCredibility>>;

    try {
      assessment = await assessCredibility(assessmentRequest, env);
    } catch {
      assessment = heuristicAssessment(assessmentRequest);
    }

    let evidenceStorage: "skipped" | "saved" | "failed" = "skipped";
    if (canStoreEvidence(assessmentRequest, env)) {
      try {
        const storage = await storeEvidence(assessmentRequest, assessment, env);
        assessment = {
          ...assessment,
          ...storage
        };
        evidenceStorage = "saved";
      } catch {
        evidenceStorage = "failed";
      }
    }

    logAssessmentResult({
      requestId,
      startedAt,
      request: assessmentRequest,
      assessment,
      ocrEngine: ocr.ocr ? "tesseract" : "skipped",
      evidenceStorage,
      env
    });

    writeJson(response, 200, assessment, requestId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.log(
      JSON.stringify({
        event: "assessment_error",
        requestId,
        latencyMs: Date.now() - startedAt,
        status: "error",
        errorCategory: "selfhost",
        errorMessage: message
      })
    );
    const status = message.includes("Provide at least") ||
      message.includes("Content-Type") ||
      message.includes("JSON") ||
      message.includes("imageCrop")
      ? 400
      : message.includes("too large")
        ? 413
        : 500;
    writeJson(response, status, {
      error: message,
      requestId
    }, requestId);
  }
});

server.listen(port, host, () => {
  console.log(`TrustLens backend listening on http://${host}:${port}`);
});

function writeJson(response: ServerResponse, status: number, value: unknown, requestId?: string): void {
  response.writeHead(status, {
    ...corsHeaders,
    ...(requestId ? { "X-Request-Id": requestId } : {}),
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  });
  response.end(value === null ? "" : JSON.stringify(value));
}

function writeHtml(response: ServerResponse, status: number, value: string): void {
  response.writeHead(status, {
    ...corsHeaders,
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "public, max-age=300"
  });
  response.end(value);
}

function writeBytes(response: ServerResponse, status: number, value: Buffer, contentType: string): void {
  response.writeHead(status, {
    ...corsHeaders,
    "Content-Type": contentType,
    "Cache-Control": "private, no-store"
  });
  response.end(value);
}

function logAssessmentResult(input: {
  requestId: string;
  startedAt: number;
  request: ReturnType<typeof validateAssessRequest>;
  assessment: Awaited<ReturnType<typeof assessCredibility>>;
  ocrEngine: "tesseract" | "skipped";
  evidenceStorage: "skipped" | "saved" | "failed";
  env: SelfHostEnv;
}): void {
  const detail = input.env.ASSESSMENT_LOG_DETAIL || "summary";
  if (detail === "off") return;

  const request = input.request;
  const assessment = input.assessment;
  const inputLog = buildInputLog(request, input.env);
  const base = {
    event: "assessment_result",
    requestId: input.requestId,
    latencyMs: Date.now() - input.startedAt,
    status: "ok",
    client: request.client,
    contentType: request.contentType || "unknown",
    verificationMode: request.verificationMode || "fast",
    sourceHost: safeHost(request.url),
    evidence: {
      hasUrl: Boolean(request.url),
      hasVisibleText: Boolean(request.visibleText),
      hasSelectedText: Boolean(request.selectedText),
      hasScreenshotOcrText: Boolean(request.screenshotOcrText),
      linkCount: request.extractedLinks?.length || 0,
      hasImageData: Boolean(request.imageCrop?.dataUrl),
      hasImageDescription: Boolean(request.imageCrop?.description),
      reverseImageSearch: request.reverseImageSearch?.status || "not_supplied",
      reverseImageMatchCount: request.reverseImageSearch?.matches?.length || 0,
      accountContext: Boolean(request.accountContext)
    },
    result: {
      score: assessment.score,
      band: assessment.band,
      riskLevel: assessment.riskLevel,
      label: assessment.label,
      confidence: assessment.confidence,
      plainLanguageSummary: assessment.plainLanguageSummary,
      recommendedAction: assessment.recommendedAction
    },
    processing: {
      openAiConfigured: Boolean(input.env.OPENAI_API_KEY),
      model: input.env.OPENAI_MODEL || "gpt-5.2",
      visionEnabled: input.env.OPENAI_ENABLE_VISION === "true",
      ocr: input.ocrEngine,
      evidenceStorage: input.evidenceStorage
    },
    errorCategory: null
  };

  if (detail === "debug") {
    console.log(
      JSON.stringify({
        ...base,
        input: inputLog,
        why: assessment.why,
        advice: assessment.advice,
        claimDetails: assessment.claimDetails,
        evidenceAgainst: assessment.evidenceAgainst,
        missingSignals: assessment.missingSignals,
        riskSignals: assessment.riskSignals,
        requestedActions: assessment.requestedActions,
        accountCredibility: assessment.accountCredibility,
        reverseImageSearch: assessment.reverseImageSearch
      })
    );
    return;
  }

  console.log(
    JSON.stringify({
      ...base,
      input: inputLog,
      why: assessment.why,
      advice: assessment.advice,
      claimDetails: assessment.claimDetails?.map((detail) => ({
        category: detail.category,
        status: detail.status,
        severity: detail.severity,
        claim: detail.claim,
        explanation: detail.explanation,
        guidanceComparison: detail.guidanceComparison
      })),
      riskSignals: assessment.riskSignals?.map((signal) => ({
        category: signal.category,
        severity: signal.severity,
        message: signal.message
      })),
      reverseImageSearch: assessment.reverseImageSearch
    })
  );
}

function buildInputLog(
  request: ReturnType<typeof validateAssessRequest>,
  env: SelfHostEnv
): Record<string, unknown> | undefined {
  const mode = env.ASSESSMENT_LOG_INPUT || "preview";
  if (mode === "off") return undefined;
  const limit = mode === "full" ? 6000 : 500;

  return {
    mode,
    url: request.url,
    pageTitle: textForLog(request.pageTitle, limit),
    authorName: textForLog(request.authorName, limit),
    authorHandle: textForLog(request.authorHandle, limit),
    locale: request.locale,
    contentType: request.contentType,
    visibleText: textForLog(request.visibleText, limit),
    selectedText: textForLog(request.selectedText, limit),
    screenshotOcrText: textForLog(request.screenshotOcrText, limit),
    visibleProfileSignals: request.visibleProfileSignals?.map((item) => textForLog(item, limit)),
    extractedLinks: request.extractedLinks?.map((link) => ({
      text: textForLog(link.text, limit),
      href: link.href,
      source: link.source,
      host: safeHost(link.href)
    })),
    imageCrop: request.imageCrop
      ? {
          mediaType: request.imageCrop.mediaType,
          hasDataUrl: Boolean(request.imageCrop.dataUrl),
          dataUrlBytesApprox: request.imageCrop.dataUrl ? Math.round(request.imageCrop.dataUrl.length * 0.75) : 0,
          description: textForLog(request.imageCrop.description, limit),
          crop: request.imageCrop.crop
      }
      : undefined,
    reverseImageSearch: request.reverseImageSearch
      ? {
          status: request.reverseImageSearch.status,
          provider: request.reverseImageSearch.provider,
          summary: textForLog(request.reverseImageSearch.summary, limit),
          matches: request.reverseImageSearch.matches?.map((match) => ({
            title: textForLog(match.title, limit),
            url: match.url,
            host: safeHost(match.url),
            sourceName: textForLog(match.sourceName, limit),
            sourceType: match.sourceType,
            similarity: match.similarity,
            context: textForLog(match.context, limit)
          }))
        }
      : undefined,
    accountContext: request.accountContext
      ? {
          profileUrl: request.accountContext.profileUrl,
          displayName: textForLog(request.accountContext.displayName, limit),
          handle: textForLog(request.accountContext.handle, limit),
          bioText: textForLog(request.accountContext.bioText, limit),
          accountAgeText: textForLog(request.accountContext.accountAgeText, limit),
          followerCountText: textForLog(request.accountContext.followerCountText, limit),
          friendCountText: textForLog(request.accountContext.friendCountText, limit),
          locationText: textForLog(request.accountContext.locationText, limit),
          verificationSignals: request.accountContext.verificationSignals?.map((item) => textForLog(item, limit)),
          recentPosts: request.accountContext.recentPosts?.map((post) => ({
            text: textForLog(post.text, limit),
            url: post.url,
            postedAtText: textForLog(post.postedAtText, limit),
            reactionCountText: textForLog(post.reactionCountText, limit),
            shareCountText: textForLog(post.shareCountText, limit)
          }))
        }
      : undefined,
    consentToStoreEvidence: request.consentToStoreEvidence === true,
    consentLabel: textForLog(request.consentLabel, limit),
    verificationMode: request.verificationMode || "fast"
  };
}

function textForLog(value: string | undefined, limit: number): string | undefined {
  if (!value) return undefined;
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}...[truncated ${value.length - limit} chars]`;
}

function safeHost(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

async function readJsonBody(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBytes) {
      throw new Error("Request body too large.");
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) {
    throw new Error("Request body must be a JSON object.");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Request body must contain valid JSON.");
  }
}

