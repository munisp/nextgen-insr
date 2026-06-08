/**
 * env.ts — Centralised environment variable registry
 * Every env var consumed by the server MUST be declared here.
 * All values have safe defaults so the server starts without any .env file.
 * Production deployments override these via the platform Secrets panel.
 *
 * Default URLs follow the InsurePortal Docker Compose service name convention:
 *   http://<service>:<port>  — internal Docker network (production default)
 *   https://<service>.insureportal.io  — public-facing microservices
 *   https://api.insureportal.io        — APISix gateway
 *   https://auth.insureportal.io       — Keycloak OIDC
 *   mqtt://broker.insureportal.io:1883 — MQTT broker (TLS: 8883)
 */
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
  redisUrl: process.env.REDIS_URL ?? "redis://redis:6379",

  // ── Kafka ───────────────────────────────────────────────────────────────────
  kafkaBrokers: process.env.KAFKA_BROKERS ?? "kafka:9092",
  kafkaClientId: process.env.KAFKA_CLIENT_ID ?? "insurance-portal",
  kafkaEnabled: process.env.KAFKA_ENABLED ?? "false",
  kafkaSsl: process.env.KAFKA_SSL ?? "false",
  kafkaSaslUsername: process.env.KAFKA_SASL_USERNAME ?? "",
  kafkaSaslPassword: process.env.KAFKA_SASL_PASSWORD ?? "",

  // ── TigerBeetle sidecar ─────────────────────────────────────────────────────
  tbSidecarUrl: process.env.TB_SIDECAR_URL ?? "http://tigerbeetle-sidecar:8080",

  // ── Platform APISix gateway ─────────────────────────────────────────────────
  platformBaseUrl: process.env.PLATFORM_BASE_URL ?? "http://apisix:9080",
  platformApiKey: process.env.PLATFORM_API_KEY ?? "insureportal-platform-dev-api-key",
  platformServiceToken:
    process.env.PLATFORM_SERVICE_TOKEN ?? "insureportal-service-token-dev",

  // ── Keycloak OIDC ───────────────────────────────────────────────────────────
  keycloakUrl: process.env.KEYCLOAK_URL ?? "http://keycloak:8080",
  keycloakRealm: process.env.KEYCLOAK_REALM ?? "insureportal",
  keycloakClientId: process.env.KEYCLOAK_CLIENT_ID ?? "insurance-portal",
  keycloakClientSecret:
    process.env.KEYCLOAK_CLIENT_SECRET ?? "insureportal-keycloak-dev-secret",

  // ── Temporal workflow engine ─────────────────────────────────────────────────
  temporalAddress: process.env.TEMPORAL_ADDRESS ?? "temporal:7233",
  temporalNamespace: process.env.TEMPORAL_NAMESPACE ?? "insureportal-production",
  temporalTaskQueue: process.env.TEMPORAL_TASK_QUEUE ?? "settlement-queue",

  // ── HashiCorp Vault ──────────────────────────────────────────────────────────
  vaultAddr: process.env.VAULT_ADDR ?? "http://vault:8200",
  vaultRoleId: process.env.VAULT_ROLE_ID ?? "",
  vaultSecretId: process.env.VAULT_SECRET_ID ?? "",
  vaultSecretPath:
    process.env.VAULT_SECRET_PATH ?? "secret/data/insurance-portal-demo",

  // ── Permify authorization service ───────────────────────────────────────────
  permifyUrl: process.env.PERMIFY_URL ?? "http://permify:3476",
  permifyTenantId: process.env.PERMIFY_TENANT_ID ?? "t1",

  // ── MinIO / Lakehouse ────────────────────────────────────────────────────────
  minioEndpoint: process.env.MINIO_ENDPOINT ?? "http://minio:9000",
  minioAccessKey: process.env.MINIO_ACCESS_KEY ?? "insureportal_admin",
  minioSecretKey: process.env.MINIO_SECRET_KEY ?? "insureportal_minio_dev_secret",
  minioBucket: process.env.MINIO_BUCKET ?? "insureportal-screenshots",

  // ── APISix gateway admin API ────────────────────────────────────────────────
  apisixAdminUrl: process.env.APISIX_ADMIN_URL ?? "http://apisix:9180",
  apisixAdminKey: process.env.APISIX_ADMIN_KEY ?? "insureportal-apisix-dev-admin-key",

  // ── MDM microservices ────────────────────────────────────────────────────────
  mdmComplianceEngineUrl:
    process.env.MDM_COMPLIANCE_ENGINE_URL ??
    "http://mdm-compliance-engine:8091",
  mdmGeofenceServiceUrl:
    process.env.MDM_GEOFENCE_SERVICE_URL ?? "http://mdm-geofence-service:8092",

  // ── Resilience / offline sub-services ──────────────────────────────────────
  resilienceAgentUrl:
    process.env.RESILIENCE_AGENT_URL ?? "https://resilience.insureportal.io",
  offlineQueueUrl: process.env.OFFLINE_QUEUE_URL ?? "https://queue.insureportal.io",
  analyticsServiceUrl:
    process.env.ANALYTICS_SERVICE_URL ?? "https://analytics.insureportal.io",

  // ── POS Printer sidecar (Rust ESC/POS service) ──────────────────────────────
  posPrinterUrl: process.env.POS_PRINTER_URL ?? "http://pos-printer:8085",

  // ── mTLS ────────────────────────────────────────────────────────────────────
  mtlsEnabled: (process.env.MTLS_ENABLED ?? "false") === "true",
  mtlsCertDir: process.env.MTLS_CERT_DIR ?? "/etc/insureportal/certs",

  // ── OpenTelemetry ───────────────────────────────────────────────────────────
  otelEndpoint:
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://otel-collector:4318",
  otelServiceName: process.env.OTEL_SERVICE_NAME ?? "insurance-portal",
  otelServiceVersion: process.env.OTEL_SERVICE_VERSION ?? "1.0.0",

  // ── Termii SMS / OTP ────────────────────────────────────────────────────────
  // Override TERMII_API_KEY in production Secrets panel.
  termiiApiKey: process.env.TERMII_API_KEY ?? "TLtest_insureportal_dev_key",

  // ── Web Push (VAPID) ────────────────────────────────────────────────────────
  // These are dev/demo VAPID keys — override via VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in production.
  vapidPublicKey:
    process.env.VAPID_PUBLIC_KEY ??
    "BE4Tbbh5r0IGPRlQ_0ePL0AEJfiWJynWxxM0UDmffgbenp87U4upzpn0aNysgCVQdT8IUfNSG3Dx6_k2Wn6lRgA",
  vapidPrivateKey:
    process.env.VAPID_PRIVATE_KEY ??
    "vBqalBipE6mu4a592N8c1wucdpun-RaKemy8gZDa99M",
  vapidSubject: process.env.VAPID_SUBJECT ?? "mailto:admin@insureportal.io",

  // ── Platform microservice URLs (override per deployment) ───────────────────
  PLATFORM_KYC_URL: process.env.PLATFORM_KYC_URL ?? "http://kyc-service:8070",
  PLATFORM_VIDEO_KYC_URL:
    process.env.PLATFORM_VIDEO_KYC_URL ?? "http://video-kyc-service:8071",
  PLATFORM_FRAUD_URL:
    process.env.PLATFORM_FRAUD_URL ?? "http://fraud-engine:8072",
  PLATFORM_SETTLEMENT_URL:
    process.env.PLATFORM_SETTLEMENT_URL ?? "http://settlement-service:8073",
  PLATFORM_GEOFENCING_URL:
    process.env.PLATFORM_GEOFENCING_URL ?? "http://mdm-geofence-service:8092",
  PLATFORM_LOYALTY_URL:
    process.env.PLATFORM_LOYALTY_URL ?? "http://loyalty-service:8074",
  PLATFORM_FLOAT_URL:
    process.env.PLATFORM_FLOAT_URL ?? "http://float-manager:8075",
  PLATFORM_DISPUTE_URL:
    process.env.PLATFORM_DISPUTE_URL ?? "http://dispute-service:8076",
  PLATFORM_ANALYTICS_URL:
    process.env.PLATFORM_ANALYTICS_URL ?? "http://analytics-service:8077",
  PLATFORM_NOTIFICATION_URL:
    process.env.PLATFORM_NOTIFICATION_URL ?? "http://notification-service:8078",

  // ── Fluvio streaming cluster ─────────────────────────────────────────────────
  fluvioEndpoint: process.env.FLUVIO_ENDPOINT ?? "http://fluvio:9003",
  fluvioApiKey: process.env.FLUVIO_API_KEY ?? "insureportal-fluvio-dev-key",

  // ── MQTT broker (InfinyOn MQTT Source Connector) ─────────────────────────────
  mqttBrokerUrl: process.env.MQTT_BROKER_URL ?? "mqtt://mosquitto:1883",
  mqttClientId: process.env.MQTT_CLIENT_ID ?? "insureportal-fluvio-bridge",
  mqttUsername: process.env.MQTT_USERNAME ?? "insureportal_mqtt",
  mqttPassword: process.env.MQTT_PASSWORD ?? "insureportal_mqtt_dev_pass",

  // ── S3 presigned URL signing ─────────────────────────────────────────────────
  s3Region: process.env.S3_REGION ?? "us-east-1",
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
};
