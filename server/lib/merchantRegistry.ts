/**
 * merchantRegistry.ts — G1 fix-wave (audit HIGH-8, 2026-06)
 *
 * Real CAC (Corporate Affairs Commission) and FIRS TIN verification.
 * Presence of an rcNumber/tinNumber string is NOT verification:
 *
 *   - When MERCHANT_REGISTRY_VERIFY is explicitly disabled (test runners,
 *     see below) the call returns { status: "skipped" } and callers must
 *     persist verified=false — never auto-verify.
 *   - Production posture is FAIL-LOUD: if a registry number is supplied but
 *     the provider URL is not configured, or the provider call fails, this
 *     throws RegistryVerificationUnavailableError and the onboarding write
 *     must be aborted (HTTP 503-class), not silently stored as "verified".
 *
 * Test-runner-aware: under VITEST / NODE_ENV=test the external provider call
 * is skipped unless MERCHANT_REGISTRY_VERIFY=1 is set explicitly.
 */
import { TRPCError } from "@trpc/server";

import { logger } from "../_core/logger";

export interface RegistryCheckResult {
  status: "verified" | "rejected" | "skipped";
  providerRef?: string;
  detail?: string;
}

const CAC_API_URL = process.env.CAC_API_URL ?? "";
const CAC_API_KEY = process.env.CAC_API_KEY ?? "";
const FIRS_TIN_API_URL = process.env.FIRS_TIN_API_URL ?? "";
const FIRS_TIN_API_KEY = process.env.FIRS_TIN_API_KEY ?? "";

function isTestRunner(): boolean {
  return (
    typeof process.env.VITEST !== "undefined" ||
    process.env.NODE_ENV === "test"
  );
}

function registryVerifyEnabled(): boolean {
  if (process.env.MERCHANT_REGISTRY_VERIFY === "0") return false;
  if (isTestRunner() && process.env.MERCHANT_REGISTRY_VERIFY !== "1")
    return false;
  return true;
}

export class RegistryVerificationUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistryVerificationUnavailableError";
  }
}

async function callProvider(
  url: string,
  apiKey: string,
  payload: Record<string, string>
): Promise<{ verified: boolean; providerRef?: string; detail?: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) {
    throw new RegistryVerificationUnavailableError(
      `registry provider returned HTTP ${res.status}`
    );
  }
  const json = (await res.json()) as {
    verified?: boolean;
    status?: string;
    reference?: string;
    name?: string;
  };
  return {
    verified: json.verified === true || json.status === "verified",
    providerRef: json.reference,
    detail: json.name,
  };
}

/**
 * Verify a CAC RC number. Fail-loud: throws
 * RegistryVerificationUnavailableError when the check cannot actually run in
 * an enabled (non-test) environment.
 */
export async function verifyCacNumber(
  rcNumber: string
): Promise<RegistryCheckResult> {
  if (!registryVerifyEnabled()) {
    return { status: "skipped", detail: "registry verification not enabled" };
  }
  if (!CAC_API_URL) {
    logger.error(
      "[merchantRegistry] CAC_API_URL not configured — failing loud (no presence-based verification)"
    );
    throw new RegistryVerificationUnavailableError(
      "CAC verification provider not configured (CAC_API_URL)"
    );
  }
  const out = await callProvider(CAC_API_URL, CAC_API_KEY, {
    rcNumber,
  }).catch(err => {
    if (err instanceof RegistryVerificationUnavailableError) throw err;
    throw new RegistryVerificationUnavailableError(
      `CAC verification call failed: ${err instanceof Error ? err.message : String(err)}`
    );
  });
  return {
    status: out.verified ? "verified" : "rejected",
    providerRef: out.providerRef,
    detail: out.detail,
  };
}

/** Verify a FIRS TIN. Same fail-loud contract as verifyCacNumber. */
export async function verifyTinNumber(
  tin: string
): Promise<RegistryCheckResult> {
  if (!registryVerifyEnabled()) {
    return { status: "skipped", detail: "registry verification not enabled" };
  }
  if (!FIRS_TIN_API_URL) {
    logger.error(
      "[merchantRegistry] FIRS_TIN_API_URL not configured — failing loud (no presence-based verification)"
    );
    throw new RegistryVerificationUnavailableError(
      "TIN verification provider not configured (FIRS_TIN_API_URL)"
    );
  }
  const out = await callProvider(FIRS_TIN_API_URL, FIRS_TIN_API_KEY, {
    tin,
  }).catch(err => {
    if (err instanceof RegistryVerificationUnavailableError) throw err;
    throw new RegistryVerificationUnavailableError(
      `TIN verification call failed: ${err instanceof Error ? err.message : String(err)}`
    );
  });
  return {
    status: out.verified ? "verified" : "rejected",
    providerRef: out.providerRef,
    detail: out.detail,
  };
}

/** Map the fail-loud error onto an honest 503-class tRPC failure. */
export function registryUnavailableTrpcError(err: unknown): TRPCError {
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: `Registry verification unavailable: ${err instanceof Error ? err.message : String(err)}. Registration cannot proceed without a real CAC/TIN check.`,
  });
}
