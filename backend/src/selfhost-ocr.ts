import type { CredibilityAssessRequest } from "../../shared/credibility-contract.ts";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";

export interface OcrEnv {
  OCR_ENABLED?: string;
  OCR_ENGINE?: string;
  OCR_LANG?: string;
  OCR_TIMEOUT_MS?: string;
}

export interface OcrResult {
  text: string;
  source: "tesseract";
}

const DEFAULT_OCR_TIMEOUT_MS = 3000;
const MAX_OCR_TIMEOUT_MS = 10000;

export async function enrichWithOcr(
  request: CredibilityAssessRequest,
  env: OcrEnv
): Promise<{ request: CredibilityAssessRequest; ocr: OcrResult | null }> {
  if (
    env.OCR_ENABLED !== "true" ||
    (env.OCR_ENGINE && env.OCR_ENGINE !== "tesseract") ||
    request.screenshotOcrText ||
    !request.imageCrop?.dataUrl
  ) {
    return { request, ocr: null };
  }

  try {
    const ocr = await withTimeout(runTesseract(request.imageCrop.dataUrl, env), ocrTimeoutMs(env));
    if (!ocr.text.trim()) return { request, ocr: null };
    return {
      request: {
        ...request,
        screenshotOcrText: ocr.text.slice(0, 6000)
      },
      ocr
    };
  } catch {
    return { request, ocr: null };
  }
}

async function runTesseract(dataUrl: string, env: OcrEnv): Promise<OcrResult> {
  const tempDir = await mkdtemp(join(tmpdir(), "trustlens-ocr-"));
  const imagePath = join(tempDir, "crop.png");
  try {
    await writeFile(imagePath, dataUrlToBuffer(dataUrl));
    const text = await execTesseract(imagePath, env);
    return {
      text,
      source: "tesseract"
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function dataUrlToBuffer(dataUrl: string): Buffer {
  const match = dataUrl.match(/^data:image\/(?:png|jpeg|webp);base64,([a-z0-9+/=]+)$/i);
  if (!match) {
    throw new Error("OCR image must be a PNG, JPEG, or WebP base64 data URL.");
  }
  return Buffer.from(match[1], "base64");
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("OCR timed out.")), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function execTesseract(imagePath: string, env: OcrEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "tesseract",
      [imagePath, "stdout", "-l", env.OCR_LANG || "eng"],
      {
        timeout: ocrTimeoutMs(env),
        windowsHide: true,
        maxBuffer: 1024 * 1024
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      }
    );
  });
}

function ocrTimeoutMs(env: OcrEnv): number {
  const parsed = Number.parseInt(env.OCR_TIMEOUT_MS || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_OCR_TIMEOUT_MS;
  return Math.min(parsed, MAX_OCR_TIMEOUT_MS);
}
