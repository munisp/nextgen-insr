/**
 * Item 15: API versioning middleware
 * Adds /api/v1/ prefix support for all external endpoints.
 * Older /api/ routes are preserved for backward compatibility.
 */
import type { Request, Response, NextFunction } from "express";

const CURRENT_VERSION = "v1";
const CURRENT_API_VERSION = CURRENT_VERSION;
const SUPPORTED_VERSIONS = ["v1"];
const DEPRECATED_VERSIONS: string[] = [];

export function apiVersionMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const versionMatch = req.path.match(/^\/api\/(v\d+)\//);

  if (versionMatch) {
    const requestedVersion = versionMatch[1];
    if (!SUPPORTED_VERSIONS.includes(requestedVersion)) {
      res.status(400).json({
        error: "unsupported_api_version",
        message: `API version '${requestedVersion}' is not supported. Supported: ${SUPPORTED_VERSIONS.join(", ")}`,
        current: CURRENT_VERSION,
      });
      return;
    }
    (req as unknown as Record<string, unknown>).apiVersion = requestedVersion;
  } else if (req.path.startsWith("/api/")) {
    (req as unknown as Record<string, unknown>).apiVersion = CURRENT_VERSION;
  }

  // Set response headers: x-api-version for client version detection
  res.setHeader("X-API-Version", CURRENT_VERSION);
  res.setHeader("X-API-Supported-Versions", SUPPORTED_VERSIONS.join(", "));

  next();
}

export const apiVersioningMiddleware = apiVersionMiddleware;
export { CURRENT_VERSION, SUPPORTED_VERSIONS };
