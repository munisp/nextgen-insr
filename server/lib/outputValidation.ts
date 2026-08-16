// @ts-check
/**
 * Output Validation Middleware
 *
 * Provides runtime validation for API responses using Zod schemas.
 * Protects against:
 * - Data type mismatches between API contract and actual response
 * - Missing required fields
 * - Excessive data leakage (PII, sensitive fields)
 * - Response size limits
 *
 * Usage:
 *   const schema = z.object({
 *     id: z.number(),
 *     name: z.string(),
 *     balance: z.number().min(0),
 *   });
 *   const validated = validateResponse(schema, response, { maxSize: 1024 });
 */
import type { ZodSchema} from "zod";
import { z, ZodError } from "zod";

import { logger } from "../_core/logger";

export interface ValidationOptions {
  /** Maximum response size in bytes (default: 1MB) */
  maxSize?: number;
  /** Strip unknown fields instead of throwing (default: false) */
  stripUnknown?: boolean;
  /** Custom error handler */
  onError?: (error: ValidationError) => void;
}

export interface ValidationError {
  type: "schema" | "size" | "pii" | "timeout";
  message: string;
  details?: unknown;
  timestamp: Date;
}

const DEFAULT_MAX_SIZE = 1_048_576; // 1MB
const PII_PATTERNS = [
  /ssn\s*[:=]?\s*\w+/gi,
  /password\s*[:=]?\s*\S+/gi,
  /token\s*[:=]?\s*\S+/gi,
  /secret\s*[:=]?\s*\S+/gi,
  /api[_-]?key\s*[:=]?\s*\S+/gi,
];

/**
 * Validate a response against a Zod schema
 */
export function validateResponse<T extends ZodSchema>(
  schema: T,
  data: unknown,
  options: ValidationOptions = {}
): z.output<T> {
  const { maxSize = DEFAULT_MAX_SIZE, onError } = options;

  // Check response size
  const size = JSON.stringify(data).length;
  if (size > maxSize) {
    const error: ValidationError = {
      type: "size",
      message: `Response size ${size} bytes exceeds limit ${maxSize} bytes`,
      details: { size, maxSize },
      timestamp: new Date(),
    };
    logger.warn(
      { error },
      `[OutputValidation] Response too large: ${size} bytes`
    );
    onError?.(error);
    throw new RangeError(error.message);
  }

  // Check for PII/sensitive data leakage
  const responseStr = JSON.stringify(data);
  for (const pattern of PII_PATTERNS) {
    if (pattern.test(responseStr)) {
      const error: ValidationError = {
        type: "pii",
        message: "Potential PII/sensitive data detected in response",
        details: { pattern: pattern.source },
        timestamp: new Date(),
      };
      logger.error(
        { error },
        `[OutputValidation] Potential PII leakage detected`
      );
      onError?.(error);
      throw new Error(error.message);
    }
  }

  // Validate against schema
  try {
    const result = schema.parse(data);
    return result;
  } catch (err) {
    if (err instanceof ZodError) {
      const error: ValidationError = {
        type: "schema",
        message: "Response validation failed",
        details: err.issues,
        timestamp: new Date(),
      };
      logger.error(
        { error },
        `[OutputValidation] Schema validation failed: ${err.issues.map(e => e.message).join(", ")}`
      );
      onError?.(error);
      throw new Error(`Response validation failed: ${err.issues[0]?.message}`);
    }
    throw err;
  }
}

/**
 * Create a response validation middleware for tRPC routes
 */
export function createResponseValidator<T extends ZodSchema>(
  schema: T,
  options: ValidationOptions = {}
) {
  return function (result: unknown): z.output<T> {
    return validateResponse(schema, result, options);
  };
}

/**
 * Common validation schemas for reuse
 */
export const ValidationSchemas = {
  /** Standard paginated response */
  paginated: <T extends ZodSchema>(itemSchema: T) =>
    z.object({
      items: z.array(itemSchema),
      total: z.number(),
      page: z.number(),
      pageSize: z.number(),
      hasNext: z.boolean(),
    }),

  /** Standard API response wrapper */
  apiResponse: <T extends ZodSchema>(dataSchema: T) =>
    z.object({
      success: z.boolean(),
      data: dataSchema,
      message: z.string().optional(),
    }),

  /** Error response */
  errorResponse: z.object({
    success: z.literal(false),
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.unknown().optional(),
    }),
  }),
};

export default {
  validateResponse,
  createResponseValidator,
  ValidationSchemas,
};
