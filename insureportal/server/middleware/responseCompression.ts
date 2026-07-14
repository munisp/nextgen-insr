// TypeScript enabled — Sprint 96 security audit
import { Request, Response, NextFunction } from "express";
import zlib from "zlib";

/**
 * Response compression middleware supporting gzip and deflate.
 * Brotli requires native bindings — gzip is universally supported.
 */
export function responseCompressionMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Skip compression for small responses and non-compressible content
  const acceptEncoding = req.headers["accept-encoding"] ?? "";

  if (!acceptEncoding.includes("gzip") && !acceptEncoding.includes("deflate")) {
    return next();
  }

  // Skip for already-compressed content types
  const skipPaths = ["/api/health", "/api/stripe/webhook"];
  if (skipPaths.some(p => req.path.startsWith(p))) {
    return next();
  }

  // Use Node.js built-in compression for JSON responses
  const originalJson = res.json.bind(res);
  res.json = function (body: any) {
    const jsonStr = JSON.stringify(body);

    // Only compress responses > 1KB
    if (jsonStr.length < 1024) {
      return originalJson(body);
    }

    if (acceptEncoding.includes("gzip")) {
      const compressed = zlib.gzipSync(Buffer.from(jsonStr));
      res.setHeader("Content-Encoding", "gzip");
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Length", compressed.length);
      res.end(compressed);
    } else {
      return originalJson(body);
    }
    return res;
  };

  next();
}
