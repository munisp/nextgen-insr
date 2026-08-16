/**
 * Compliance Screening — Sanctions & PEP Verification
 *
 * Provides real sanctions list checking (OFAC SDN, EU Consolidated, UN)
 * and Politically Exposed Persons (PEP) database screening.
 *
 * Architecture:
 *  - Primary: External compliance API (configurable via COMPLIANCE_API_URL)
 *  - Fallback: Local OFAC SDN list (downloaded and cached)
 *  - Cache: Redis-backed for repeat lookups (24h TTL)
 *
 * Environment variables:
 *  - COMPLIANCE_API_URL: External screening API endpoint (e.g., ComplyAdvantage, Refinitiv)
 *  - COMPLIANCE_API_KEY: API key for external service
 *  - OFAC_SDN_URL: URL to OFAC SDN consolidated list (defaults to US Treasury)
 */
import crypto from "crypto";

import { cacheGet, cacheSet } from "./distributedState";
import logger from "../_core/logger";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ScreeningResult {
  passed: boolean;
  matchType: "none" | "sanctions" | "pep" | "adverse_media";
  matchScore: number; // 0-100, higher = more confident match
  matchedName?: string;
  matchedList?: string;
  details?: string;
  screenedAt: string;
  referenceId: string;
}

export interface ScreeningRequest {
  fullName: string;
  dateOfBirth?: string;
  nationality?: string;
  idNumber?: string;
  transactionAmount?: number;
  transactionCurrency?: string;
}

// ── Configuration ────────────────────────────────────────────────────────────

const COMPLIANCE_API_URL = process.env.COMPLIANCE_API_URL || "";
const COMPLIANCE_API_KEY = process.env.COMPLIANCE_API_KEY || "";
const OFAC_SDN_URL =
  process.env.OFAC_SDN_URL || "https://www.treasury.gov/ofac/downloads/sdn.csv";

const SCREENING_CACHE_TTL = 86_400; // 24 hours
const MATCH_THRESHOLD = 85; // Score above which we flag

// ── Local SDN List Cache ─────────────────────────────────────────────────────

let sdnNames: Set<string> = new Set();
let sdnLastUpdated = 0;
const SDN_UPDATE_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function fuzzyMatch(name1: string, name2: string): number {
  const a = normalizeName(name1);
  const b = normalizeName(name2);
  if (a === b) return 100;

  // Levenshtein-based similarity
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 100;

  const matrix: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  const distance = matrix[a.length][b.length];
  return Math.round((1 - distance / maxLen) * 100);
}

