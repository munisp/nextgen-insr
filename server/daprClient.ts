// TypeScript enabled — Sprint 98 infrastructure integration
/**
 * InsurePortal Dapr Client
 *
 * Dapr (Distributed Application Runtime) is used for:
 *   • Service-to-service invocation (sidecar pattern)
 *   • Pub/Sub messaging (Redis/Kafka/Fluvio backends)
 *   • State management (Redis-backed distributed state)
 *   • Workflow orchestration (Dapr Workflow API)
 *   • Secret store access (Vault integration)
 *   • Distributed tracing (OpenTelemetry)
 *
 * Architecture:
 *   Each microservice runs a Dapr sidecar on port 3500 (HTTP) / 50001 (gRPC)
 *   The sidecar handles service discovery, retries, and circuit breaking.
 *
 * Environment variables:
 *   DAPR_HTTP_PORT   — Dapr sidecar HTTP port (default: 3500)
 *   DAPR_GRPC_PORT   — Dapr sidecar gRPC port (default: 50001)
 *   DAPR_APP_ID      — This app's Dapr application ID
 */
import { logger } from "./_core/logger";

const DAPR_HTTP_PORT = process.env.DAPR_HTTP_PORT ?? "3500";
const DAPR_GRPC_PORT = process.env.DAPR_GRPC_PORT ?? "50001";
const DAPR_APP_ID = process.env.DAPR_APP_ID ?? "insureportal-server";
const DAPR_BASE_URL = `http://localhost:${DAPR_HTTP_PORT}`;
const DAPR_TIMEOUT_MS = 5000;

// ── Known Dapr App IDs ────────────────────────────────────────────────────────
export const DAPR_APP_IDS = {
  POLICY_SERVICE: "policy-lifecycle-service",
  CLAIMS_SERVICE: "claims-adjudication-engine",
  PAYMENT_SERVICE: "payment-service",
  NOTIFICATION_SERVICE: "notification-service",
  FRAUD_SERVICE: "fraud-detection-service",
  KYC_SERVICE: "kyc-kyb-service",
  LAKEHOUSE_SERVICE: "lakehouse-integration",
  ANALYTICS_SERVICE: "analytics-service",
  REINSURANCE_SERVICE: "reinsurance-service",
  ACTUARIAL_SERVICE: "actuarial-module",
} as const;

// ── Pub/Sub Component Names ───────────────────────────────────────────────────
export const DAPR_PUBSUB_COMPONENTS = {
  REDIS: "redis-pubsub",
  KAFKA: "kafka-pubsub",
  FLUVIO: "fluvio-pubsub",
} as const;

// ── State Store Component Names ───────────────────────────────────────────────
export const DAPR_STATE_STORES = {
  REDIS: "redis-state-store",
  POSTGRES: "postgres-state-store",
} as const;

// ── Secret Store Component Names ─────────────────────────────────────────────
export const DAPR_SECRET_STORES = {
  VAULT: "vault-secret-store",
  LOCAL: "local-secret-store",
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────
export interface DaprInvokeOptions {
  appId: string;
  method: string;
  data?: Record<string, unknown>;
  verb?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
}

export interface DaprPublishOptions {
  pubsubName: string;
  topic: string;
  data: Record<string, unknown>;
  metadata?: Record<string, string>;
}

export interface DaprStateItem {
  key: string;
  value: unknown;
  metadata?: Record<string, string>;
  options?: {
    concurrency?: "first-write" | "last-write";
    consistency?: "eventual" | "strong";
  };
}

export interface DaprWorkflowOptions {
  workflowComponent: string;
  workflowName: string;
  instanceId?: string;
  input?: Record<string, unknown>;
}

// ── Core HTTP Helper ──────────────────────────────────────────────────────────
async function daprFetch(
  path: string,
  options: RequestInit = {},
  timeoutMs = DAPR_TIMEOUT_MS
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${DAPR_BASE_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "dapr-app-id": DAPR_APP_ID,
        ...(options.headers ?? {}),
      },
    });
    return res;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg, path }, "[Dapr] Request failed");
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Service Invocation ────────────────────────────────────────────────────────
/**
 * Invoke a method on another Dapr-enabled service.
 * Returns null if the target service is unreachable.
 */
