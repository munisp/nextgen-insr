// 2026-10-03 (W8-B7): Redis test-instance guard. channel-core tests and the
// migrated bots' adapter tests run against a REAL Redis (no mocks on the
// state path). This guard makes a misconfigured env fail LOUDLY at test
// setup instead of flushing/touching a non-test instance: a test Redis URL
// is accepted only when it is
//   1. exactly equal to CHANNEL_CORE_TEST_REDIS_URL (explicit opt-in), or
//   2. a redis:// URL on a loopback host (127.0.0.1 / localhost / ::1) with
//      port 6399 (dedicated no-auth test instance) or 6379 (local dev
//      instance, auth in dev).
// Anything else (prod host, container hostname, Unix socket, unexpected
// port) throws before any command is issued.
export class TestRedisUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestRedisUrlError";
  }
}

const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const ALLOWED_PORTS = new Set(["6399", "6379"]);

/**
 * Validate a Redis URL intended for TEST use and return it unchanged.
 * Throws TestRedisUrlError with a loud message when the URL is not on the
 * test allowlist. Never silently rewrites the URL.
 */
export function assertTestRedisUrl(
  url: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  const explicit = (env.CHANNEL_CORE_TEST_REDIS_URL ?? "").trim();
  if (explicit) {
    if (url === explicit) return url;
    throw new TestRedisUrlError(
      `Refusing to run tests against Redis at ${JSON.stringify(url)}: ` +
        `CHANNEL_CORE_TEST_REDIS_URL is set to ${JSON.stringify(explicit)} ` +
        "and only that exact URL is permitted. Tests must never touch " +
        "another instance."
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new TestRedisUrlError(
      `Refusing to run tests against Redis URL ${JSON.stringify(url)}: ` +
        "not a parseable URL. Set CHANNEL_CORE_TEST_REDIS_URL to opt in to " +
        "a non-standard test instance."
    );
  }
  if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
    throw new TestRedisUrlError(
      `Refusing to run tests against Redis URL ${JSON.stringify(url)}: ` +
        `protocol ${JSON.stringify(parsed.protocol)} is not redis:/rediss:.`
    );
  }
  const port = parsed.port || "6379";
  if (!ALLOWED_HOSTS.has(parsed.hostname) || !ALLOWED_PORTS.has(port)) {
    throw new TestRedisUrlError(
      `Refusing to run tests against Redis at ${parsed.hostname}:${port} — ` +
        "only loopback 127.0.0.1/localhost on ports 6399 (test) or 6379 " +
        "(local dev) are allowed. Set CHANNEL_CORE_TEST_REDIS_URL to opt in " +
        "to a different disposable test instance. NEVER point tests at a " +
        "shared or production Redis."
    );
  }
  return url;
}
