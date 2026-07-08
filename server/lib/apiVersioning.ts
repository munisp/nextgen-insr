// @ts-check

// TypeScript enabled — Sprint 96 security audit
/**
 * API Versioning Middleware
 *
 * Supports versioned API endpoints via:
 * - URL prefix: /api/v1/trpc, /api/v2/trpc
 * - Header: X-API-Version: 2
 * - Query param: ?api-version=2
 *
 * Current version: v1 (default)
 * Supported versions: v1
 */

export const CURRENT_API_VERSION = 1;
export const SUPPORTED_VERSIONS = [1];
export const DEPRECATED_VERSIONS: number[] = [];

interface VersionInfo {
  version: number;
  source: "url" | "header" | "query" | "default";
  deprecated: boolean;
  sunset?: string;
}

/**
 * Extract API version from request
 */
export function extractApiVersion(req: {
  path?: string;
  headers?: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
}): VersionInfo {
  // 1. URL prefix: /api/v2/trpc/...
  const urlMatch = req.path?.match(/\/api\/v(\d+)\//);
  if (urlMatch) {
    const version = parseInt(urlMatch[1], 10);
    return {
      version,
      source: "url",
      deprecated: DEPRECATED_VERSIONS.includes(version),
    };
  }

  // 2. Header: X-API-Version
  const headerVersion = req.headers?.["x-api-version"];
  if (headerVersion) {
    const version = parseInt(String(headerVersion), 10);
    if (!isNaN(version)) {
      return {
        version,
        source: "header",
        deprecated: DEPRECATED_VERSIONS.includes(version),
      };
    }
  }

  // 3. Query param: ?api-version=2
  const queryVersion = req.query?.["api-version"];
  if (queryVersion) {
    const version = parseInt(String(queryVersion), 10);
    if (!isNaN(version)) {
      return {
        version,
        source: "query",
        deprecated: DEPRECATED_VERSIONS.includes(version),
      };
    }
  }

  // Default
  return {
    version: CURRENT_API_VERSION,
    source: "default",
    deprecated: false,
  };
}

/**
 * Express middleware for API versioning
 */
export function apiVersionMiddleware() {
  return (req: any, res: any, next: any) => {
    const versionInfo = extractApiVersion(req);

    // Check if version is supported
    if (!SUPPORTED_VERSIONS.includes(versionInfo.version)) {
      return res.status(400).json({
        error: `API version ${versionInfo.version} is not supported`,
        supported: SUPPORTED_VERSIONS,
        current: CURRENT_API_VERSION,
      });
    }

    // Add deprecation headers
    if (versionInfo.deprecated) {
      res.setHeader("Deprecation", "true");
      res.setHeader("Sunset", versionInfo.sunset || "TBD");
      res.setHeader(
        "Link",
        `</api/v${CURRENT_API_VERSION}/trpc>; rel="successor-version"`
      );
    }

    // Add version info to response headers
    res.setHeader("X-API-Version", versionInfo.version);
    res.setHeader("X-API-Version-Source", versionInfo.source);

    // Attach to request for downstream use
    (req as any).apiVersion = versionInfo;

    next();
  };
}
