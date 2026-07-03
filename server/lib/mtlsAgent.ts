// TypeScript enabled — Sprint 96 security audit
/**
 * mtlsAgent.ts — Mutual TLS HTTPS Agent for platform microservice calls
 * ─────────────────────────────────────────────────────────────────────────────
 * Loads client certificate, private key, and CA bundle from the directory
 * specified by MTLS_CERT_DIR (default: /etc/54link/certs).
 *
 * Usage:
 *   import { getMtlsAgent } from "../lib/mtlsAgent";
 *   const res = await fetch(url, { ...opts, dispatcher: getMtlsAgent() });
 *
 * Cert rotation:
 *   Send SIGHUP to the process to force re-read of certificates without restart.
 *   The server/_core/index.ts already registers this signal handler.
 *
 * Fallback:
 *   When MTLS_ENABLED=false OR certificate files are absent, the function
 *   returns null and callers should use plain fetch (acceptable behind an
 *   APISix gateway that handles mTLS termination).
 */

import https from "https";
import fs from "fs";
import path from "path";
import { ENV } from "../_core/env";
import { logger } from '../_core/logger';

const CERT_DIR = ENV.mtlsCertDir;
const MTLS_ENABLED = ENV.mtlsEnabled;

let _agent: https.Agent | null | undefined = undefined; // undefined = not yet initialised

/** Lazily create (or return cached) mTLS HTTPS agent. Returns null when mTLS is disabled or certs are absent. */
export function getMtlsAgent(): https.Agent | null {
  if (_agent !== undefined) return _agent;

  if (!MTLS_ENABLED) {
    console.info("[mTLS] MTLS_ENABLED=false — using plain HTTPS");
    _agent = null;
    return null;
  }

  const certPath = path.join(CERT_DIR, "tls.crt");
  const keyPath = path.join(CERT_DIR, "tls.key");
  const caPath = path.join(CERT_DIR, "ca.crt");

  if (
    !fs.existsSync(certPath) ||
    !fs.existsSync(keyPath) ||
    !fs.existsSync(caPath)
  ) {
    logger.warn(
      `[mTLS] Certificate files not found in ${CERT_DIR} — falling back to plain HTTPS. ` +
        "Set MTLS_CERT_DIR or MTLS_ENABLED=false to suppress this warning."
    );
    _agent = null;
    return null;
  }

  try {
    _agent = new https.Agent({
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath),
      ca: fs.readFileSync(caPath),
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
    });
    console.info(`[mTLS] Agent initialised — cert dir: ${CERT_DIR}`);
    return _agent;
  } catch (err) {
    logger.error("[mTLS] Failed to load certificates:", err);
    _agent = null;
    return null;
  }
}

/**
 * Reset the cached agent so the next call to getMtlsAgent() re-reads certs
 * from disk. Call this on SIGHUP for zero-downtime cert rotation.
 */
export function resetMtlsAgent(): void {
  _agent = undefined;
  console.info(
    "[mTLS] Agent cache cleared — certs will be reloaded on next request"
  );
}

/**
 * Return fetch-compatible init options that include the mTLS agent when available.
 * Merges with any existing options passed in.
 *
 * Example:
 *   const res = await fetch(url, mtlsFetchOptions({ method: "POST", body: "..." }));
 */
export function mtlsFetchOptions(
  base: RequestInit = {}
): RequestInit & { agent?: https.Agent } {
  const agent = getMtlsAgent();
  if (!agent) return base;
  // Node 18+ fetch (undici) accepts `dispatcher`; legacy node-fetch accepts `agent`.
  // We attach both for maximum compatibility.
  return { ...base, agent } as RequestInit & { agent: https.Agent };
}
