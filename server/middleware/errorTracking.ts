// @ts-check

// TypeScript enabled — Sprint 96 security audit
import { Request, Response, NextFunction } from "express";
import { logger } from '../_core/logger';

interface ErrorLog {
  timestamp: string;
  requestId: string;
  method: string;
  path: string;
  error: string;
  stack?: string;
  userId?: number;
}

const recentErrors: ErrorLog[] = [];
const MAX_ERROR_BUFFER = 100;

export function errorTrackingMiddleware(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  const errorLog: ErrorLog = {
    timestamp: new Date().toISOString(),
    requestId: (req as any).requestId ?? "unknown",
    method: req.method,
    path: req.path,
    error: err.message,
    stack: process.env.NODE_ENV !== "production" ? err.stack : undefined,
    userId: (req as any).user?.id,
  };

  recentErrors.push(errorLog);
  if (recentErrors.length > MAX_ERROR_BUFFER) recentErrors.shift();

  logger.error("[ERROR_TRACK]: " + JSON.stringify(errorLog));

  // Don't swallow the error — pass to next handler
  next(err);
}

export function getRecentErrors(): ErrorLog[] {
  return [...recentErrors];
}

export function getErrorStats() {
  const now = Date.now();
  const last5min = recentErrors.filter(
    e => now - new Date(e.timestamp).getTime() < 5 * 60 * 1000
  );
  const last1hr = recentErrors.filter(
    e => now - new Date(e.timestamp).getTime() < 60 * 60 * 1000
  );
  return {
    total: recentErrors.length,
    last5Minutes: last5min.length,
    lastHour: last1hr.length,
    topPaths: Object.entries(
      last1hr.reduce(
        (acc, e) => {
          acc[e.path] = (acc[e.path] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      )
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5),
  };
}
