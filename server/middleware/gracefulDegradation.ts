// @ts-check

/**
 * gracefulDegradation — Progressive Feature Degradation Manager
 *
 * Manages which features are available based on current network quality.
 * Features degrade gracefully from full to minimal as connectivity drops.
 *
 * Tier → Feature Matrix:
 *   5G/WiFi  → All features (WebSocket, real-time, images, analytics)
 *   4G/LTE   → All features (WebSocket, real-time, reduced images)
 *   3G       → Polling, no WebSocket, compressed responses, no images
 *   2G/EDGE  → Essential only (transactions, balance), text-only UI
 *   2G/GPRS  → Critical only (transactions), SMS fallback, binary protocol
 *   Offline  → Local queue, CRDT ledger, USSD/SMS fallback
 */

// ── Feature Flags ────────────────────────────────────────────────────────────

export interface FeatureFlags {
  // Communication
  useWebSocket: boolean;
  usePolling: boolean;
  pollingIntervalMs: number;
  useSmssFallback: boolean;
  useUssdFallback: boolean;

  // Data
  enableRealTimeUpdates: boolean;
  enablePushNotifications: boolean;
  enableBackgroundSync: boolean;
  syncIntervalMs: number;

  // UI
  loadImages: boolean;
  loadAvatars: boolean;
  loadCharts: boolean;
  enableAnimations: boolean;
  maxListPageSize: number;
  useTextOnlyMode: boolean;

  // Features
  enableFraudDashboard: boolean;
  enableAnalytics: boolean;
  enableReporting: boolean;
  enableChat: boolean;
  enableFileUpload: boolean;
  enableBulkOperations: boolean;

  // Offline
  enableOfflineQueue: boolean;
  enableCrdtLedger: boolean;
  enableLocalCache: boolean;
  maxOfflineQueueSize: number;
  offlineRetentionDays: number;

  // Compression
  compressionAlgorithm: string;
  compressionLevel: number;
  useBinaryProtocol: boolean;
  useFieldAbbreviations: boolean;

  // Network
  requestTimeoutMs: number;
  maxRetries: number;
  retryBackoffMs: number;
  maxConcurrentRequests: number;
}

export type ConnectionState = "online" | "degraded" | "offline";
export type NetworkTier =
  | "2g_gprs"
  | "2g_edge"
  | "3g"
  | "4g_lte"
  | "5g_wifi"
  | "offline";

// ── Feature Matrix ───────────────────────────────────────────────────────────

