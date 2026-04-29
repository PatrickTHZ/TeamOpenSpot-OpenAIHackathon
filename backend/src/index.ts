import {
  assessCredibility,
  heuristicAssessment,
  validateAssessRequest
} from "./scoring";
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
            endpoints: ["/v1/assess"]
          },
          200
        );
      }

      if (request.method !== "POST" || url.pathname !== "/v1/assess") {
        return jsonResponse({ error: "Not found", requestId }, 404);
      }

      if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
        return jsonResponse({ error: "Content-Type must be application/json.", requestId }, 400);
      }

      const contentLength = Number.parseInt(request.headers.get("content-length") || "0", 10);
      const maxBytes = Number.parseInt(env.MAX_REQUEST_BYTES || "3500000", 10);
      if (contentLength > maxBytes) {
        return jsonResponse({ error: "Request body too large.", requestId }, 413);
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ error: "Request body must contain valid JSON.", requestId }, 400);
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

      return jsonResponse(assessment, 200);
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

      return jsonResponse({ error: message, requestId }, errorCategory === "validation" ? 400 : 500);
    }
  }
};

function jsonResponse(value: unknown, status: number): Response {
  return Response.json(value, {
    status,
    headers: {
      ...corsHeaders,
      "Cache-Control": "no-store"
    }
  });
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
