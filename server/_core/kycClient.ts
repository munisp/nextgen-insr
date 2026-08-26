/**
 * KYC Client — HTTP proxy helpers for KYC/KYB microservices
 *
 * Services proxied (DD-LEGACY #18: all URLs are env-required — the previous
 * defaults pointed at nonexistent services/ports and fabricated public
 * hosts such as videokyc.insureportal.io / ocr.insureportal.io /
 * kyc.insureportal.io):
 *  1. Biometric Verification Orchestrator  (BIOMETRIC_SERVICE_URL)
 *  2. Liveness Detection Service           (LIVENESS_SERVICE_URL)
 *  3. Face Matching Service                (FACE_MATCHING_SERVICE_URL)
 *  4. Deepfake Detection Service           (DEEPFAKE_SERVICE_URL)
 *  5. Video-KYC liveness (legacy)          (KYC_SERVICE_URL)
 *  6. PaddleOCR document service           (PADDLEOCR_SERVICE_URL)
 *  7. Compliance-KYC record store          (COMPLIANCE_KYC_URL)
 *  8. DeepFace Service                     (DEEPFACE_SERVICE_URL)
 *
 * All calls are fail-safe: if the downstream service is unavailable the
 * function returns a structured error object rather than throwing, so the
 * tRPC procedure can decide how to handle it (fail-open vs fail-closed).
 */

import { ENV } from "./env.js";

// ── Service URLs (no fabricated defaults — unconfigured means unavailable) ──
const BIOMETRIC_SERVICE_URL = (ENV as any).BIOMETRIC_SERVICE_URL ?? "";
const LIVENESS_SERVICE_URL = (ENV as any).LIVENESS_SERVICE_URL ?? "";
const FACE_MATCHING_SERVICE_URL =
  (ENV as any).FACE_MATCHING_SERVICE_URL ?? "";
const DEEPFAKE_SERVICE_URL = (ENV as any).DEEPFACE_SERVICE_URL ?? "";
const KYC_SERVICE_URL = (ENV as any).KYC_SERVICE_URL ?? "";
const PADDLEOCR_URL = (ENV as any).PADDLEOCR_SERVICE_URL ?? "";
const COMPLIANCE_KYC_URL = (ENV as any).COMPLIANCE_KYC_URL ?? "";
const DEEPFACE_SERVICE_URL = (ENV as any).DEEPFACE_SERVICE_URL ?? "";

const TIMEOUT_MS = 30_000;

/** Generic fetch wrapper with timeout */
async function kycFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs = TIMEOUT_MS
): Promise<{ ok: boolean; status: number; data: unknown }> {
  // DD-LEGACY: an unconfigured service (empty base URL) is reported as
  // unavailable instead of attempting a fetch against a fabricated host.
  if (url.startsWith("/")) {
    return {
      ok: false,
      status: 0,
      data: { error: "KYC service URL not configured" },
    };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(timer);
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { ok: res.ok, status: res.status, data };
  } catch (err: unknown) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, data: { error: msg } };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BIOMETRIC VERIFICATION (Sprint 90 — production microservices)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Full Biometric Verification ─────────────────────────────────────────────

export interface BiometricVerificationResult {
  verificationId: string;
  status: "verified" | "rejected" | "requires_review";
  overallConfidence: number;
  faceMatch: {
    match: boolean;
    similarity: number;
    confidence: number;
    source: string;
  };
  liveness: {
    result: "real" | "fake" | "uncertain";
    confidence: number;
    spoofType: string;
    source: string;
  };
  deepfake: {
    isReal: boolean;
    confidence: number;
    source: string;
  };
  quality: {
    selfie: {
      overallQuality: number;
      scores: Record<string, number>;
      issues: string[];
      icaoCompliant: boolean;
    };
    document: {
      overallQuality: number;
      scores: Record<string, number>;
      issues: string[];
    };
  };
  landmarks: { has68Point: boolean; count: number };
  issues: string[];
  processingTimeMs: number;
}

