/**
 * Environment Variable Validation — Fail-fast startup checks
 *
 * Validates that critical environment variables are set before the server
 * starts accepting requests. Missing required vars cause an immediate exit
 * with a clear error message listing all missing variables.
 *
 * Usage: import and call validateEnv() at the top of your server entry point.
 */
import { ENV } from "./env.js";
import { logger } from "./logger.js";

interface EnvRule {
  name: string;
  value: string | undefined;
  required: boolean;
  description: string;
  pattern?: RegExp;
  warnIfDefault?: string;
}

const rules: EnvRule[] = [
  // Critical — server cannot function without these
  {
    name: "POSTGRES_URL",
    value: ENV.postgresUrl,
    required: true,
    description: "PostgreSQL connection string",
  },
  {
    name: "JWT_SECRET",
    value: ENV.cookieSecret,
    required: true,
    description: "Cookie/JWT signing secret",
    warnIfDefault: "posinsureportal-dev-secret-change-in-prod",
  },

  // Important — features degrade without these
  {
    name: "REDIS_URL",
    value: ENV.redisUrl,
    required: false,
    description: "Redis connection URL",
    warnIfDefault: "redis://redis:6379",
  },
  {
    name: "KEYCLOAK_URL",
    value: ENV.keycloakUrl,
    required: false,
    description: "Keycloak OIDC URL",
  },
  {
    name: "KEYCLOAK_CLIENT_SECRET",
    value: ENV.keycloakClientSecret,
    required: false,
    description: "Keycloak client secret",
    warnIfDefault: "insureportal-keycloak-dev-secret",
  },
  {
    name: "PLATFORM_API_KEY",
    value: ENV.platformApiKey,
    required: false,
    description: "Platform API key",
    warnIfDefault: "insureportal-platform-dev-api-key",
  },
  {
    name: "INTERNAL_API_KEY",
    value: ENV.internalApiKey,
    required: false,
    description: "Internal service-to-service key",
    warnIfDefault: "insureportal-internal-dev-key-change-in-prod",
  },
  {
    name: "CRON_SECRET",
    value: ENV.cronSecret,
    required: false,
    description: "Cron/scheduler shared secret",
    warnIfDefault: "insureportal-cron-dev-secret-change-in-prod",
  },

  // Kafka
  {
    name: "KAFKA_BROKERS",
    value: ENV.kafkaBrokers,
    required: false,
    description: "Kafka broker addresses",
  },

  // Temporal
  {
    name: "TEMPORAL_ADDRESS",
    value: ENV.temporalAddress,
    required: false,
    description: "Temporal workflow engine address",
  },

  // Observability
  {
    name: "OTEL_EXPORTER_OTLP_ENDPOINT",
    value: ENV.otelEndpoint,
    required: false,
    description: "OpenTelemetry collector endpoint",
  },
];

/**
 * Validate environment variables at startup.
 * In production: missing required vars → process.exit(1)
 * In development: missing required vars → warning only
 * Default dev credentials → warning in all environments
 */
export function validateEnv(): void {
  const isProduction = ENV.isProduction;
  const missing: string[] = [];
  const warnings: string[] = [];

  for (const rule of rules) {
    // Check required vars
    if (rule.required && (!rule.value || rule.value.trim() === "")) {
      missing.push(`  ${rule.name}: ${rule.description}`);
    }

    // Check for default dev credentials in production
    if (rule.warnIfDefault && rule.value === rule.warnIfDefault) {
      warnings.push(
        `  ${rule.name}: using default dev value — override in production Secrets panel`
      );
    }

    // Check pattern if provided
    if (rule.pattern && rule.value && !rule.pattern.test(rule.value)) {
      warnings.push(
        `  ${rule.name}: value does not match expected pattern ${rule.pattern}`
      );
    }
  }

  // Log warnings
  if (warnings.length > 0) {
    logger.warn(
      { warnings },
      `[env-validation] ${warnings.length} environment warning(s):\n${warnings.join("\n")}`
    );
  }

  // Handle missing required vars
  if (missing.length > 0) {
    const msg = `[env-validation] ${missing.length} required environment variable(s) missing:\n${missing.join("\n")}`;
    if (isProduction) {
      logger.fatal({ missing }, msg);
      process.exit(1);
    } else {
      logger.warn(
        { missing },
        `${msg}\n  (non-fatal in development — server will start with defaults)`
      );
    }
  }

  logger.info(
    `[env-validation] Environment validated — ${rules.length} rules checked, ${missing.length} missing, ${warnings.length} warnings`
  );
}