const FEATURE_MATRIX: Record<NetworkTier, FeatureFlags> = {
  "5g_wifi": {
    useWebSocket: true,
    usePolling: false,
    pollingIntervalMs: 0,
    useSmssFallback: false,
    useUssdFallback: false,
    enableRealTimeUpdates: true,
    enablePushNotifications: true,
    enableBackgroundSync: true,
    syncIntervalMs: 5000,
    loadImages: true,
    loadAvatars: true,
    loadCharts: true,
    enableAnimations: true,
    maxListPageSize: 100,
    useTextOnlyMode: false,
    enableFraudDashboard: true,
    enableAnalytics: true,
    enableReporting: true,
    enableChat: true,
    enableFileUpload: true,
    enableBulkOperations: true,
    enableOfflineQueue: true,
    enableCrdtLedger: false,
    enableLocalCache: true,
    maxOfflineQueueSize: 1000,
    offlineRetentionDays: 7,
    compressionAlgorithm: "none",
    compressionLevel: 0,
    useBinaryProtocol: false,
    useFieldAbbreviations: false,
    requestTimeoutMs: 10000,
    maxRetries: 3,
    retryBackoffMs: 1000,
    maxConcurrentRequests: 10,
  },
  "4g_lte": {
    useWebSocket: true,
    usePolling: false,
    pollingIntervalMs: 0,
    useSmssFallback: false,
    useUssdFallback: false,
    enableRealTimeUpdates: true,
    enablePushNotifications: true,
    enableBackgroundSync: true,
    syncIntervalMs: 10000,
    loadImages: true,
    loadAvatars: true,
    loadCharts: true,
    enableAnimations: true,
    maxListPageSize: 50,
    useTextOnlyMode: false,
    enableFraudDashboard: true,
    enableAnalytics: true,
    enableReporting: true,
    enableChat: true,
    enableFileUpload: true,
    enableBulkOperations: true,
    enableOfflineQueue: true,
    enableCrdtLedger: false,
    enableLocalCache: true,
    maxOfflineQueueSize: 500,
    offlineRetentionDays: 7,
    compressionAlgorithm: "gzip",
    compressionLevel: 3,
    useBinaryProtocol: false,
    useFieldAbbreviations: false,
    requestTimeoutMs: 15000,
    maxRetries: 3,
    retryBackoffMs: 2000,
    maxConcurrentRequests: 6,
  },
  "3g": {
    useWebSocket: false,
    usePolling: true,
    pollingIntervalMs: 30000,
    useSmssFallback: false,
    useUssdFallback: false,
    enableRealTimeUpdates: false,
    enablePushNotifications: true,
    enableBackgroundSync: true,
    syncIntervalMs: 30000,
    loadImages: false,
    loadAvatars: false,
    loadCharts: false,
    enableAnimations: false,
    maxListPageSize: 25,
    useTextOnlyMode: false,
    enableFraudDashboard: false,
    enableAnalytics: false,
    enableReporting: true,
    enableChat: false,
    enableFileUpload: false,
    enableBulkOperations: false,
    enableOfflineQueue: true,
    enableCrdtLedger: true,
    enableLocalCache: true,
    maxOfflineQueueSize: 200,
    offlineRetentionDays: 14,
    compressionAlgorithm: "gzip",
    compressionLevel: 6,
    useBinaryProtocol: false,
    useFieldAbbreviations: false,
    requestTimeoutMs: 30000,
    maxRetries: 5,
    retryBackoffMs: 5000,
    maxConcurrentRequests: 3,
  },
  "2g_edge": {
    useWebSocket: false,
    usePolling: true,
    pollingIntervalMs: 60000,
    useSmssFallback: true,
    useUssdFallback: false,
    enableRealTimeUpdates: false,
    enablePushNotifications: false,
    enableBackgroundSync: true,
    syncIntervalMs: 60000,
    loadImages: false,
    loadAvatars: false,
    loadCharts: false,
    enableAnimations: false,
    maxListPageSize: 10,
    useTextOnlyMode: true,
    enableFraudDashboard: false,
    enableAnalytics: false,
    enableReporting: false,
    enableChat: false,
    enableFileUpload: false,
    enableBulkOperations: false,
    enableOfflineQueue: true,
    enableCrdtLedger: true,
    enableLocalCache: true,
    maxOfflineQueueSize: 100,
    offlineRetentionDays: 30,
    compressionAlgorithm: "deflate",
    compressionLevel: 9,
    useBinaryProtocol: false,
    useFieldAbbreviations: true,
    requestTimeoutMs: 60000,
    maxRetries: 10,
    retryBackoffMs: 10000,
    maxConcurrentRequests: 1,
  },
  "2g_gprs": {
    useWebSocket: false,
    usePolling: true,
    pollingIntervalMs: 120000,
    useSmssFallback: true,
    useUssdFallback: true,
    enableRealTimeUpdates: false,
    enablePushNotifications: false,
    enableBackgroundSync: true,
    syncIntervalMs: 120000,
    loadImages: false,
    loadAvatars: false,
    loadCharts: false,
    enableAnimations: false,
    maxListPageSize: 5,
    useTextOnlyMode: true,
    enableFraudDashboard: false,
    enableAnalytics: false,
    enableReporting: false,
    enableChat: false,
    enableFileUpload: false,
    enableBulkOperations: false,
    enableOfflineQueue: true,
    enableCrdtLedger: true,
    enableLocalCache: true,
    maxOfflineQueueSize: 50,
    offlineRetentionDays: 30,
    compressionAlgorithm: "deflate",
    compressionLevel: 9,
    useBinaryProtocol: true,
    useFieldAbbreviations: true,
    requestTimeoutMs: 120000,
    maxRetries: 15,
    retryBackoffMs: 15000,
    maxConcurrentRequests: 1,
  },
  offline: {
    useWebSocket: false,
    usePolling: false,
    pollingIntervalMs: 0,
    useSmssFallback: true,
    useUssdFallback: true,
    enableRealTimeUpdates: false,
    enablePushNotifications: false,
    enableBackgroundSync: false,
    syncIntervalMs: 0,
    loadImages: false,
    loadAvatars: false,
    loadCharts: false,
    enableAnimations: false,
    maxListPageSize: 5,
    useTextOnlyMode: true,
    enableFraudDashboard: false,
    enableAnalytics: false,
    enableReporting: false,
    enableChat: false,
    enableFileUpload: false,
    enableBulkOperations: false,
    enableOfflineQueue: true,
    enableCrdtLedger: true,
    enableLocalCache: true,
    maxOfflineQueueSize: 500,
    offlineRetentionDays: 30,
    compressionAlgorithm: "none",
    compressionLevel: 0,
    useBinaryProtocol: true,
    useFieldAbbreviations: true,
    requestTimeoutMs: 0,
    maxRetries: 0,
    retryBackoffMs: 0,
    maxConcurrentRequests: 0,
  },
};

