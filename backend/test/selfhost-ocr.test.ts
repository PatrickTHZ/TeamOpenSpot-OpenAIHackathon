import { describe, expect, it } from "vitest";
import { enrichWithOcr } from "../src/selfhost-ocr";

const tinyPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

describe("enrichWithOcr", () => {
  it("skips OCR when disabled", async () => {
    const request = {
      client: "chrome" as const,
      imageCrop: {
        dataUrl: tinyPng
      }
    };

    const result = await enrichWithOcr(request, { OCR_ENABLED: "false" });

    expect(result.ocr).toBeNull();
    expect(result.request).toBe(request);
  });

  it("skips OCR when client OCR text is already present", async () => {
    const request = {
      client: "chrome" as const,
      screenshotOcrText: "Already extracted",
      imageCrop: {
        dataUrl: tinyPng
      }
    };

    const result = await enrichWithOcr(request, { OCR_ENABLED: "true" });

    expect(result.ocr).toBeNull();
    expect(result.request.screenshotOcrText).toBe("Already extracted");
  });

  it("fails open when tesseract is unavailable or times out", async () => {
    const request = {
      client: "chrome" as const,
      imageCrop: {
        dataUrl: tinyPng
      }
    };

    const result = await enrichWithOcr(request, {
      OCR_ENABLED: "true",
      OCR_ENGINE: "missing-engine",
      OCR_TIMEOUT_MS: "1"
    });

    expect(result.ocr).toBeNull();
    expect(result.request).toBe(request);
  });
});
