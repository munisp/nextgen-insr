/**
 * Environment Validation — Production Readiness Guard
 *
 * Validates that critical environment variables are set in production.
 * In development mode, generates ephemeral secrets and logs warnings.
 * This prevents deploying with hardcoded/default credentials.
 */
import crypto from "crypto";

import logger from "../_core/logger";

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

interface EnvRule {
  name: string;
  required: boolean;
  category: "security" | "database" | "service" | "observability";
  description: string;
}

const CRITICAL_ENV_VARS: EnvRule[] = [
  {
    name: "JWT_SECRET",
    required: true,
    category: "security",
    description: "JWT signing secret (min 32 chars)",
  },
  {
    name: "DATABASE_URL",
    required: true,
    category: "database",
    description: "PostgreSQL connection string",
  },
  {
    name: "CRON_SECRET",
    required: true,
    category: "security",
    description: "Shared secret for cron/scheduler API calls (min 32 chars)",
  },
  {
    name: "INTERNAL_API_KEY",
    required: true,
    category: "security",
    description: "Service-to-service auth key (X-Internal-Key header)",
  },
  {
    name: "TX_SIGNING_SECRET",
    required: true,
    category: "security",
    description: "HMAC secret for transaction payload signing",
  },
  {
    name: "KAFKA_BROKERS",
    required: false,
    category: "service",
    description: "Kafka broker addresses",
  },
  {
    name: "REDIS_URL",
    required: false,
    category: "service",
    description: "Redis connection URL",
  },
  {
    name: "OTEL_EXPORTER_OTLP_ENDPOINT",
    required: false,
    category: "observability",
    description: "OpenTelemetry collector endpoint",
  },
  {
    name: "KEYCLOAK_CLIENT_SECRET",
    required: true,
    category: "security",
    description: "Keycloak OIDC client secret",
  },
  {
    name: "VAULT_ROLE_ID",
    required: false,
    category: "security",
    description: "HashiCorp Vault role ID",
  },
  {
    name: "PLATFORM_API_KEY",
    required: true,
    category: "security",
    description: "Platform API authentication key",
  },
  {
    name: "PLATFORM_SERVICE_TOKEN",
    required: true,
    category: "security",
    description: "Platform service-to-service token",
  },
  {
    name: "MINIO_SECRET_KEY",
    required: true,
    category: "security",
    description: "MinIO object storage secret key",
  },
  {
    name: "APISIX_ADMIN_KEY",
    required: true,
    category: "security",
    description: "APISIX API gateway admin key",
  },
  {
    name: "TERMII_API_KEY",
    required: true,
    category: "security",
    description: "Termii SMS/voice API key",
  },
  {
    name: "FLUVIO_API_KEY",
    required: true,
    category: "security",
    description: "Fluvio streaming API key",
  },
  {
    name: "MQTT_PASSWORD",
    required: true,
    category: "security",
    description: "MQTT broker authentication password",
  },
  {
    name: "MINIO_ACCESS_KEY",
    required: true,
    category: "security",
    description: "MinIO object storage access key",
  },
];

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  generatedSecrets: Record<string, string>;
}

/**
 * Validate environment variables at startup.
 * In production: throws if critical vars are missing.
 * In development: generates ephemeral secrets and warns.
 */