export async function daprInvoke<T = unknown>(
  opts: DaprInvokeOptions
): Promise<T | null> {
  const { appId, method, data, verb = "POST" } = opts;
  const path = `/v1.0/invoke/${appId}/method/${method}`;
  const res = await daprFetch(path, {
    method: verb,
    body: data ? JSON.stringify(data) : undefined,
  });
  if (!res) return null;
  if (!res.ok) {
    logger.warn(
      { appId, method, status: res.status },
      "[Dapr] Service invocation failed"
    );
    return null;
  }
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ── Pub/Sub ───────────────────────────────────────────────────────────────────
/**
 * Publish an event to a Dapr pub/sub topic.
 */
export async function daprPublish(opts: DaprPublishOptions): Promise<boolean> {
  const { pubsubName, topic, data, metadata } = opts;
  const path = `/v1.0/publish/${pubsubName}/${topic}`;
  const headers: Record<string, string> = {};
  if (metadata) {
    for (const [k, v] of Object.entries(metadata)) {
      headers[`metadata.${k}`] = v;
    }
  }
  const res = await daprFetch(path, {
    method: "POST",
    body: JSON.stringify(data),
    headers,
  });
  if (!res || !res.ok) {
    logger.warn({ pubsubName, topic }, "[Dapr] Publish failed");
    return false;
  }
  return true;
}

/**
 * Publish an insurance domain event to the appropriate pub/sub backend.
 */
export async function publishInsuranceEvent(
  eventType: string,
  payload: Record<string, unknown>,
  topic?: string
): Promise<boolean> {
  const resolvedTopic = topic ?? deriveTopicFromEventType(eventType);
  return daprPublish({
    pubsubName: DAPR_PUBSUB_COMPONENTS.REDIS,
    topic: resolvedTopic,
    data: {
      eventType,
      timestamp: new Date().toISOString(),
      source: DAPR_APP_ID,
      ...payload,
    },
  });
}

function deriveTopicFromEventType(eventType: string): string {
  if (eventType.startsWith("policy.")) return "policy-events";
  if (eventType.startsWith("claim.")) return "claims-events";
  if (eventType.startsWith("payment.")) return "payment-events";
  if (eventType.startsWith("kyc.")) return "kyc-events";
  if (eventType.startsWith("fraud.")) return "fraud-alerts";
  if (eventType.startsWith("underwriting.")) return "underwriting-events";
  if (eventType.startsWith("notification.")) return "notification-events";
  return "system-events";
}

// ── State Management ──────────────────────────────────────────────────────────
/**
 * Save state to Dapr state store.
 */
export async function daprSaveState(
  storeName: string,
  items: DaprStateItem[]
): Promise<boolean> {
  const path = `/v1.0/state/${storeName}`;
  const res = await daprFetch(path, {
    method: "POST",
    body: JSON.stringify(items),
  });
  return !!res && res.ok;
}

/**
 * Get state from Dapr state store.
 */
export async function daprGetState<T = unknown>(
  storeName: string,
  key: string
): Promise<T | null> {
  const path = `/v1.0/state/${storeName}/${encodeURIComponent(key)}`;
  const res = await daprFetch(path, { method: "GET" });
  if (!res || !res.ok) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Delete state from Dapr state store.
 */
export async function daprDeleteState(
  storeName: string,
  key: string
): Promise<boolean> {
  const path = `/v1.0/state/${storeName}/${encodeURIComponent(key)}`;
  const res = await daprFetch(path, { method: "DELETE" });
  return !!res && res.ok;
}

// ── Secret Store ──────────────────────────────────────────────────────────────
/**
 * Retrieve a secret from Dapr secret store (backed by Vault in production).
 */
export async function daprGetSecret(
  storeName: string,
  secretName: string
): Promise<Record<string, string> | null> {
  const path = `/v1.0/secrets/${storeName}/${encodeURIComponent(secretName)}`;
  const res = await daprFetch(path, { method: "GET" });
  if (!res || !res.ok) return null;
  try {
    return (await res.json()) as Record<string, string>;
  } catch {
    return null;
  }
}

// ── Workflow API ──────────────────────────────────────────────────────────────
/**
 * Start a Dapr workflow instance.
 */
export async function daprStartWorkflow(
  opts: DaprWorkflowOptions
): Promise<{ instanceId: string } | null> {
  const { workflowComponent, workflowName, instanceId, input } = opts;
  const id = instanceId ?? `${workflowName}-${Date.now()}`;
  const path = `/v1.0-beta1/workflows/${workflowComponent}/${workflowName}/start?instanceID=${id}`;
  const res = await daprFetch(path, {
    method: "POST",
    body: input ? JSON.stringify(input) : "{}",
  });
  if (!res || !res.ok) {
    logger.warn({ workflowName, id }, "[Dapr] Workflow start failed");
    return null;
  }
  return { instanceId: id };
}

/**
 * Get the status of a Dapr workflow instance.
 */
export async function daprGetWorkflowStatus(
  workflowComponent: string,
  instanceId: string
): Promise<Record<string, unknown> | null> {
  const path = `/v1.0-beta1/workflows/${workflowComponent}/${instanceId}`;
  const res = await daprFetch(path, { method: "GET" });
  if (!res || !res.ok) return null;
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Terminate a Dapr workflow instance.
 */
export async function daprTerminateWorkflow(
  workflowComponent: string,
  instanceId: string
): Promise<boolean> {
  const path = `/v1.0-beta1/workflows/${workflowComponent}/${instanceId}/terminate`;
  const res = await daprFetch(path, { method: "POST" });
  return !!res && res.ok;
}

// ── Health Check ──────────────────────────────────────────────────────────────
export async function daprHealthCheck(): Promise<{
  healthy: boolean;
  sidecarPort: string;
  appId: string;
}> {
  const res = await daprFetch("/v1.0/healthz", { method: "GET" }, 2000);
  return {
    healthy: !!res && res.ok,
    sidecarPort: DAPR_HTTP_PORT,
    appId: DAPR_APP_ID,
  };
}

// ── Insurance Domain Helpers ──────────────────────────────────────────────────
/**
 * Invoke the policy lifecycle service to transition a policy state.
 */
export async function invokePolicyTransition(
  policyId: number,
  toStatus: string,
  triggeredBy: string
): Promise<Record<string, unknown> | null> {
  return daprInvoke({
    appId: DAPR_APP_IDS.POLICY_SERVICE,
    method: "policies/transition",
    data: { policyId, toStatus, triggeredBy },
  });
}

/**
 * Invoke the claims adjudication engine to process a claim.
 */
export async function invokeClaimAdjudication(
  claimId: number,
  adjudicatorId: string
): Promise<Record<string, unknown> | null> {
  return daprInvoke({
    appId: DAPR_APP_IDS.CLAIMS_SERVICE,
    method: "claims/adjudicate",
    data: { claimId, adjudicatorId },
  });
}

/**
 * Invoke the fraud detection service for real-time scoring.
 */
export async function invokeFraudScore(
  transactionId: string,
  payload: Record<string, unknown>
): Promise<{ score: number; decision: string } | null> {
  return daprInvoke({
    appId: DAPR_APP_IDS.FRAUD_SERVICE,
    method: "fraud/score",
    data: { transactionId, ...payload },
  });
}

/**
 * Invoke the KYC service to verify a customer.
 */
export async function invokeKycVerification(
  customerId: number,
  documentType: string,
  documentRef: string
): Promise<{ verified: boolean; status: string } | null> {
  return daprInvoke({
    appId: DAPR_APP_IDS.KYC_SERVICE,
    method: "kyc/verify",
    data: { customerId, documentType, documentRef },
  });
}

export default {
  invoke: daprInvoke,
  publish: daprPublish,
  publishInsuranceEvent,
  saveState: daprSaveState,
  getState: daprGetState,
  deleteState: daprDeleteState,
  getSecret: daprGetSecret,
  startWorkflow: daprStartWorkflow,
  getWorkflowStatus: daprGetWorkflowStatus,
  terminateWorkflow: daprTerminateWorkflow,
  healthCheck: daprHealthCheck,
  invokePolicyTransition,
  invokeClaimAdjudication,
  invokeFraudScore,
  invokeKycVerification,
  APP_IDS: DAPR_APP_IDS,
  PUBSUB: DAPR_PUBSUB_COMPONENTS,
  STATE_STORES: DAPR_STATE_STORES,
  SECRET_STORES: DAPR_SECRET_STORES,
};