/** Full biometric verification: selfie vs document photo */
export async function verifyBiometric(
  selfieBase64: string,
  documentBase64: string,
  userId: string
): Promise<BiometricVerificationResult | null> {
  const res = await kycFetch(
    `${BIOMETRIC_SERVICE_URL}/api/v1/biometric/verify`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        selfie_base64: selfieBase64,
        document_base64: documentBase64,
        user_id: userId,
      }),
    },
    60_000
  );

  if (!res.ok) return null;
  const d = res.data as Record<string, unknown>;
  const fm = (d.face_match ?? {}) as Record<string, unknown>;
  const lv = (d.liveness ?? {}) as Record<string, unknown>;
  const df = (d.deepfake ?? {}) as Record<string, unknown>;
  const q = (d.quality ?? {}) as Record<string, unknown>;
  const lm = (d.landmarks ?? {}) as Record<string, unknown>;

  return {
    verificationId: String(d.verification_id ?? ""),
    status: (d.status as any) ?? "requires_review",
    overallConfidence: Number(d.overall_confidence ?? 0),
    faceMatch: {
      match: Boolean(fm.match),
      similarity: Number(fm.similarity ?? 0),
      confidence: Number(fm.confidence ?? 0),
      source: String(fm.source ?? "unknown"),
    },
    liveness: {
      result: (lv.result as any) ?? "uncertain",
      confidence: Number(lv.confidence ?? 0),
      spoofType: String(lv.spoof_type ?? "none"),
      source: String(lv.source ?? "unknown"),
    },
    deepfake: {
      isReal: Boolean(df.is_real ?? true),
      confidence: Number(df.confidence ?? 0),
      source: String(df.source ?? "unknown"),
    },
    quality: {
      selfie: parseQuality((q.selfie ?? {}) as Record<string, unknown>),
      document: parseQuality((q.document ?? {}) as Record<string, unknown>),
    },
    landmarks: {
      has68Point: Boolean(lm["68_point"]),
      count: Number(lm.count ?? 0),
    },
    issues: Array.isArray(d.issues) ? (d.issues as string[]) : [],
    processingTimeMs: Number(d.processing_time_ms ?? 0),
  };
}

function parseQuality(q: Record<string, unknown>) {
  return {
    overallQuality: Number(q.overall_quality ?? 0),
    scores: (q.scores ?? {}) as Record<string, number>,
    issues: Array.isArray(q.issues) ? (q.issues as string[]) : [],
    icaoCompliant: Boolean(q.icao_compliant ?? false),
  };
}

// ─── Passive Liveness ────────────────────────────────────────────────────────

export interface PassiveLivenessResult {
  isLive: boolean;
  confidence: number;
  spoofType: string;
  checks: Record<string, unknown>;
  source: string;
}

