import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
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
  EVIDENCE_STORAGE_ENABLED?: string;
  EVIDENCE_STORAGE_DIR?: string;
  EVIDENCE_STORE_RAW_TEXT?: string;
  EVIDENCE_HASH_SALT?: string;
  EVIDENCE_ADMIN_TOKEN?: string;
  TRAINING_ACCESS_TOKEN?: string;
}

type ScoringModule = typeof import("./scoring.ts");

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
  OPENAI_MODEL: process.env.OPENAI_MODEL || "gpt-5",
  OPENAI_TIMEOUT_MS: process.env.OPENAI_TIMEOUT_MS,
  OPENAI_ENABLE_VISION: process.env.OPENAI_ENABLE_VISION,
  EVIDENCE_STORAGE_ENABLED: process.env.EVIDENCE_STORAGE_ENABLED,
  EVIDENCE_STORAGE_DIR: process.env.EVIDENCE_STORAGE_DIR,
  EVIDENCE_STORE_RAW_TEXT: process.env.EVIDENCE_STORE_RAW_TEXT,
  EVIDENCE_HASH_SALT: process.env.EVIDENCE_HASH_SALT,
  EVIDENCE_ADMIN_TOKEN: process.env.EVIDENCE_ADMIN_TOKEN,
  TRAINING_ACCESS_TOKEN: process.env.TRAINING_ACCESS_TOKEN
};

const server = createServer(async (request, response) => {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();

  try {
    if (request.method === "OPTIONS") {
      writeJson(response, 204, null);
      return;
    }

    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (request.method === "GET" && url.pathname === "/health") {
      writeJson(response, 200, {
        ok: true,
        service: "trustlens-backend",
        endpoints: ["/v1/assess", "/v1/evidence"]
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/v1/evidence") {
      if (!hasTrainingAccess(request.headers.authorization, env)) {
        writeJson(response, 401, { error: "Training access token required.", requestId });
        return;
      }
      writeJson(response, 200, { items: await listEvidence(env) });
      return;
    }

    const evidenceMatch = url.pathname.match(/^\/v1\/evidence\/([^/]+)(?:\/(?:image|crop))?$/);
    if (request.method === "GET" && evidenceMatch) {
      if (!hasTrainingAccess(request.headers.authorization, env)) {
        writeJson(response, 401, { error: "Training access token required.", requestId });
        return;
      }

      if (url.pathname.endsWith("/image")) {
        const image = await readEvidenceImage(evidenceMatch[1], env);
        if (!image) {
          writeJson(response, 404, { error: "Image not found.", requestId });
          return;
        }
        writeBytes(response, 200, image.bytes, image.contentType);
        return;
      }

      const evidence = await readEvidence(evidenceMatch[1], env);
      writeJson(response, evidence ? 200 : 404, evidence || { error: "Evidence not found.", requestId });
      return;
    }

    if (request.method !== "POST" || url.pathname !== "/v1/assess") {
      writeJson(response, 404, { error: "Not found", requestId });
      return;
    }

    if (!request.headers["content-type"]?.toLowerCase().includes("application/json")) {
      writeJson(response, 400, { error: "Content-Type must be application/json.", requestId });
      return;
    }

    const contentLength = Number.parseInt(request.headers["content-length"] || "0", 10);
    if (contentLength > maxRequestBytes) {
      writeJson(response, 413, { error: "Request body too large.", requestId });
      return;
    }

    const body = await readJsonBody(request, maxRequestBytes);
    const { assessCredibility, heuristicAssessment, validateAssessRequest } = await loadScoring();
    const assessmentRequest = validateAssessRequest(body);
    let assessment: Awaited<ReturnType<typeof assessCredibility>>;

    try {
      assessment = await assessCredibility(assessmentRequest, env);
    } catch {
      assessment = heuristicAssessment(assessmentRequest);
    }

    if (canStoreEvidence(assessmentRequest, env)) {
      const storage = await storeEvidence(assessmentRequest, assessment, env);
      assessment = {
        ...assessment,
        ...storage
      };
    }

    console.log(
      JSON.stringify({
        requestId,
        client: assessmentRequest.client,
        latencyMs: Date.now() - startedAt,
        band: assessment.band,
        errorCategory: null
      })
    );

    writeJson(response, 200, assessment);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.log(
      JSON.stringify({
        requestId,
        latencyMs: Date.now() - startedAt,
        band: null,
        errorCategory: "selfhost"
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
    });
  }
});

server.listen(port, host, () => {
  console.log(`TrustLens backend listening on http://${host}:${port}`);
});

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    ...corsHeaders,
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  });
  response.end(value === null ? "" : JSON.stringify(value));
}

function writeBytes(response: ServerResponse, status: number, value: Buffer, contentType: string): void {
  response.writeHead(status, {
    ...corsHeaders,
    "Content-Type": contentType,
    "Cache-Control": "private, no-store"
  });
  response.end(value);
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

function loadScoring(): Promise<ScoringModule> {
  return import("./scoring.ts");
}
