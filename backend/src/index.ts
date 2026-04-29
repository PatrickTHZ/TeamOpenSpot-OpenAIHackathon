import {
  assessCredibility,
  heuristicAssessment,
  validateAssessRequest
} from "./scoring";
import type { CredibilityAssessResponse, Env } from "./types";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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
      if (request.method !== "POST" || url.pathname !== "/v1/assess") {
        return jsonResponse({ error: "Not found", requestId }, 404);
      }

      const body = await request.json();
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
    message.includes("Request body")
  ) {
    return "validation";
  }
  if (message.includes("OpenAI") || message.includes("structured output")) {
    return "openai";
  }
  return "unknown";
}