/** Passive liveness check on a single image */
export async function checkPassiveLiveness(
  imageBase64: string
): Promise<PassiveLivenessResult | null> {
  const res = await kycFetch(`${LIVENESS_SERVICE_URL}/liveness/passive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_base64: imageBase64 }),
  });

  if (!res.ok) return null;
  const d = res.data as Record<string, unknown>;
  return {
    isLive: Boolean(d.is_live),
    confidence: Number(d.overall_score ?? 0),
    spoofType: String(d.spoof_type ?? "none"),
    checks: (d.checks ?? {}) as Record<string, unknown>,
    source: "liveness_service",
  };
}

// ─── Active Liveness ─────────────────────────────────────────────────────────

export interface ActiveLivenessResult {
  isLive: boolean;
  confidence: number;
  motionDetected: boolean;
  blinkDetected: boolean;
  framesAnalyzed: number;
}

/** Active liveness check on multiple frames */
export async function checkActiveLiveness(
  framesBase64: string[],
  challengeType?: string
): Promise<ActiveLivenessResult | null> {
  const res = await kycFetch(`${LIVENESS_SERVICE_URL}/liveness/active`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      frames_base64: framesBase64,
      challenge_type: challengeType,
    }),
  });

  if (!res.ok) return null;
  const d = res.data as Record<string, unknown>;
  return {
    isLive: Boolean(d.is_live),
    confidence: Number(d.overall_score ?? 0),
    motionDetected: Boolean(d.motion_detected),
    blinkDetected: Boolean(d.blink_detected),
    framesAnalyzed: Number(d.frames_analyzed ?? 0),
  };
}

// ─── Face Matching ───────────────────────────────────────────────────────────

export interface FaceMatchResult {
  match: boolean;
  similarity: number;
  confidence: number;
  model: string;
  demographics: Record<string, unknown>;
  processingTimeMs: number;
}

/** 1:1 face matching between two images */
export async function matchFaces(
  image1Base64: string,
  image2Base64: string
): Promise<FaceMatchResult | null> {
  const res = await kycFetch(`${FACE_MATCHING_SERVICE_URL}/face/match`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image1_base64: image1Base64,
      image2_base64: image2Base64,
    }),
  });

  if (!res.ok) return null;
  const d = res.data as Record<string, unknown>;
  return {
    match: Boolean(d.match),
    similarity: Number(d.similarity ?? 0),
    confidence: Number(d.confidence ?? 0),
    model: String(d.model ?? "unknown"),
    demographics: (d.demographics ?? {}) as Record<string, unknown>,
    processingTimeMs: Number(d.processing_time_ms ?? 0),
  };
}

// ─── Face Detection ──────────────────────────────────────────────────────────

export interface DetectedFace {
  bbox: number[];
  confidence: number;
  landmarks5pt: number[][] | null;
  gender: string | null;
  age: number | null;
}

/** Detect faces in an image */
export async function detectFaces(
  imageBase64: string
): Promise<DetectedFace[] | null> {
  const res = await kycFetch(`${FACE_MATCHING_SERVICE_URL}/face/detect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_base64: imageBase64 }),
  });

  if (!res.ok) return null;
  const d = res.data as Record<string, unknown>;
  const faces = (d.faces ?? []) as Record<string, unknown>[];
  return faces.map(f => ({
    bbox: (f.bbox ?? []) as number[],
    confidence: Number(f.confidence ?? 0),
    landmarks5pt: (f.landmarks_5pt ?? null) as number[][] | null,
    gender: f.gender ? String(f.gender) : null,
    age: f.age ? Number(f.age) : null,
  }));
}

// ─── Deepfake Detection ──────────────────────────────────────────────────────

export interface DeepfakeResult {
  isReal: boolean;
  confidence: number;
  deepfakeProbability: number;
  deepfakeType: string;
  analysis: Record<string, unknown>;
}

