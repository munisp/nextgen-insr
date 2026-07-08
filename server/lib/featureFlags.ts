// @ts-check

// TypeScript enabled — Sprint 96 security audit
import { getDb } from "../db";

interface FeatureFlag {
  key: string;
  enabled: boolean;
  description?: string;
  rolloutPercent?: number;
  tenantOverrides?: Record<string, boolean>;
}

// In-memory cache with TTL
const flagCache = new Map<string, { flag: FeatureFlag; expiresAt: number }>();
const CACHE_TTL_MS = 60000; // 1 minute

// Default flags — used when DB is unavailable
const DEFAULT_FLAGS: Record<string, FeatureFlag> = {
  geofencing: {
    key: "geofencing",
    enabled: false,
    description: "Agent geofence enforcement",
  },
  biometric_auth: {
    key: "biometric_auth",
    enabled: true,
    description: "WebAuthn biometric login",
  },
  nfc_payments: {
    key: "nfc_payments",
    enabled: true,
    description: "NFC contactless payments",
  },
  ai_fraud_scoring: {
    key: "ai_fraud_scoring",
    enabled: true,
    description: "ML-based fraud scoring",
  },
  commission_cascade: {
    key: "commission_cascade",
    enabled: true,
    description: "Hierarchical commission split",
  },
  customer_sms: {
    key: "customer_sms",
    enabled: true,
    description: "SMS transaction confirmations",
  },
  auto_dispute_escalation: {
    key: "auto_dispute_escalation",
    enabled: true,
    description: "Auto-escalate overdue disputes",
  },
  kyc_expiry_check: {
    key: "kyc_expiry_check",
    enabled: true,
    description: "Daily KYC expiry notifications",
  },
  settlement_batch: {
    key: "settlement_batch",
    enabled: true,
    description: "Daily settlement batch processing",
  },
  webhook_retry: {
    key: "webhook_retry",
    enabled: true,
    description: "Webhook delivery with exponential backoff",
  },
};

export async function isFeatureEnabled(
  key: string,
  tenantId?: string
): Promise<boolean> {
  // Check cache first
  const cached = flagCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    const flag = cached.flag;
    if (tenantId && flag.tenantOverrides?.[tenantId] !== undefined) {
      return flag.tenantOverrides[tenantId];
    }
    return flag.enabled;
  }

  // Try DB
  try {
    const db = await getDb();
    if (db) {
      const { platformSettings } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const rows = await db
        .select()
        .from(platformSettings)
        .where(eq(platformSettings.key, `feature_flag_${key}`))
        .limit(1);
      if (rows.length > 0) {
        const enabled = rows[0].value === "true";
        flagCache.set(key, {
          flag: { key, enabled },
          expiresAt: Date.now() + CACHE_TTL_MS,
        });
        return enabled;
      }
    }
  } catch {
    /* fail-open to defaults */
  }

  // Default
  const defaultFlag = DEFAULT_FLAGS[key];
  return defaultFlag?.enabled ?? false;
}

export function getAllDefaultFlags(): FeatureFlag[] {
  return Object.values(DEFAULT_FLAGS);
}