// ── Public API ───────────────────────────────────────────────────────────────

export function getFeatureFlags(tier: NetworkTier): FeatureFlags {
  return FEATURE_MATRIX[tier] || FEATURE_MATRIX["3g"];
}

export function detectConnectionState(
  latencyMs: number,
  bandwidthKbps: number,
  packetLossPct: number
): { tier: NetworkTier; state: ConnectionState } {
  if (bandwidthKbps === 0 || latencyMs === 0) {
    return { tier: "offline", state: "offline" };
  }

  let tier: NetworkTier;
  if (bandwidthKbps <= 50 || latencyMs >= 1000) {
    tier = "2g_gprs";
  } else if (bandwidthKbps <= 200 || latencyMs >= 500) {
    tier = "2g_edge";
  } else if (bandwidthKbps <= 2000 || latencyMs >= 100) {
    tier = "3g";
  } else if (bandwidthKbps <= 50000 || latencyMs >= 50) {
    tier = "4g_lte";
  } else {
    tier = "5g_wifi";
  }

  let state: ConnectionState = "online";
  if (packetLossPct > 10 || latencyMs > 2000) {
    state = "degraded";
  }
  if (packetLossPct > 30 || latencyMs > 5000) {
    state = "offline";
    tier = "offline";
  }

  return { tier, state };
}

export function getEssentialFeatures(): string[] {
  return [
    "cash_in",
    "cash_out",
    "balance_check",
    "transaction_history",
    "float_check",
    "pin_change",
  ];
}

// essential vs nonEssential features classification
// nonEssential features are those that can be disabled on low bandwidth
// textOnly mode disables all images and loadImages
export function getNonEssentialFeatures(): string[] {
  return [
    "fraud_dashboard",
    "analytics",
    "reporting",
    "chat",
    "file_upload",
    "bulk_operations",
    "real_time_updates",
    "push_notifications",
  ];
}

export function shouldDegradeFeature(
  feature: string,
  tier: NetworkTier
): boolean {
  const flags = getFeatureFlags(tier);
  const featureMap: Record<string, boolean> = {
    fraud_dashboard: flags.enableFraudDashboard,
    analytics: flags.enableAnalytics,
    reporting: flags.enableReporting,
    chat: flags.enableChat,
    file_upload: flags.enableFileUpload,
    bulk_operations: flags.enableBulkOperations,
    real_time_updates: flags.enableRealTimeUpdates,
    push_notifications: flags.enablePushNotifications,
    images: flags.loadImages,
    charts: flags.loadCharts,
    animations: flags.enableAnimations,
  };
  return featureMap[feature] === false;
}