/** Detect deepfakes in an image */
export async function detectDeepfake(
  imageBase64: string
): Promise<DeepfakeResult | null> {
  const res = await kycFetch(`${DEEPFAKE_SERVICE_URL}/deepfake/detect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_base64: imageBase64 }),
  });

  if (!res.ok) return null;
  const d = res.data as Record<string, unknown>;
  return {
    isReal: Boolean(d.is_real ?? true),
    confidence: Number(d.confidence ?? 0),
    deepfakeProbability: Number(d.deepfake_probability ?? 0),
    deepfakeType: String(d.deepfake_type ?? "unknown"),
    analysis: (d.analysis ?? {}) as Record<string, unknown>,
  };
}

// ─── Face Quality Assessment ─────────────────────────────────────────────────

export interface FaceQualityResult {
  overallQuality: number;
  scores: Record<string, number>;
  issues: string[];
  icaoCompliant: boolean;
}

/** Assess face image quality (ICAO compliance) */
export async function assessFaceQuality(
  imageBase64: string
): Promise<FaceQualityResult | null> {
  const res = await kycFetch(
    `${BIOMETRIC_SERVICE_URL}/api/v1/biometric/quality`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_base64: imageBase64 }),
    }
  );

  if (!res.ok) return null;
  const d = res.data as Record<string, unknown>;
  return {
    overallQuality: Number(d.overall_quality ?? 0),
    scores: (d.scores ?? {}) as Record<string, number>,
    issues: Array.isArray(d.issues) ? (d.issues as string[]) : [],
    icaoCompliant: Boolean(d.icao_compliant ?? false),
  };
}

// ─── Anti-Spoofing Pipeline ──────────────────────────────────────────────────

export interface AntiSpoofResult {
  antiSpoofScore: number;
  isReal: boolean;
  spoofType: string;
  checks: Record<string, unknown>;
}

/** Run anti-spoofing pipeline on an image */
export async function checkAntiSpoof(
  imageBase64: string
): Promise<AntiSpoofResult | null> {
  const res = await kycFetch(
    `${BIOMETRIC_SERVICE_URL}/api/v1/biometric/anti-spoof`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_base64: imageBase64 }),
    }
  );

  if (!res.ok) return null;
  const d = res.data as Record<string, unknown>;
  return {
    antiSpoofScore: Number(d.anti_spoof_score ?? 0),
    isReal: Boolean(d.is_real ?? false),
    spoofType: String(d.spoof_type ?? "unknown"),
    checks: (d.checks ?? {}) as Record<string, unknown>,
  };
}

// ─── Service Health ──────────────────────────────────────────────────────────

export interface ServiceHealthStatus {
  name: string;
  url: string;
  status: "healthy" | "unhealthy" | "unavailable";
  version?: string;
  capabilities?: Record<string, boolean>;
  error?: string;
}

/** Check health of all biometric microservices */
export async function checkBiometricServicesHealth(): Promise<
  ServiceHealthStatus[]
> {
  const services = [
    { name: "biometric_orchestrator", url: `${BIOMETRIC_SERVICE_URL}/health` },
    { name: "liveness_detection", url: `${LIVENESS_SERVICE_URL}/health` },
    { name: "face_matching", url: `${FACE_MATCHING_SERVICE_URL}/health` },
    { name: "deepfake_detection", url: `${DEEPFAKE_SERVICE_URL}/health` },
    { name: "video_kyc_legacy", url: `${KYC_SERVICE_URL}/health` },
    { name: "paddleocr", url: `${PADDLEOCR_URL}/health` },
    { name: "compliance_kyc", url: `${COMPLIANCE_KYC_URL}/health` },
  ];

  const results = await Promise.allSettled(
    services.map(async s => {
      const res = await kycFetch(s.url, {}, 5000);
      if (!res.ok) {
        return {
          name: s.name,
          url: s.url,
          status: "unavailable" as const,
          error: `HTTP ${res.status}`,
        };
      }
      const d = res.data as Record<string, unknown>;
      return {
        name: s.name,
        url: s.url,
        status: "healthy" as const,
        version: d.version ? String(d.version) : undefined,
        capabilities: (d.capabilities ?? {}) as Record<string, boolean>,
      };
    })
  );

  return results.map(r =>
    r.status === "fulfilled"
      ? r.value
      : {
          name: "unknown",
          url: "",
          status: "unavailable" as const,
          error: "Promise rejected",
        }
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEEPFACE SERVICE (serengil/deepface — multi-model face recognition & analysis)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── DeepFace Verification (1:1) ────────────────────────────────────────────

export interface DeepFaceVerifyResult {
  verified: boolean;
  distance: number;
  threshold: number;
  model: string;
  detectorBackend: string;
  similarityMetric: string;
  facialAreas: Record<string, unknown>;
  processingTimeMs: number;
  eventId: string;
}

/** 1:1 face verification using DeepFace (supports 10 model backends) */
export async function deepfaceVerify(
  image1Base64: string,
  image2Base64: string,
  modelName = "ArcFace",
  detectorBackend = "retinaface",
  distanceMetric = "cosine",
  antiSpoofing = false
): Promise<DeepFaceVerifyResult | null> {
  const res = await kycFetch(
    `${DEEPFACE_SERVICE_URL}/verify`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image1_base64: image1Base64,
        image2_base64: image2Base64,
        model_name: modelName,
        detector_backend: detectorBackend,
        distance_metric: distanceMetric,
        anti_spoofing: antiSpoofing,
      }),
    },
    60_000
  );

  if (!res.ok) return null;
  const d = res.data as Record<string, unknown>;
  return {
    verified: Boolean(d.verified),
    distance: Number(d.distance ?? 0),
    threshold: Number(d.threshold ?? 0),
    model: String(d.model ?? modelName),
    detectorBackend: String(d.detector_backend ?? detectorBackend),
    similarityMetric: String(d.similarity_metric ?? distanceMetric),
    facialAreas: (d.facial_areas ?? {}) as Record<string, unknown>,
    processingTimeMs: Number(d.processing_time_ms ?? 0),
    eventId: String(d.event_id ?? ""),
  };
}

// ─── DeepFace Ensemble Verification ─────────────────────────────────────────

export interface DeepFaceEnsembleResult {
  ensembleVerified: boolean;
  consensusRatio: number;
  consensusThreshold: number;
  modelsAgreed: number;
  modelsTotal: number;
  resultsPerModel: Array<{
    model: string;
    verified: boolean;
    distance?: number;
    threshold?: number;
    error?: string;
  }>;
  processingTimeMs: number;
  eventId: string;
}

/** Multi-model ensemble verification for higher confidence */
export async function deepfaceEnsembleVerify(
  image1Base64: string,
  image2Base64: string,
  models: string[] = ["ArcFace", "Facenet512", "VGG-Face"],
  threshold = 0.6,
  antiSpoofing = false
): Promise<DeepFaceEnsembleResult | null> {
  const res = await kycFetch(
    `${DEEPFACE_SERVICE_URL}/verify/ensemble`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image1_base64: image1Base64,
        image2_base64: image2Base64,
        models,
        threshold,
        anti_spoofing: antiSpoofing,
      }),
    },
    120_000
  );

  if (!res.ok) return null;
  const d = res.data as Record<string, unknown>;
  const perModel = (d.results_per_model ?? []) as Record<string, unknown>[];
  return {
    ensembleVerified: Boolean(d.ensemble_verified),
    consensusRatio: Number(d.consensus_ratio ?? 0),
    consensusThreshold: Number(d.consensus_threshold ?? threshold),
    modelsAgreed: Number(d.models_agreed ?? 0),
    modelsTotal: Number(d.models_total ?? 0),
    resultsPerModel: perModel.map(r => ({
      model: String(r.model ?? ""),
      verified: Boolean(r.verified),
      distance: r.distance != null ? Number(r.distance) : undefined,
      threshold: r.threshold != null ? Number(r.threshold) : undefined,
      error: r.error ? String(r.error) : undefined,
    })),
    processingTimeMs: Number(d.processing_time_ms ?? 0),
    eventId: String(d.event_id ?? ""),
  };
}

// ─── DeepFace Facial Analysis ───────────────────────────────────────────────

export interface DeepFaceFaceAttributes {
  region: Record<string, number>;
  faceConfidence: number;
  age?: number;
  dominantGender?: string;
  gender?: Record<string, number>;
  dominantEmotion?: string;
  emotion?: Record<string, number>;
  dominantRace?: string;
  race?: Record<string, number>;
}

export interface DeepFaceAnalysisResult {
  faces: DeepFaceFaceAttributes[];
  facesCount: number;
  actionsPerformed: string[];
  processingTimeMs: number;
}

/** Analyze facial attributes: age, gender, emotion, race */
export async function deepfaceAnalyze(
  imageBase64: string,
  actions: string[] = ["age", "gender", "emotion", "race"],
  detectorBackend = "retinaface",
  antiSpoofing = false
): Promise<DeepFaceAnalysisResult | null> {
  const res = await kycFetch(
    `${DEEPFACE_SERVICE_URL}/analyze`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_base64: imageBase64,
        actions,
        detector_backend: detectorBackend,
        anti_spoofing: antiSpoofing,
      }),
    },
    60_000
  );

  if (!res.ok) return null;
  const d = res.data as Record<string, unknown>;
  const faces = (d.faces ?? []) as Record<string, unknown>[];
  return {
    faces: faces.map(f => ({
      region: (f.region ?? {}) as Record<string, number>,
      faceConfidence: Number(f.face_confidence ?? 0),
      age: f.age != null ? Number(f.age) : undefined,
      dominantGender: f.dominant_gender ? String(f.dominant_gender) : undefined,
      gender: f.gender ? (f.gender as Record<string, number>) : undefined,
      dominantEmotion: f.dominant_emotion
        ? String(f.dominant_emotion)
        : undefined,
      emotion: f.emotion ? (f.emotion as Record<string, number>) : undefined,
      dominantRace: f.dominant_race ? String(f.dominant_race) : undefined,
      race: f.race ? (f.race as Record<string, number>) : undefined,
    })),
    facesCount: Number(d.faces_count ?? 0),
    actionsPerformed: Array.isArray(d.actions_performed)
      ? (d.actions_performed as string[])
      : [],
    processingTimeMs: Number(d.processing_time_ms ?? 0),
  };
}

// ─── DeepFace Embedding Extraction ──────────────────────────────────────────

export interface DeepFaceEmbeddingResult {
  embedding: number[];
  embeddingDim: number;
  model: string;
  facialArea: Record<string, number>;
  cached: boolean;
  processingTimeMs: number;
}

/** Extract face embedding vector using DeepFace */
export async function deepfaceExtractEmbedding(
  imageBase64: string,
  modelName = "ArcFace",
  detectorBackend = "retinaface"
): Promise<DeepFaceEmbeddingResult | null> {
  const res = await kycFetch(
    `${DEEPFACE_SERVICE_URL}/represent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_base64: imageBase64,
        model_name: modelName,
        detector_backend: detectorBackend,
      }),
    },
    60_000
  );

  if (!res.ok) return null;
  const d = res.data as Record<string, unknown>;
  return {
    embedding: (d.embedding ?? []) as number[],
    embeddingDim: Number(d.embedding_dim ?? 0),
    model: String(d.model ?? modelName),
    facialArea: (d.facial_area ?? {}) as Record<string, number>,
    cached: Boolean(d.cached),
    processingTimeMs: Number(d.processing_time_ms ?? 0),
  };
}

