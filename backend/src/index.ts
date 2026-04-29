import {
  assessCredibility,
  heuristicAssessment,
  validateAssessRequest
} from "./scoring";
import { API_VERSION, assessSchema, publicRuntimeConfig } from "./api-metadata";
import type { CredibilityAssessResponse, Env } from "./types";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400"
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();

    try {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/health") {
        return jsonResponse(
          {
            ok: true,
            service: "trustlens-backend",
            apiVersion: API_VERSION,
            endpoints: ["/v1/assess", "/v1/schema"],
            config: publicRuntimeConfig(env)
          },
          200,
          requestId
        );
      }

      if (request.method === "GET" && url.pathname === "/v1/schema") {
        return jsonResponse(
          {
            ...assessSchema(),
            config: publicRuntimeConfig(env)
          },
          200,
          requestId
        );
      }

      if (request.method !== "POST" || url.pathname !== "/v1/assess") {
        return jsonResponse({ error: "Not found", requestId }, 404, requestId);
      }

      if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
        return jsonResponse({ error: "Content-Type must be application/json.", requestId }, 400, requestId);
      }

      const contentLength = Number.parseInt(request.headers.get("content-length") || "0", 10);
      const maxBytes = Number.parseInt(env.MAX_REQUEST_BYTES || "3500000", 10);
      if (contentLength > maxBytes) {
        return jsonResponse({ error: "Request body too large.", requestId }, 413, requestId);
      }

      let body: unknown;
      try {
        body = await readJsonBody(request, maxBytes);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Request body must contain valid JSON.";
        const status = message.includes("too large") ? 413 : 400;
        return jsonResponse({ error: message, requestId }, status, requestId);
      }
      const assessmentRequest = validateAssessRequest(body);
      let assessment: CredibilityAssessResponse;

      try {
        assessment = await assessCredibility(assessmentRequest, env);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        if (categorizeError(message) !== "openai") {
          throw error;
        }
        assessment = heuristicAssessment(assessmentRequest);
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

      return jsonResponse(assessment, 200, requestId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const errorCategory = categorizeError(message);

      console.log(
        JSON.stringify({
          requestId,
          latencyMs: Date.now() - startedAt,
          band: null,
          errorCategory
        })
      );

      return jsonResponse({ error: message, requestId }, errorCategory === "validation" ? 400 : 500, requestId);
    }
  }
};

function jsonResponse(value: unknown, status: number, requestId?: string): Response {
  return Response.json(value, {
    status,
    headers: {
      ...corsHeaders,
      ...(requestId ? { "X-Request-Id": requestId } : {}),
      "Cache-Control": "no-store"
    }
  });
}

async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  if (!request.body) {
    throw new Error("Request body must be a JSON object.");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      throw new Error("Request body too large.");
    }
    chunks.push(value);
  }

  const text = new TextDecoder().decode(concatBytes(chunks, totalBytes));
  if (!text.trim()) {
    throw new Error("Request body must be a JSON object.");
  }
  return JSON.parse(text) as unknown;
}

function concatBytes(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function categorizeError(message: string): "validation" | "openai" | "unknown" {
  if (
    message.includes("client must") ||
    message.includes("Provide at least") ||
    message.includes("Request body") ||
    message.includes("Content-Type") ||
    message.includes("imageCrop")
  ) {
    return "validation";
  }
  if (message.includes("OpenAI") || message.includes("structured output")) {
    return "openai";
  }
  return "unknown";
}
