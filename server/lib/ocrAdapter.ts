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