// ─── DeepFace Anti-Spoofing ─────────────────────────────────────────────────

export interface DeepFaceAntiSpoofResult {
  isReal: boolean;
  faces: Array<{
    facialArea: Record<string, number>;
    isReal: boolean;
    antispoofScore: number;
    confidence: number;
  }>;
  facesCount: number;
  processingTimeMs: number;
}

/** Run DeepFace anti-spoofing detection */
export async function deepfaceAntiSpoof(
  imageBase64: string,
  detectorBackend = "retinaface"
): Promise<DeepFaceAntiSpoofResult | null> {
  const res = await kycFetch(`${DEEPFACE_SERVICE_URL}/anti-spoof`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image_base64: imageBase64,
      detector_backend: detectorBackend,
    }),
  });

  if (!res.ok) return null;
  const d = res.data as Record<string, unknown>;
  const faces = (d.faces ?? []) as Record<string, unknown>[];
  return {
    isReal: Boolean(d.is_real),
    faces: faces.map(f => ({
      facialArea: (f.facial_area ?? {}) as Record<string, number>,
      isReal: Boolean(f.is_real),
      antispoofScore: Number(f.antispoof_score ?? 0),
      confidence: Number(f.confidence ?? 0),
    })),
    facesCount: Number(d.faces_count ?? 0),
    processingTimeMs: Number(d.processing_time_ms ?? 0),
  };
}

