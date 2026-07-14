#!/usr/bin/env python3
"""Port all missing server modules from main server to insureportal/server."""
import os
import shutil
import subprocess

BASE = "/home/ubuntu/nextgen-insr"
SRC_SERVER = os.path.join(BASE, "server")
DST_SERVER = os.path.join(BASE, "insureportal", "server")

# Mapping of missing module path (relative to insureportal/server) -> source in server/
MODULES_TO_PORT = [
    # Direct copies: relative module path in insureportal/server -> source file in server/
    ("fluvio.ts", "fluvio.ts"),
    ("kafkaClient.ts", "kafkaClient.ts"),
    ("redisClient.ts", "redisClient.ts"),
    ("push.ts", "push.ts"),
    ("termii.ts", "termii.ts"),
    ("socket.ts", "socket.ts"),
    ("socketSingleton.ts", "socketSingleton.ts"),
    ("lib/distributedState.ts", "lib/distributedState.ts"),
    ("lib/emailQueue.ts", "lib/emailQueue.ts"),
    ("lib/fraudDetectionEngine.ts", "lib/fraudDetectionEngine.ts"),
    ("lib/mtlsAgent.ts", "lib/mtlsAgent.ts"),
    ("lib/observability.ts", "lib/observability.ts"),
    ("lib/parquetArchival.ts", "lib/parquetArchival.ts"),
    ("lib/runtimeConfig.ts", "lib/runtimeConfig.ts"),
    ("lib/sidecarBridge.ts", "lib/sidecarBridge.ts"),
    ("lib/webhookDelivery.ts", "lib/webhookDelivery.ts"),
    ("lib/analyticsMetrics.ts", "lib/analyticsMetrics.ts"),
    ("lib/compliancePdf.ts", "lib/compliancePdf.ts"),
    ("lib/realtimeNotifications.ts", "lib/realtimeNotifications.ts"),
    ("lib/mtlsAgent.ts", "lib/mtlsAgent.ts"),
    ("middleware/agentAuth.ts", "middleware/agentAuth.ts"),
    ("middleware/commissionMiddleware.ts", "middleware/commissionMiddleware.ts"),
    ("middleware/settlementMiddleware.ts", "middleware/settlementMiddleware.ts"),
    ("middleware/livenessSecurityEnhancements.ts", "middleware/livenessSecurityEnhancements.ts"),
    ("routers/insuranceCart.ts", "routers/insuranceCart.ts"),
    ("routers/insuranceCatalog.ts", "routers/insuranceCatalog.ts"),
    ("routers/insuranceServiceFleet.ts", "routers/insuranceServiceFleet.ts"),
    ("routers/policyOrders.ts", "routers/policyOrders.ts"),
    ("routers/posServiceUpdate.ts", "routers/posServiceUpdate.ts"),
    ("routers/premiumTopUp.ts", "routers/premiumTopUp.ts"),
    ("routers/simOrchestrator.ts", "routers/simOrchestrator.ts"),
    ("routers/terminalLeasing.ts", "routers/terminalLeasing.ts"),
    ("routers/ussdAnalytics.ts", "routers/ussdAnalytics.ts"),
    ("routers/ussdIntegration.ts", "routers/ussdIntegration.ts"),
    ("routers/ussdLocalization.ts", "routers/ussdLocalization.ts"),
    ("runtimeConfig.ts", "runtimeConfig.ts"),
    ("socketSingleton.ts", "socketSingleton.ts"),
]

copied = []
missing_source = []
already_exists = []

for dst_rel, src_rel in MODULES_TO_PORT:
    src_path = os.path.join(SRC_SERVER, src_rel)
    dst_path = os.path.join(DST_SERVER, dst_rel)
    
    if os.path.exists(dst_path):
        already_exists.append(dst_rel)
        continue
    
    if not os.path.exists(src_path):
        missing_source.append(src_rel)
        continue
    
    os.makedirs(os.path.dirname(dst_path), exist_ok=True)
    shutil.copy2(src_path, dst_path)
    copied.append(dst_rel)
    print(f"  Copied: {dst_rel}")

print(f"\nSummary:")
print(f"  Copied: {len(copied)} files")
print(f"  Already existed: {len(already_exists)} files")
print(f"  Missing source: {len(missing_source)} files")
if missing_source:
    print(f"  Missing sources: {missing_source}")
