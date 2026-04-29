import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type {
  CredibilityAssessRequest,
  CredibilityAssessResponse
} from "../../shared/credibility-contract.ts";

export interface EvidenceStorageEnv {
  EVIDENCE_STORAGE_ENABLED?: string;
  EVIDENCE_STORAGE_DIR?: string;
  EVIDENCE_STORE_RAW_TEXT?: string;
  EVIDENCE_HASH_SALT?: string;
  EVIDENCE_ADMIN_TOKEN?: string;
  TRAINING_ACCESS_TOKEN?: string;
}

export interface StoredEvidenceSummary {
  evidenceId: string;
  createdAt: string;
  client: string;
  label: string;
  riskLevel: string;
  hasImage: boolean;
  consentLabel?: string;
}

interface StoredEvidenceRecord extends StoredEvidenceSummary {
  inputStats: {
    visibleTextLength: number;
    selectedTextLength: number;
    ocrTextLength: number;
    linkCount: number;
    hasImageCrop: boolean;
  };
  privacy: {
    urlHash?: string;
    domainHash?: string;
    linkDomainHashes: string[];
  };
  request?: CredibilityAssessRequest;
  response: Pick<
    CredibilityAssessResponse,
    "score" | "band" | "riskLevel" | "label" | "confidence" | "evidenceFor" | "evidenceAgainst" | "missingSignals"
  >;
  imageFile?: string;
}

const DEFAULT_STORAGE_DIR = "/data/evidence";
const MAX_RECORDS = 200;

export function evidenceStorageEnabled(env: EvidenceStorageEnv): boolean {
  return env.EVIDENCE_STORAGE_ENABLED === "true";
}

export function canStoreEvidence(request: CredibilityAssessRequest, env: EvidenceStorageEnv): boolean {
  return evidenceStorageEnabled(env) && request.consentToStoreEvidence === true;
}

export function hasTrainingAccess(authHeader: string | undefined, env: EvidenceStorageEnv): boolean {
  const token = env.EVIDENCE_ADMIN_TOKEN || env.TRAINING_ACCESS_TOKEN;
  if (!token) return false;
  return authHeader === `Bearer ${token}`;
}

export async function storeEvidence(
  request: CredibilityAssessRequest,
  response: CredibilityAssessResponse,
  env: EvidenceStorageEnv
): Promise<{ evidenceId: string; storedEvidenceUrl: string }> {
  const root = storageRoot(env);
  const evidenceId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const dir = join(root, evidenceId);
  await mkdir(dir, { recursive: true });

  const imageFile = await storeImageCrop(dir, request);
  const storedResponse = { ...response, evidenceId, storedEvidenceUrl: `/v1/evidence/${evidenceId}` };
  const record: StoredEvidenceRecord = {
    evidenceId,
    createdAt,
    client: request.client,
    label: response.label,
    riskLevel: response.riskLevel,
    hasImage: Boolean(imageFile),
    consentLabel: request.consentLabel,
    inputStats: {
      visibleTextLength: request.visibleText?.length || 0,
      selectedTextLength: request.selectedText?.length || 0,
      ocrTextLength: request.screenshotOcrText?.length || 0,
      linkCount: request.extractedLinks?.length || 0,
      hasImageCrop: Boolean(request.imageCrop)
    },
    privacy: {
      urlHash: request.url ? hashValue(request.url, env) : undefined,
      domainHash: request.url ? hashValue(domainFromUrl(request.url) || request.url, env) : undefined,
      linkDomainHashes: (request.extractedLinks || [])
        .map((link) => domainFromUrl(link.href))
        .filter((domain): domain is string => Boolean(domain))
        .map((domain) => hashValue(domain, env))
    },
    request: env.EVIDENCE_STORE_RAW_TEXT === "true" ? stripImageDataUrl(request) : undefined,
    response: {
      score: storedResponse.score,
      band: storedResponse.band,
      riskLevel: storedResponse.riskLevel,
      label: storedResponse.label,
      confidence: storedResponse.confidence,
      evidenceFor: storedResponse.evidenceFor,
      evidenceAgainst: storedResponse.evidenceAgainst,
      missingSignals: storedResponse.missingSignals
    },
    imageFile
  };

  await writeFile(join(dir, "record.json"), JSON.stringify(record, null, 2), "utf8");
  return { evidenceId, storedEvidenceUrl: storedResponse.storedEvidenceUrl };
}

export async function listEvidence(env: EvidenceStorageEnv): Promise<StoredEvidenceSummary[]> {
  const root = storageRoot(env);
  await mkdir(root, { recursive: true });
  const ids = await readdir(root);
  const records: Array<StoredEvidenceSummary | null> = await Promise.all(
    ids.slice(-MAX_RECORDS).map(async (id) => {
      try {
        const record = JSON.parse(await readFile(join(root, id, "record.json"), "utf8")) as StoredEvidenceRecord;
        const summary: StoredEvidenceSummary = {
          evidenceId: record.evidenceId,
          createdAt: record.createdAt,
          client: record.client,
          label: record.label,
          riskLevel: record.riskLevel,
          hasImage: record.hasImage,
          consentLabel: record.consentLabel
        };
        return summary;
      } catch {
        return null;
      }
    })
  );

  return records
    .filter((record): record is StoredEvidenceSummary => record !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function readEvidence(id: string, env: EvidenceStorageEnv): Promise<StoredEvidenceRecord | null> {
  if (!/^[a-f0-9-]{36}$/i.test(id)) return null;
  try {
    return JSON.parse(await readFile(join(storageRoot(env), id, "record.json"), "utf8")) as StoredEvidenceRecord;
  } catch {
    return null;
  }
}

export async function readEvidenceImage(
  id: string,
  env: EvidenceStorageEnv
): Promise<{ bytes: Buffer; contentType: string } | null> {
  const record = await readEvidence(id, env);
  if (!record?.imageFile) return null;
  const contentType = record.imageFile.endsWith(".jpg") ? "image/jpeg" : `image/${record.imageFile.split(".").pop()}`;
  return {
    bytes: await readFile(join(storageRoot(env), id, record.imageFile)),
    contentType
  };
}

function storageRoot(env: EvidenceStorageEnv): string {
  return env.EVIDENCE_STORAGE_DIR || DEFAULT_STORAGE_DIR;
}

async function storeImageCrop(dir: string, request: CredibilityAssessRequest): Promise<string | undefined> {
  const dataUrl = request.imageCrop?.dataUrl;
  if (!dataUrl) return undefined;

  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
  if (!match) return undefined;

  const extension = match[1] === "image/jpeg" ? "jpg" : match[1].split("/")[1];
  const imageFile = `image.${extension}`;
  await writeFile(join(dir, imageFile), Buffer.from(match[2], "base64"));
  return imageFile;
}

function stripImageDataUrl(request: CredibilityAssessRequest): CredibilityAssessRequest {
  return {
    ...request,
    imageCrop: request.imageCrop
      ? {
          ...request.imageCrop,
          dataUrl: request.imageCrop.dataUrl ? "[stored separately]" : undefined
        }
      : undefined
  };
}

function hashValue(value: string, env: EvidenceStorageEnv): string {
  return createHash("sha256")
    .update(`${env.EVIDENCE_HASH_SALT || ""}:${value}`)
    .digest("hex");
}

function domainFromUrl(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}