// ─── DeepFace Face Detection ────────────────────────────────────────────────

export interface DeepFaceDetectedFace {
  facialArea: Record<string, number>;
  confidence: number;
  isReal?: boolean;
  antispoofScore?: number;
}

export interface DeepFaceDetectionResult {
  faces: DeepFaceDetectedFace[];
  facesCount: number;
  detectorBackend: string;
  processingTimeMs: number;
}

/** Detect faces using DeepFace (supports 9 detector backends) */
export async function deepfaceDetectFaces(
  imageBase64: string,
  detectorBackend = "retinaface",
  antiSpoofing = false
): Promise<DeepFaceDetectionResult | null> {
  const res = await kycFetch(`${DEEPFACE_SERVICE_URL}/detect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image_base64: imageBase64,
      detector_backend: detectorBackend,
      anti_spoofing: antiSpoofing,
    }),
  });

  if (!res.ok) return null;
  const d = res.data as Record<string, unknown>;
  const faces = (d.faces ?? []) as Record<string, unknown>[];
  return {
    faces: faces.map(f => ({
      facialArea: (f.facial_area ?? {}) as Record<string, number>,
      confidence: Number(f.confidence ?? 0),
      isReal: f.is_real != null ? Boolean(f.is_real) : undefined,
      antispoofScore:
        f.antispoof_score != null ? Number(f.antispoof_score) : undefined,
    })),
    facesCount: Number(d.faces_count ?? 0),
    detectorBackend: String(d.detector_backend ?? detectorBackend),
    processingTimeMs: Number(d.processing_time_ms ?? 0),
  };
}

// ─── DeepFace Gallery Operations ────────────────────────────────────────────

export interface DeepFaceEnrollResult {
  enrolled: boolean;
  identity: string;
  model: string;
  embeddingDim: number;
  processingTimeMs: number;
}

/** Enroll a face into the DeepFace gallery for 1:N recognition */
export async function deepfaceEnroll(
  imageBase64: string,
  identity: string,
  modelName = "ArcFace",
  metadata?: Record<string, unknown>
): Promise<DeepFaceEnrollResult | null> {
  const res = await kycFetch(
    `${DEEPFACE_SERVICE_URL}/gallery/enroll`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_base64: imageBase64,
        identity,
        model_name: modelName,
        metadata,
      }),
    },
    60_000
  );

  if (!res.ok) return null;
  const d = res.data as Record<string, unknown>;
  return {
    enrolled: Boolean(d.enrolled),
    identity: String(d.identity ?? identity),
    model: String(d.model ?? modelName),
    embeddingDim: Number(d.embedding_dim ?? 0),
    processingTimeMs: Number(d.processing_time_ms ?? 0),
  };
}

export interface DeepFaceSearchMatch {
  identity: string;
  distance: number;
  metadata: Record<string, unknown>;
}

export interface DeepFaceSearchResult {
  matches: DeepFaceSearchMatch[];
  gallerySize: number;
  model: string;
  distanceMetric: string;
  processingTimeMs: number;
}

/** Search the DeepFace gallery for matching faces (1:N recognition) */
export async function deepfaceSearch(
  imageBase64: string,
  modelName = "ArcFace",
  topK = 5,
  threshold?: number
): Promise<DeepFaceSearchResult | null> {
  const res = await kycFetch(
    `${DEEPFACE_SERVICE_URL}/gallery/search`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_base64: imageBase64,
        model_name: modelName,
        top_k: topK,
        threshold,
      }),
    },
    60_000
  );

  if (!res.ok) return null;
  const d = res.data as Record<string, unknown>;
  const matches = (d.matches ?? []) as Record<string, unknown>[];
  return {
    matches: matches.map(m => ({
      identity: String(m.identity ?? ""),
      distance: Number(m.distance ?? 0),
      metadata: (m.metadata ?? {}) as Record<string, unknown>,
    })),
    gallerySize: Number(d.gallery_size ?? 0),
    model: String(d.model ?? modelName),
    distanceMetric: String(d.distance_metric ?? "cosine"),
    processingTimeMs: Number(d.processing_time_ms ?? 0),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// LEGACY KYC SERVICES (preserved for backward compatibility)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Liveness Detection (Legacy) ─────────────────────────────────────────────

export interface LivenessChallengeResult {
  challengeId: string;
  method: string;
  instruction: string;
  expiresAt: number;
}

export interface LivenessVerifyResult {
  challengeId: string;
  passed: boolean;
  score: number;
  method: string;
  spoofingDetected: boolean;
  spoofingType?: string;
  raw: unknown;
}

/** Ask the legacy liveness service to generate a new challenge */
export async function createLivenessChallenge(
  method = "active_blink"
): Promise<LivenessChallengeResult | null> {
  const res = await kycFetch(`${KYC_SERVICE_URL}/create_challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method }),
  });
  if (!res.ok) return null;
  const d = res.data as Record<string, unknown>;
  return {
    challengeId: String(d.challenge_id ?? d.challengeId ?? ""),
    method: String(d.method ?? method),
    instruction: String(d.instruction ?? "Please blink twice"),
    expiresAt: Date.now() + 60_000,
  };
}

