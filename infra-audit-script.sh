#!/bin/bash
echo "=== INFRASTRUCTURE AUDIT ==="
# Keycloak
echo "1. Keycloak"
if [ ! -f "infra/keycloak/realm-insureportal.json" ]; then
    echo "  - MISSING: realm-insureportal.json"
else
    echo "  - OK: realm JSON exists"
fi

# TigerBeetle
echo "2. TigerBeetle"
if [ ! -f "tb-sidecar/main.go" ]; then
    echo "  - MISSING: tb-sidecar/main.go implementation"
else
    echo "  - OK: tb-sidecar exists"
fi

# OpenAppSec
echo "3. OpenAppSec"
if ! grep -q "openappsec" docker-compose.production.yml; then
    echo "  - MISSING: OpenAppSec in docker-compose.production.yml"
else
    echo "  - OK: OpenAppSec in docker-compose.production.yml"
fi
if ! grep -q "openappsec" infra/apisix/config.yaml 2>/dev/null; then
    echo "  - MISSING: OpenAppSec plugin in APISIX config"
else
    echo "  - OK: OpenAppSec plugin in APISIX config"
fi

# Fluvio
echo "4. Fluvio"
if ! grep -q "fluvio" server/routers/transactions.ts 2>/dev/null; then
    echo "  - WARNING: Fluvio not integrated in main transactions router"
else
    echo "  - OK: Fluvio in transactions router"
fi

# Dapr
echo "5. Dapr"
if ! grep -q "dapr" server/_core/trpc.ts 2>/dev/null; then
    echo "  - WARNING: Dapr not integrated in core tRPC"
else
    echo "  - OK: Dapr in core tRPC"
fi

