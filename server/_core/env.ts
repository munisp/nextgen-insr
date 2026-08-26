// PCI-DSS REQ 4 NOTE: Internal service URLs (http://) are for intra-cluster
// communication within the Kubernetes network. All external-facing traffic
// is encrypted via TLS at the APISIX gateway layer. Internal cluster
// communication is secured via mTLS (zero-trust-network service).
// See: infra/apisix/config.yaml (TLS termination) and k8s/network-policies.yaml
// @ts-check
/**
 * env.ts — Centralised environment variable registry
 * Every env var consumed by the server MUST be declared here.
 *
 * CRITICAL: No hardcoded credential defaults. Sensitive values must be
 * provided via Vault or environment variables at runtime. Dev/test
 * services should set minimal required variables only.
 *
 * Default URLs follow the InsurePortal Docker Compose service name convention:
 *   http://<service>:<port>  — internal Docker network (production default)
 *   https://<service>.insureportal.io  — public-facing microservices
 *   https://api.insureportal.io        — APISix gateway
 *   https://auth.insureportal.io       — Keycloak OIDC
 *   mqtt://broker.insureportal.io:1883 — MQTT broker (TLS: 8883)
 */

// ── Helper: required env var with suspicious-value detection ────────────────

/**
 * Returns the value of a required environment variable, or throws.
 * Also rejects values that look like placeholders or default examples.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  // Reject values that look like they were never replaced
  const suspiciousPatterns = [
    "change-me",
    "change_in_prod",
    "dev-",
    "test-",
    "demo-",
    "example-",
    "placeholder",
  ];
  for (const pattern of suspiciousPatterns) {
    if (value.toLowerCase().includes(pattern.toLowerCase())) {
      throw new Error(
        `Environment variable ${name} contains suspicious default value: ${value}`
      );
    }
  }
  return value;
}

/**
 * Returns the value of an optional environment variable with a safe default.
 * Use only for non-sensitive configuration (hostnames, ports, feature flags).
 */
function optEnv(name: string, defaultValue: string): string;
function optEnv(name: string): string | undefined;
function optEnv(name: string, defaultValue?: string): string | undefined {
  return process.env[name] ?? defaultValue;
}

