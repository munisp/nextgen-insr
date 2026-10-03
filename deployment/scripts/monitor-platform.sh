#!/bin/bash

# Insurance Platform Monitoring Script
# Continuously monitors platform health and displays status

DEPLOYMENT_DIR="/home/ubuntu/deployment"
cd "$DEPLOYMENT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

check_service_health() {
    local service=$1
    local url=$2
    
    if curl -f -s "$url" > /dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} $service"
        return 0
    else
        echo -e "${RED}✗${NC} $service"
        return 1
    fi
}

check_container_status() {
    local container=$1
    local status=$(docker inspect -f '{{.State.Status}}' "$container" 2>/dev/null)
    
    if [ "$status" = "running" ]; then
        echo -e "${GREEN}✓${NC} $container (running)"
        return 0
    elif [ "$status" = "restarting" ]; then
        echo -e "${YELLOW}⟳${NC} $container (restarting)"
        return 1
    elif [ -n "$status" ]; then
        echo -e "${RED}✗${NC} $container ($status)"
        return 1
    else
        echo -e "${RED}✗${NC} $container (not found)"
        return 1
    fi
}

while true; do
    clear
    echo "=== Insurance Platform Health Monitor ==="
    echo "$(date '+%Y-%m-%d %H:%M:%S')"
    echo ""
    
    echo "--- Container Status ---"
    check_container_status "insurance-postgres"
    check_container_status "insurance-redis"
    # 2026-10-03 (W7-B11): customer-portal container check removed — service retired.
    check_container_status "telco-service"
    check_container_status "fraud-database"
    check_container_status "insurance-nginx"
    echo ""
    
    echo "--- Service Health ---"
    # 2026-10-03 (W7-B11): Customer Portal health check removed — service retired;
    # member portal now lives in the monolith (/member/*).
    check_service_health "Telco Service" "http://localhost:8010/docs"
    check_service_health "Fraud Database" "http://localhost:8011/docs"
    echo ""
    
    echo "--- Resource Usage ---"
    docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" \
        insurance-postgres insurance-redis telco-service fraud-database insurance-nginx 2>/dev/null || echo "No containers running"
    echo ""
    
    echo "Press Ctrl+C to exit"
    sleep 5
done
