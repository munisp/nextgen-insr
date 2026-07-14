#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# InsurePortal TigerBeetle 3-Node Cluster Initialisation Script
# ─────────────────────────────────────────────────────────────────────────────
# Creates the data files for each replica and starts the cluster.
# Run this ONCE before starting the cluster for the first time.
#
# Usage:
#   bash infra/tigerbeetle/init-cluster.sh [--data-dir /path/to/data]
#
# Requirements:
#   - Docker with the tigerbeetle image available
#   - Sufficient disk space (each replica file is ~1GB by default)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

TB_IMAGE="ghcr.io/tigerbeetle/tigerbeetle:0.15.3"
DATA_DIR="${TB_DATA_DIR:-/var/lib/tigerbeetle}"
CLUSTER_ID=0
REPLICA_COUNT=3

echo "==> InsurePortal TigerBeetle Cluster Init"
echo "    Image:        $TB_IMAGE"
echo "    Data dir:     $DATA_DIR"
echo "    Cluster ID:   $CLUSTER_ID"
echo "    Replica count: $REPLICA_COUNT"
echo ""

# Create data directory
mkdir -p "$DATA_DIR"

# Format data file for each replica
for replica in 0 1 2; do
    DATA_FILE="$DATA_DIR/${CLUSTER_ID}_${replica}.tigerbeetle"
    if [ -f "$DATA_FILE" ]; then
        echo "  [replica $replica] Data file already exists: $DATA_FILE (skipping format)"
    else
        echo "  [replica $replica] Formatting data file: $DATA_FILE"
        docker run --rm \
            -v "$DATA_DIR:/data" \
            "$TB_IMAGE" \
            format \
            --cluster=$CLUSTER_ID \
            --replica=$replica \
            --replica-count=$REPLICA_COUNT \
            "/data/${CLUSTER_ID}_${replica}.tigerbeetle"
        echo "  [replica $replica] ✅ Formatted successfully"
    fi
done

echo ""
echo "==> All replica data files ready in: $DATA_DIR"
echo ""
echo "==> Starting TigerBeetle cluster..."
docker compose -f docker-compose.production.yml \
               -f infra/tigerbeetle/docker-compose.cluster.yml \
               up -d tigerbeetle-0 tigerbeetle-1 tigerbeetle-2

echo ""
echo "==> Waiting for cluster to become healthy..."
sleep 5

# Health check each replica
for replica in 0 1 2; do
    port=$((3000 + replica))
    if docker exec "tigerbeetle-$replica" sh -c "echo ping | nc -q1 localhost $port" 2>/dev/null; then
        echo "  [replica $replica] ✅ Healthy on port $port"
    else
        echo "  [replica $replica] ⚠️  Not yet responding on port $port (may still be starting)"
    fi
done

echo ""
echo "==> TigerBeetle cluster initialisation complete!"
echo "    Connect string: tigerbeetle-0:3000,tigerbeetle-1:3001,tigerbeetle-2:3002"
echo "    Set TIGERBEETLE_ADDRESSES=tigerbeetle-0:3000,tigerbeetle-1:3001,tigerbeetle-2:3002"