export const ENV = {
  // ── Manus Platform ──────────────────────────────────────────────────────────
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  postgresUrl: process.env.POSTGRES_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  port: parseInt(process.env.PORT ?? "3000", 10),
  apiVersion: process.env.API_VERSION ?? "1.0.0",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",

  // ── Redis ───────────────────────────────────────────────────────────────────
  redisUrl: optEnv("REDIS_URL", "redis://redis:6379"),

  // ── Kafka ───────────────────────────────────────────────────────────────────
  kafkaBrokers: optEnv("KAFKA_BROKERS", "kafka:9092"),
  kafkaClientId: optEnv("KAFKA_CLIENT_ID", "insurance-portal"),
  kafkaEnabled: optEnv("KAFKA_ENABLED", "false"),
  kafkaSsl: optEnv("KAFKA_SSL", "false"),
  kafkaSaslUsername: process.env.KAFKA_SASL_USERNAME ?? "",
  kafkaSaslPassword: process.env.KAFKA_SASL_PASSWORD ?? "",

  // ── TigerBeetle sidecar ─────────────────────────────────────────────────────
  tbSidecarUrl: optEnv("TB_SIDECAR_URL", "http://tigerbeetle-sidecar:8080"),

  // ── Platform APISix gateway ─────────────────────────────────────────────────
  platformBaseUrl: optEnv("PLATFORM_BASE_URL", "http://apisix:9080"),
  platformApiKey: requireEnv("PLATFORM_API_KEY"),
  platformServiceToken: requireEnv("PLATFORM_SERVICE_TOKEN"),

  // ── Keycloak OIDC ───────────────────────────────────────────────────────────
  keycloakUrl: optEnv("KEYCLOAK_URL", "http://keycloak:8080"),
  keycloakRealm: optEnv("KEYCLOAK_REALM", "insureportal"),
  keycloakClientId: optEnv("KEYCLOAK_CLIENT_ID", "insurance-portal"),
  keycloakClientSecret: requireEnv("KEYCLOAK_CLIENT_SECRET"),

  // ── Temporal workflow engine ─────────────────────────────────────────────────
  temporalAddress: optEnv("TEMPORAL_ADDRESS", "temporal:7233"),
  temporalNamespace: optEnv("TEMPORAL_NAMESPACE", "insureportal-production"),
  temporalTaskQueue: optEnv("TEMPORAL_TASK_QUEUE", "settlement-queue"),

  // ── HashiCorp Vault ──────────────────────────────────────────────────────────
  vaultAddr: optEnv("VAULT_ADDR", "http://vault:8200"),
  vaultRoleId: process.env.VAULT_ROLE_ID ?? "",
  vaultSecretId: process.env.VAULT_SECRET_ID ?? "",
  vaultSecretPath: optEnv("VAULT_SECRET_PATH", "secret/data/insurance-portal-demo"),

  // ── Permify authorization service ───────────────────────────────────────────
  permifyUrl: optEnv("PERMIFY_URL", "http://permify:3476"),
  permifyTenantId: optEnv("PERMIFY_TENANT_ID", "t1"),

  // ── MinIO / Lakehouse ────────────────────────────────────────────────────────
  minioEndpoint: optEnv("MINIO_ENDPOINT", "http://minio:9000"),
  minioAccessKey: optEnv("MINIO_ACCESS_KEY", "insureportal_admin"),
  minioSecretKey: requireEnv("MINIO_SECRET_KEY"),
  minioBucket: optEnv("MINIO_BUCKET", "insureportal-screenshots"),

  // ── APISix gateway admin API ────────────────────────────────────────────────
  apisixAdminUrl: optEnv("APISIX_ADMIN_URL", "http://apisix:9180"),
  apisixAdminKey: requireEnv("APISIX_ADMIN_KEY"),

  // ── MDM microservices ────────────────────────────────────────────────────────
  mdmComplianceEngineUrl: optEnv(
    "MDM_COMPLIANCE_ENGINE_URL",
    "http://mdm-compliance-engine:8091"
  ),
  mdmGeofenceServiceUrl: optEnv(
    "MDM_GEOFENCE_SERVICE_URL",
    "http://mdm-geofence-service:8092"
  ),

  // ── Resilience / offline sub-services ──────────────────────────────────────
  resilienceAgentUrl: optEnv(
    "RESILIENCE_AGENT_URL",
    "https://resilience.insureportal.io"
  ),
  offlineQueueUrl: optEnv("OFFLINE_QUEUE_URL", "https://queue.insureportal.io"),
  analyticsServiceUrl: optEnv(
    "ANALYTICS_SERVICE_URL",
    "https://analytics.insureportal.io"
  ),

  // ── POS Printer sidecar (Rust ESC/POS service) ──────────────────────────────
  posPrinterUrl: optEnv("POS_PRINTER_URL", "http://pos-printer:8085"),

  // ── mTLS ────────────────────────────────────────────────────────────────────
  mtlsEnabled: optEnv("MTLS_ENABLED", "false") === "true",
  mtlsCertDir: optEnv("MTLS_CERT_DIR", "/etc/insureportal/certs"),

  // ── OpenTelemetry ───────────────────────────────────────────────────────────
  otelEndpoint: optEnv(
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "http://otel-collector:4318"
  ),
  otelServiceName: optEnv("OTEL_SERVICE_NAME", "insurance-portal"),
  otelServiceVersion: optEnv("OTEL_SERVICE_VERSION", "1.0.0"),

  // ── Termii SMS / OTP ────────────────────────────────────────────────────────
  termiiApiKey: optEnv("TERMII_API_KEY", ""),

  // ── Web Push (VAPID) ────────────────────────────────────────────────────────
  // VAPID keys must be generated per-instance (openssl genpkey) and never
  // committed to source control.
  vapidPublicKey: optEnv("VAPID_PUBLIC_KEY", ""),
  vapidPrivateKey: optEnv("VAPID_PRIVATE_KEY", ""),
  vapidSubject: optEnv("VAPID_SUBJECT", "mailto:admin@insureportal.io"),

  // ── Platform microservice URLs (override per deployment) ───────────────────
  // DD-LEGACY (F2): phantom default hosts on ports 8070-8078 removed — no
  // such services exist in any compose/k8s manifest. Each integration is
  // active ONLY when its URL is explicitly configured; consumers treat an
  // unconfigured platform service as "not wired" and a configured-but-failed
  // one as a loud error.
  PLATFORM_KYC_URL: optEnv("PLATFORM_KYC_URL"),
  PLATFORM_VIDEO_KYC_URL: optEnv("PLATFORM_VIDEO_KYC_URL"),
  PLATFORM_FRAUD_URL: optEnv("PLATFORM_FRAUD_URL"),
  PLATFORM_SETTLEMENT_URL: optEnv("PLATFORM_SETTLEMENT_URL"),
  PLATFORM_GEOFENCING_URL: optEnv("PLATFORM_GEOFENCING_URL"),
  PLATFORM_LOYALTY_URL: optEnv("PLATFORM_LOYALTY_URL"),
  PLATFORM_FLOAT_URL: optEnv("PLATFORM_FLOAT_URL"),
  PLATFORM_DISPUTE_URL: optEnv("PLATFORM_DISPUTE_URL"),
  PLATFORM_ANALYTICS_URL: optEnv("PLATFORM_ANALYTICS_URL"),
  PLATFORM_NOTIFICATION_URL: optEnv("PLATFORM_NOTIFICATION_URL"),

  // ── Fluvio streaming cluster ─────────────────────────────────────────────────
  fluvioEndpoint: optEnv("FLUVIO_ENDPOINT", "http://fluvio:9003"),
  fluvioApiKey: optEnv("FLUVIO_API_KEY", ""),

  // ── MQTT broker (InfinyOn MQTT Source Connector) ─────────────────────────────
  mqttBrokerUrl: optEnv("MQTT_BROKER_URL", "mqtt://mosquitto:1883"),
  mqttClientId: optEnv("MQTT_CLIENT_ID", "insureportal-fluvio-bridge"),
  mqttUsername: optEnv("MQTT_USERNAME", "insureportal_mqtt"),
  mqttPassword: optEnv("MQTT_PASSWORD", ""),

  // ── S3 presigned URL signing ─────────────────────────────────────────────────
  s3Region: optEnv("S3_REGION", "us-east-1"),
  s3PresignExpiry: parseInt(
    process.env.S3_PRESIGN_EXPIRY_SECONDS ?? "3600",
    10
  ),

  // ── Internal security ────────────────────────────────────────────────────────
  // CRON_SECRET: shared secret for internal cron/scheduler → API calls.
  // INTERNAL_API_KEY: service-to-service auth header (X-Internal-Key).
  // Both are validated at startup by envValidation.ts — no hardcoded fallbacks.
  cronSecret: process.env.CRON_SECRET ?? "",
  internalApiKey: process.env.INTERNAL_API_KEY ?? "",

  // ── Dapr sidecar ───────────────────────────────────────────────────────────────────────────
  daprHttpPort: optEnv("DAPR_HTTP_PORT", "3500"),
  daprGrpcPort: optEnv("DAPR_GRPC_PORT", "50001"),
  daprAppId: optEnv("DAPR_APP_ID", "insureportal-server"),

  // ── OpenAppSec WAF ──────────────────────────────────────────────────────────────────────────
  openappsecMode: optEnv("OPENAPPSEC_MODE", "detect"),
  openappsecUpstream: optEnv("OPENAPPSEC_UPSTREAM", "http://apisix:9080"),

  // ── Insurance domain service URLs ───────────────────────────────────────────────────────────
  policyServiceUrl: optEnv("POLICY_SERVICE_URL", "http://policy-lifecycle-service:8080"),
  claimsServiceUrl: optEnv("CLAIMS_SERVICE_URL", "http://claims-adjudication-engine:8080"),
  actuarialServiceUrl: optEnv("ACTUARIAL_SERVICE_URL", "http://actuarial-module:8080"),
  reinsuranceServiceUrl: optEnv("REINSURANCE_SERVICE_URL", "http://reinsurance-service:8080"),
  ifrs17ServiceUrl: optEnv("IFRS17_SERVICE_URL", "http://ifrs17-engine:8080"),

  // ── Ollama AI (risk scoring, fraud detection) ───────────────────────────────
  ollamaUrl: optEnv("OLLAMA_URL", "http://ollama:11434"),

  // ── Public application base URL (certificate/portal links) ─────────────────
  appUrl: optEnv("APP_URL", "https://insureportal.ng"),

  // ── Lakehouse analytics ingestion endpoint ─────────────────────────────────
  lakehouseUrl: optEnv("LAKEHOUSE_URL", "http://minio:9000"),
  slackWebhookUrl: optEnv("SLACK_WEBHOOK_URL", ""),
};