/** Submit a base64-encoded frame to verify a legacy liveness challenge */
export async function verifyLivenessChallenge(
  challengeId: string,
  frameBase64: string
): Promise<LivenessVerifyResult | null> {
  const res = await kycFetch(
    `${KYC_SERVICE_URL}/respond_challenge/${challengeId}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: frameBase64 }),
    }
  );
  if (!res.ok) return null;
  const d = res.data as Record<string, unknown>;
  return {
    challengeId,
    passed: Boolean(d.passed ?? d.is_live),
    score: Number(d.score ?? d.liveness_score ?? 0),
    method: String(d.method ?? ""),
    spoofingDetected: Boolean(d.spoofing_detected ?? false),
    spoofingType: d.spoofing_type ? String(d.spoofing_type) : undefined,
    raw: res.data,
  };
}

// ─── Document OCR ────────────────────────────────────────────────────────────

export interface OcrResult {
  documentType: string;
  extractedName?: string;
  extractedDob?: string;
  extractedIdNumber?: string;
  confidence: number;
  fraudIndicators: string[];
  raw: unknown;
}

/** Submit a base64-encoded document image for OCR extraction */
export async function processDocument(
  imageBase64: string,
  documentType:
    | "NIN"
    | "BVN_CARD"
    | "PASSPORT"
    | "DRIVERS_LICENCE"
    | "VOTER_CARD"
): Promise<OcrResult | null> {
  const res = await kycFetch(`${PADDLEOCR_URL}/process-document`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image: imageBase64,
      document_type: documentType.toLowerCase().replace("_", "-"),
    }),
  });
  if (!res.ok) return null;
  const d = res.data as Record<string, unknown>;
  const fields = (d.fields ?? d.extracted_fields ?? {}) as Record<
    string,
    string
  >;
  return {
    documentType,
    extractedName: fields.name ?? fields.full_name ?? undefined,
    extractedDob: fields.dob ?? fields.date_of_birth ?? undefined,
    extractedIdNumber:
      fields.id_number ?? fields.bvn ?? fields.nin ?? undefined,
    confidence: Number(d.confidence ?? d.overall_confidence ?? 0),
    fraudIndicators: Array.isArray(d.fraud_indicators)
      ? (d.fraud_indicators as string[])
      : [],
    raw: res.data,
  };
}

// ─── Compliance KYC Record Storage ───────────────────────────────────────────

export interface ComplianceRecord {
  id: string;
  customerId: string;
  status: string;
}

/** Store a completed KYC session in the compliance-kyc service */
export async function storeComplianceRecord(payload: {
  customerId: string;
  fullName?: string;
  idType?: string;
  idNumber?: string;
  livenessScore?: number;
  documentConfidence?: number;
}): Promise<ComplianceRecord | null> {
  const res = await kycFetch(`${COMPLIANCE_KYC_URL}/api/v1/kyc/records`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customer_id: payload.customerId,
      full_name: payload.fullName,
      id_type: payload.idType,
      id_number: payload.idNumber,
      liveness_score: payload.livenessScore,
      document_confidence: payload.documentConfidence,
      status: "pending_review",
    }),
  });
  if (!res.ok) return null;
  const d = res.data as Record<string, unknown>;
  return {
    id: String(d.id ?? ""),
    customerId: String(d.customer_id ?? payload.customerId),
    status: String(d.status ?? "pending_review"),
  };
}