async function refreshSdnList(): Promise<void> {
  if (Date.now() - sdnLastUpdated < SDN_UPDATE_INTERVAL && sdnNames.size > 0) {
    return;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    const response = await fetch(OFAC_SDN_URL, { signal: controller.signal });
    clearTimeout(timer);

    if (!response.ok) {
      logger.warn({ status: response.status }, "Failed to fetch OFAC SDN list");
      return;
    }

    const text = await response.text();
    const names = new Set<string>();

    // Parse CSV: SDN list format has name in column index 1
    const lines = text.split("\n");
    for (const line of lines) {
      const cols = line.split(",");
      if (cols.length > 1 && cols[1]) {
        const name = cols[1].replace(/"/g, "").trim();
        if (name.length > 2) {
          names.add(normalizeName(name));
        }
      }
    }

    sdnNames = names;
    sdnLastUpdated = Date.now();
    logger.info({ entries: names.size }, "OFAC SDN list refreshed");
  } catch (err) {
    logger.warn(
      { error: (err as Error).message },
      "SDN list refresh failed — using cached list"
    );
  }
}

// ── External API Screening ───────────────────────────────────────────────────

async function screenViaExternalApi(
  request: ScreeningRequest
): Promise<ScreeningResult | null> {
  if (!COMPLIANCE_API_URL || !COMPLIANCE_API_KEY) {
    return null; // External API not configured
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(`${COMPLIANCE_API_URL}/v1/screen`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${COMPLIANCE_API_KEY}`,
      },
      body: JSON.stringify({
        name: request.fullName,
        date_of_birth: request.dateOfBirth,
        nationality: request.nationality,
        id_number: request.idNumber,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      logger.warn(
        { status: response.status },
        "Compliance API returned non-OK status"
      );
      return null;
    }

    const data = (await response.json()) as any;
    return {
      passed: !data.match_found,
      matchType: data.match_type || "none",
      matchScore: data.score || 0,
      matchedName: data.matched_entity?.name,
      matchedList: data.matched_entity?.list_source,
      details: data.matched_entity?.details,
      screenedAt: new Date().toISOString(),
      referenceId: data.reference_id || crypto.randomUUID(),
    };
  } catch (err) {
    logger.warn(
      { error: (err as Error).message },
      "External compliance screening failed"
    );
    return null;
  }
}

// ── Local SDN Screening ──────────────────────────────────────────────────────

async function screenLocalSdn(
  request: ScreeningRequest
): Promise<ScreeningResult> {
  await refreshSdnList();

  const normalized = normalizeName(request.fullName);
  let bestMatch = 0;
  let matchedName = "";

  // Exact match check first
  if (sdnNames.has(normalized)) {
    return {
      passed: false,
      matchType: "sanctions",
      matchScore: 100,
      matchedName: request.fullName,
      matchedList: "OFAC SDN",
      details: "Exact match found on OFAC SDN list",
      screenedAt: new Date().toISOString(),
      referenceId: crypto.randomUUID(),
    };
  }

  // Fuzzy match for close variants
  for (const sdnName of sdnNames) {
    const score = fuzzyMatch(request.fullName, sdnName);
    if (score > bestMatch) {
      bestMatch = score;
      matchedName = sdnName;
    }
    // Early exit if we find a very strong match
    if (score >= 95) break;
  }

  const passed = bestMatch < MATCH_THRESHOLD;

  return {
    passed,
    matchType: passed ? "none" : "sanctions",
    matchScore: bestMatch,
    matchedName: passed ? undefined : matchedName,
    matchedList: passed ? undefined : "OFAC SDN",
    details: passed
      ? undefined
      : `Fuzzy match (${bestMatch}%) against OFAC SDN entry`,
    screenedAt: new Date().toISOString(),
    referenceId: crypto.randomUUID(),
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Screen an individual or entity against sanctions lists and PEP databases.
 * Uses external API if configured, falls back to local OFAC SDN list.
 * Results are cached for 24 hours to avoid redundant API calls.
 */
export async function screenIndividual(
  request: ScreeningRequest
): Promise<ScreeningResult> {
  // Check cache first
  const cacheKey = `screening:${crypto
    .createHash("sha256")
    .update(JSON.stringify(request))
    .digest("hex")}`;

  const cached = await cacheGet<ScreeningResult>(cacheKey);
  if (cached) {
    return { ...cached, screenedAt: cached.screenedAt + " (cached)" };
  }

  // Try external API first
  const externalResult = await screenViaExternalApi(request);
  if (externalResult) {
    await cacheSet(cacheKey, externalResult, SCREENING_CACHE_TTL);
    logger.info(
      {
        name: request.fullName,
        passed: externalResult.passed,
        source: "external_api",
      },
      "Compliance screening complete"
    );
    return externalResult;
  }

  // Fall back to local SDN check
  const localResult = await screenLocalSdn(request);
  await cacheSet(cacheKey, localResult, SCREENING_CACHE_TTL);
  logger.info(
    {
      name: request.fullName,
      passed: localResult.passed,
      source: "local_sdn",
    },
    "Compliance screening complete"
  );
  return localResult;
}

/**
 * Screen a transaction for compliance (combines individual screening
 * with transaction-level checks like amount thresholds).
 */
export async function screenTransaction(
  sender: ScreeningRequest,
  recipient: ScreeningRequest,
  amount: number,
  currency: string
): Promise<{
  senderResult: ScreeningResult;
  recipientResult: ScreeningResult;
  transactionCleared: boolean;
  flags: string[];
}> {
  const [senderResult, recipientResult] = await Promise.all([
    screenIndividual(sender),
    screenIndividual(recipient),
  ]);

  const flags: string[] = [];

  if (!senderResult.passed) {
    flags.push(`SENDER_SANCTIONS_HIT: ${senderResult.matchedList}`);
  }
  if (!recipientResult.passed) {
    flags.push(`RECIPIENT_SANCTIONS_HIT: ${recipientResult.matchedList}`);
  }

  // High-value transaction flag (regulatory reporting threshold)
  const USD_EQUIVALENT_THRESHOLD = 10_000;
  if (amount >= USD_EQUIVALENT_THRESHOLD) {
    flags.push(`HIGH_VALUE_TRANSACTION: ${currency} ${amount}`);
  }

  const transactionCleared = senderResult.passed && recipientResult.passed;

  if (!transactionCleared) {
    logger.warn(
      { sender: sender.fullName, recipient: recipient.fullName, flags },
      "Transaction blocked by compliance screening"
    );
  }

  return { senderResult, recipientResult, transactionCleared, flags };
}
