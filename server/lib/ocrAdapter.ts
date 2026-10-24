/**
 * ocrAdapter.ts — Q4 health & retention wave (2026-09-25)
 *
 * OCR hook for the one-tap photo reimbursement flow. Configurable, REAL HTTP
 * (via the shared resilient client — timeout + circuit breaker), and HONEST:
 *
 *  - Not configured  -> { status: "unavailable", mode: "manual_entry" }.
 *    Staff enter amounts manually; the reimbursement row carries
 *    ocrStatus="manual_entry" as a DISCLOSED fallback. No fake OCR results.
 *  - Provider error  -> { status: "unavailable", mode: "manual_entry", reason }
 *    (the flow degrades to manual entry; nothing is fabricated).
 *  - Success         -> { status: "completed", fields } where fields are the
 *    provider's real extracted values, stored verbatim in ocrExtracted.
 *
 * Configuration (env):
 *  - OCR_PROVIDER_URL   receipt-OCR endpoint (POST {fileKey, mimeType?})
 *  - OCR_API_KEY        bearer credential
 *  - OCR_TIMEOUT_MS     per-request timeout (default 8000; OCR is slower)
 */
import { resilientFetch } from "./resilientFetch";
import logger from "../_core/logger";

const SERVICE_NAME = "receipt-ocr";
/** 2026-10-25 (W11-B4c-1): separate breaker namespace for bill-scan OCR. */
const BILL_SCAN_SERVICE_NAME = "bill-scan-ocr";

export type OcrResult =
  | { status: "completed"; fields: Record<string, unknown> }
  | { status: "unavailable"; mode: "manual_entry"; reason: string };

interface OcrConfig {
  url: string;
  apiKey: string;
  timeoutMs: number;
}

export function getOcrConfig(): OcrConfig | null {
  const url = process.env.OCR_PROVIDER_URL?.trim();
  const apiKey = process.env.OCR_API_KEY?.trim();
  if (!url || !apiKey) return null;
  return {
    url,
    apiKey,
    timeoutMs: Number(process.env.OCR_TIMEOUT_MS ?? 8_000) || 8_000,
  };
}

export function isOcrConfigured(): boolean {
  return getOcrConfig() !== null;
}

/**
 * Extract receipt fields for an uploaded document. NEVER fabricates fields:
 * unconfigured/failing providers yield the disclosed manual_entry fallback.
 */
export async function extractReceiptFields(input: {
  fileKey: string;
  mimeType?: string;
}): Promise<OcrResult> {
  const cfg = getOcrConfig();
  if (!cfg) {
    return {
      status: "unavailable",
      mode: "manual_entry",
      reason:
        "OCR provider not configured (OCR_PROVIDER_URL/OCR_API_KEY); staff manual entry required. This is a disclosed fallback, not an OCR result.",
    };
  }
  try {
    const res = await resilientFetch<{ fields?: unknown }>(
      cfg.url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          fileKey: input.fileKey,
          mimeType: input.mimeType ?? null,
        }),
      },
      { serviceName: SERVICE_NAME, timeoutMs: cfg.timeoutMs }
    );
    if (
      res &&
      typeof res === "object" &&
      res.fields &&
      typeof res.fields === "object"
    ) {
      return {
        status: "completed",
        fields: res.fields as Record<string, unknown>,
      };
    }
    return {
      status: "unavailable",
      mode: "manual_entry",
      reason:
        "OCR provider response had no fields payload; manual entry required.",
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.warn(
      { service: SERVICE_NAME, err: reason },
      "OCR extraction failed — disclosed manual-entry fallback"
    );
    return {
      status: "unavailable",
      mode: "manual_entry",
      reason: `OCR extraction failed (${reason}); staff manual entry required.`,
    };
  }
}

// ── Bill-scan extraction (W11-B4c-1, 2026-10-25) ────────────────────────────

/**
 * The bill-scan extraction payload the router consumes. Everything is
 * optional: the provider may legitimately read only part of a bill, and the
 * router NEVER fills gaps with guesses.
 */
export interface BillScanFields {
  /** Free-text biller name/code as printed on the bill (e.g. "Ikeja Electric"). */
  biller?: string;
  /** Meter / smartcard / customer number (digits). */
  customerNumber?: string;
  /** Amount in kobo — only when the provider actually read it. */
  amountKobo?: number;
  /** Provider-reported confidence in [0, 1]. */
  confidence?: number;
}

export type BillScanResult =
  | { status: "completed"; fields: BillScanFields }
  | { status: "unavailable"; mode: "manual_entry"; reason: string };

/**
 * Extract bill fields from an IN-MEMORY base64 image for the member
 * bill-scan prefill flow. Same honesty contract as extractReceiptFields:
 * unconfigured/failing providers yield the disclosed manual_entry fallback;
 * fields are passed through verbatim after type validation — never
 * fabricated, never guessed.
 *
 * PII DISCIPLINE: the image and the extracted customerNumber are NEVER
 * logged and NEVER persisted here — processing is in-memory only.
 */
export async function extractBillFields(input: {
  imageBase64: string;
  rail: "bill" | "airtime";
}): Promise<BillScanResult> {
  const cfg = getOcrConfig();
  if (!cfg) {
    return {
      status: "unavailable",
      mode: "manual_entry",
      reason:
        "OCR provider not configured (OCR_PROVIDER_URL/OCR_API_KEY); member manual entry required. This is a disclosed fallback, not an OCR result.",
    };
  }
  try {
    const res = await resilientFetch<{ fields?: unknown }>(
      cfg.url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          // Bill-specific extraction target: the rail scopes which fields
          // the provider is asked to read.
          imageBase64: input.imageBase64,
          rail: input.rail,
          extractionSchema: ["biller", "customerNumber", "amountKobo", "confidence"],
        }),
      },
      { serviceName: BILL_SCAN_SERVICE_NAME, timeoutMs: cfg.timeoutMs }
    );
    if (
      !res ||
      typeof res !== "object" ||
      !res.fields ||
      typeof res.fields !== "object"
    ) {
      return {
        status: "unavailable",
        mode: "manual_entry",
        reason:
          "OCR provider response had no fields payload; manual entry required.",
      };
    }
    const raw = res.fields as Record<string, unknown>;
    const fields: BillScanFields = {};
    if (typeof raw.biller === "string" && raw.biller.trim().length > 0) {
      fields.biller = raw.biller.trim().slice(0, 120);
    }
    if (
      typeof raw.customerNumber === "string" &&
      /^\d{5,13}$/.test(raw.customerNumber.trim())
    ) {
      fields.customerNumber = raw.customerNumber.trim();
    }
    if (
      typeof raw.amountKobo === "number" &&
      Number.isInteger(raw.amountKobo) &&
      raw.amountKobo > 0
    ) {
      fields.amountKobo = raw.amountKobo;
    }
    if (
      typeof raw.confidence === "number" &&
      Number.isFinite(raw.confidence) &&
      raw.confidence >= 0 &&
      raw.confidence <= 1
    ) {
      fields.confidence = raw.confidence;
    }
    return { status: "completed", fields };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    // NEVER log the image or extracted PII — the error message only.
    logger.warn(
      { service: BILL_SCAN_SERVICE_NAME, err: reason },
      "Bill-scan OCR failed — disclosed manual-entry fallback"
    );
    return {
      status: "unavailable",
      mode: "manual_entry",
      reason: `Bill-scan OCR failed (${reason}); manual entry required.`,
    };
  }
}