export function validateEnvironment(): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
    generatedSecrets: {},
  };

  for (const rule of CRITICAL_ENV_VARS) {
    const value = process.env[rule.name];
    const isEmpty = !value || value.trim() === "";

    if (isEmpty && rule.required) {
      if (isProduction()) {
        result.errors.push(
          `[${rule.category}] Missing required env var: ${rule.name} — ${rule.description}`
        );
        result.valid = false;
      } else {
        // Generate ephemeral secret for development
        if (rule.category === "security") {
          const generated = crypto.randomBytes(32).toString("hex");
          result.generatedSecrets[rule.name] = generated;
          process.env[rule.name] = generated;
          result.warnings.push(
            `[${rule.category}] ${rule.name} not set — generated ephemeral dev secret`
          );
        } else {
          result.warnings.push(
            `[${rule.category}] ${rule.name} not set — feature may be limited`
          );
        }
      }
    }

    // Validate JWT_SECRET minimum length
    if (
      rule.name === "JWT_SECRET" &&
      value &&
      value.length < 32 &&
      isProduction()
    ) {
      result.errors.push(
        `[security] JWT_SECRET must be at least 32 characters in production (got ${value.length})`
      );
      result.valid = false;
    }
  }

  // Check for known hardcoded dev secrets that should NOT be in production
  const HARDCODED_PATTERNS = [
    "posinsureportal-secret",
    "posinsureportal-dev-secret",
    "insureportal-dev",
    "insureportal-platform-dev",
    "insureportal-service-token-dev",
    "insureportal-keycloak-dev",
    "insureportal_minio_dev",
    "insureportal-apisix-dev",
    "insureportal-fluvio-dev",
    "insureportal_mqtt_dev",
    "TLtest_insureportal",
    "insureportal_admin",
    "change-in-prod",
    "change-in-production",
  ];

  if (isProduction()) {
    const secretVars = [
      "JWT_SECRET",
      "KEYCLOAK_CLIENT_SECRET",
      "PLATFORM_API_KEY",
      "PLATFORM_SERVICE_TOKEN",
      "APISIX_ADMIN_KEY",
      "CRON_SECRET",
      "INTERNAL_API_KEY",
      "TX_SIGNING_SECRET",
      "MINIO_SECRET_KEY",
      "MINIO_ACCESS_KEY",
      "TERMII_API_KEY",
      "FLUVIO_API_KEY",
      "MQTT_PASSWORD",
    ];
    for (const varName of secretVars) {
      const val = process.env[varName] ?? "";
      for (const pattern of HARDCODED_PATTERNS) {
        if (val.includes(pattern)) {
          result.errors.push(
            `[security] ${varName} contains dev placeholder "${pattern}" — must use real secret in production`
          );
          result.valid = false;
        }
      }
    }
  }

  return result;
}

/**
 * Run validation and log results. Call at server startup.
 */
export function enforceEnvironment(): void {
  const result = validateEnvironment();

  for (const warning of result.warnings) {
    logger.warn(warning);
  }

  if (!result.valid) {
    for (const error of result.errors) {
      logger.error(error);
    }
    if (isProduction()) {
      logger.error(
        "FATAL: Environment validation failed — refusing to start in production with insecure configuration"
      );
      process.exit(1);
    }
  }

  if (Object.keys(result.generatedSecrets).length > 0) {
    logger.info(
      { generated: Object.keys(result.generatedSecrets) },
      "Dev mode: generated ephemeral secrets"
    );
  }

  logger.info(
    { production: isProduction(), valid: result.valid },
    "Environment validation complete"
  );
}

/**
 * Get JWT secret — never returns hardcoded default in production.
 * In dev, returns generated ephemeral secret if JWT_SECRET env var is empty.
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.trim() === "") {
    if (isProduction()) {
      throw new Error("JWT_SECRET is required in production");
    }
    // Dev fallback: generate and cache
    const ephemeral = crypto.randomBytes(32).toString("hex");
    process.env.JWT_SECRET = ephemeral;
    return ephemeral;
  }
  return secret;
}

/**
 * Get cron/scheduler secret — never returns hardcoded default in production.
 */
export function getCronSecret(): string {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.trim() === "") {
    if (isProduction()) {
      throw new Error("CRON_SECRET is required in production");
    }
    const ephemeral = crypto.randomBytes(32).toString("hex");
    process.env.CRON_SECRET = ephemeral;
    return ephemeral;
  }
  return secret;
}

/**
 * Get internal API key — never returns hardcoded default in production.
 */
export function getInternalApiKey(): string {
  const secret = process.env.INTERNAL_API_KEY;
  if (!secret || secret.trim() === "") {
    if (isProduction()) {
      throw new Error("INTERNAL_API_KEY is required in production");
    }
    const ephemeral = crypto.randomBytes(32).toString("hex");
    process.env.INTERNAL_API_KEY = ephemeral;
    return ephemeral;
  }
  return secret;
}

/**
 * Get transaction signing secret — never returns hardcoded default in production.
 */
export function getTxSigningSecret(): string {
  const secret = process.env.TX_SIGNING_SECRET;
  if (!secret || secret.trim() === "") {
    if (isProduction()) {
      throw new Error("TX_SIGNING_SECRET is required in production");
    }
    const ephemeral = crypto.randomBytes(32).toString("hex");
    process.env.TX_SIGNING_SECRET = ephemeral;
    return ephemeral;
  }
  return secret;
}
