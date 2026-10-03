/**
 * domainAllowlist.ts — 2026-10-03 (W9-B6)
 *
 * JS-layer enforcement of the PINNED_DOMAINS allowlist. Previously
 * PINNED_DOMAINS (src/services/api.ts) was DECLARED but never enforced:
 * every fetch/axios call went to whatever URL the caller built. This module
 * makes the allowlist real at the JavaScript transport boundary:
 *
 *   - `assertUrlAllowed(url)` extracts the URL host and throws a loud error
 *     unless the host is EXACTLY one of the allowlisted hosts. Exact-match
 *     (case-insensitive, port stripped) means subdomain spoofs such as
 *     `api.insureportal.ng.evil.com`, `evil-api.insureportal.ng`, or
 *     `allowed.com.evil.com` are all rejected — fail-closed, no request is
 *     ever issued to a non-allowlisted host.
 *   - `guardedFetch` wraps global fetch: the guard runs BEFORE any network
 *     I/O, so a rejected host never touches the wire.
 *
 * Loopback/emulator hosts (127.0.0.1, localhost, 10.0.2.2) are allowed ONLY
 * behind __DEV__ — release builds can never reach a developer machine.
 *
 * !!! SCOPE — READ BEFORE RELYING ON THIS !!!
 * This is DOMAIN ALLOWLISTING, NOT certificate pinning. It prevents the app
 * from initiating requests to unexpected hosts, but it cannot detect a
 * TLS-intercepting proxy presenting a valid certificate for an allowlisted
 * host. TRUE certificate/public-key pinning (SHA-256 SPKI hashes for the
 * hosts below, with rotation pins) must be configured in the NATIVE layer
 * (e.g. TrustKit on iOS, network_security_config + OkHttp CertificatePinner
 * on Android) once ios/android native projects exist. That native work is a
 * recorded RESIDUAL item — see BUILD.md. Do not represent this JS guard as
 * TLS pinning to auditors.
 */

declare const __DEV__: boolean;

/** Production hosts the app may talk to. Single source of truth — api.ts
 *  re-exports this as PINNED_DOMAINS for backward compatibility. */
export const ALLOWED_DOMAINS = [
  'api.insureportal.ng',
  'auth.insureportal.ng',
  'api.54link.ng',
  'staging.54link.ng',
] as const;

const DEV_HOSTS = new Set(['127.0.0.1', 'localhost', '10.0.2.2', '[::1]']);

/** Extract the lowercase host (no port) from an absolute URL. Returns null
 *  for anything unparseable — callers treat null as NOT allowed. */
export function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    // URL.hostname strips the port and lowercases. Reject userinfo tricks
    // (https://allowed@evil.com parses to host=evil.com, which is correct —
    // the REAL destination host is what we check).
    return u.hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/** Is this host exactly allowlisted (or a loopback dev host behind __DEV__)? */
export function isAllowedHost(host: string | null): boolean {
  if (!host) return false;
  const h = host.toLowerCase();
  if ((ALLOWED_DOMAINS as readonly string[]).includes(h)) return true;
  // Loopback/emulator hosts are dev-only; in release builds they are
  // rejected like any other unknown host (fail-closed).
  if (__DEV__ && DEV_HOSTS.has(h)) return true;
  return false;
}

/**
 * Fail-closed guard: throws a loud error if `url`'s host is not allowlisted.
 * Must be called BEFORE any network I/O for the request.
 */
export function assertUrlAllowed(url: string, context: string = 'request'): void {
  const host = hostOf(url);
  if (!isAllowedHost(host)) {
    throw new Error(
      `[domainAllowlist] BLOCKED ${context} to non-allowlisted host "${host ?? String(url)}" — ` +
      `allowed hosts: ${ALLOWED_DOMAINS.join(', ')}. ` +
      `This is a fail-closed domain allowlist (NOT TLS certificate pinning).`,
    );
  }
}

/**
 * fetch wrapper enforcing the allowlist before any network I/O. All raw
 * fetch egress in this app must go through this (config.ts trpc transport,
 * offlineSync sync-push).
 */
export async function guardedFetch(
  url: string,
  init?: Parameters<typeof fetch>[1],
): Promise<Response> {
  assertUrlAllowed(url, 'fetch');
  return fetch(url, init);
}

/** Matches axios's isAbsoluteURL (axios/lib/helpers/isAbsoluteURL.js): a URL
 *  is absolute iff it has a scheme (scheme://) OR is protocol-relative (//).
 *  2026-10-03 (W9-B6 r2): this MUST mirror axios exactly — the old guard
 *  concatenated baseURL+url and parsed that, so `api.get('//evil.com/x')`
 *  passed (parsed host = baseURL's) while axios DISCARDED baseURL and sent
 *  the request (with the Bearer token attached by the next interceptor) to
 *  evil.com. Fail-open closed: the EFFECTIVE host is now what axios will
 *  actually dial. */
const AXIOS_ABSOLUTE_URL = /^([a-z][a-z0-9.+-]*:)?\/\//i;

/** Axios request-interceptor helper: resolves the EFFECTIVE request URL
 *  exactly as axios will (buildFullPath semantics) and throws (rejects the
 *  request) before the adapter runs. Fail-closed: anything unparseable is
 *  rejected. */
export function assertAxiosConfigAllowed(cfg: { baseURL?: string; url?: string }): void {
  const baseURL = cfg.baseURL ?? '';
  const url = cfg.url ?? '';
  let effective: string;
  if (AXIOS_ABSOLUTE_URL.test(url)) {
    // Absolute or protocol-relative: axios ignores baseURL — the destination
    // host comes from `url` alone. Protocol-relative URLs inherit the scheme
    // of the base the request would have used (per WHATWG URL parsing); give
    // hostOf a parseable absolute form. If baseURL itself is unparseable the
    // scheme defaults to https — the HOST check is unaffected either way.
    if (url.startsWith('//')) {
      const scheme = /^([a-z][a-z0-9.+-]*):/i.exec(baseURL)?.[1] ?? 'https';
      effective = `${scheme}:${url}`;
    } else {
      effective = url;
    }
  } else {
    // Relative: axios combines baseURL+url (combineURLs), so the effective
    // host is baseURL's host. Unparseable baseURL → hostOf null → reject.
    effective = `${baseURL}${url}` || baseURL;
  }
  assertUrlAllowed(effective, 'axios request');
}
