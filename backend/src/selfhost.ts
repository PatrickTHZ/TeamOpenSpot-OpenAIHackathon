import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

interface SelfHostEnv {
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
}

type ScoringModule = typeof import("./scoring.ts");

const port = Number.parseInt(process.env.PORT || "5072", 10);
const host = process.env.HOST || "0.0.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": process.env.CORS_ORIGIN || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400"
};

const env: SelfHostEnv = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_MODEL: process.env.OPENAI_MODEL || "gpt-5"
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
    if (request.method !== "POST" || url.pathname !== "/v1/assess") {
      writeJson(response, 404, { error: "Not found", requestId });
      return;
    }

    const body = await readJsonBody(request);
    const { assessCredibility, heuristicAssessment, validateAssessRequest } = await loadScoring();
    const assessmentRequest = validateAssessRequest(body);
    let assessment: Awaited<ReturnType<typeof assessCredibility>>;

    try {
      assessment = await assessCredibility(assessmentRequest, env);
    } catch {
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
    writeJson(response, message.includes("Provide at least") ? 400 : 500, {
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

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) {
    throw new Error("Request body must be a JSON object.");
  }
  return JSON.parse(text) as unknown;
}

function loadScoring(): Promise<ScoringModule> {
  return import("./scoring.ts");
}
