#!/bin/bash
set -e

# Insurance Platform Startup Script
# This script starts all platform services in the correct order

echo "=== Starting Insurance Platform ==="
echo ""

DEPLOYMENT_DIR="/home/ubuntu/deployment"
cd "$DEPLOYMENT_DIR"

# Check if .env exists
if [ ! -f "config/.env" ]; then
    echo "ERROR: config/.env file not found"
    echo "Please run ./scripts/configure-api-credentials.sh first"
    exit 1
fi

# Load environment variables
export $(cat config/.env | grep -v '^#' | xargs)

echo "Environment: ${NODE_ENV:-development}"
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "ERROR: Docker is not running"
    echo "Please start Docker and try again"
    exit 1
fi

# Pull latest images
echo "Pulling latest Docker images..."
docker-compose pull
echo "✓ Images pulled"
echo ""

# Start infrastructure services first
echo "Starting infrastructure services (PostgreSQL, Redis)..."
docker-compose up -d postgres redis
echo "✓ Infrastructure services started"
echo ""

# Wait for PostgreSQL to be ready
echo "Waiting for PostgreSQL to be ready..."
until docker-compose exec -T postgres pg_isready -U ${POSTGRES_USER:-insurance} > /dev/null 2>&1; do
    echo "  Waiting..."
    sleep 2
done
echo "✓ PostgreSQL is ready"
echo ""

# Initialize databases if needed
echo "Checking database initialization..."
if [ ! -f ".db-initialized" ]; then
    echo "Running database initialization..."
    ./scripts/init-databases.sh
    touch .db-initialized
    echo "✓ Databases initialized"
else
    echo "✓ Databases already initialized"
fi
echo ""

# Start application services
echo "Starting application services..."
# 2026-10-03 (W7-B11): customer-portal dropped from startup — service retired;
# `docker-compose up -d customer-portal` would now fail (no such service).
docker-compose up -d telco-service fraud-database
echo "✓ Application services started"
echo ""

# Start NGINX reverse proxy
echo "Starting NGINX reverse proxy..."
docker-compose up -d nginx
echo "✓ NGINX started"
echo ""

# Wait for services to be healthy
echo "Waiting for services to be healthy..."
sleep 10

# Check service health
echo ""
echo "=== Service Health Check ==="

check_service() {
    local service=$1
    local url=$2
    
    if curl -f -s "$url" > /dev/null 2>&1; then
        echo "✓ $service is healthy"
        return 0
    else
        echo "✗ $service is not responding"
        return 1
    fi
}

check_service "Customer Portal" "http://localhost:3000"
check_service "Telco Service" "http://localhost:8010/docs"
check_service "Fraud Database" "http://localhost:8011/docs"

echo ""
echo "=== Platform Started Successfully ==="
echo ""
echo "Access points:"
echo "  Customer Portal: http://localhost:3000"
echo "  Telco Service API: http://localhost:8010"
echo "  Fraud Database API: http://localhost:8011"
echo ""
echo "View logs:"
echo "  docker-compose logs -f [service-name]"
echo ""
echo "Stop platform:"
echo "  docker-compose down"
