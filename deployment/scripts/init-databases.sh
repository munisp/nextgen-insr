#!/bin/bash
set -e

# Database Initialization Script for Insurance Platform
# This script initializes all PostgreSQL databases for the platform

echo "=== Insurance Platform Database Initialization ==="
echo ""

# Check if DATABASE_URL is provided
if [ -z "$DATABASE_URL" ]; then
    echo "ERROR: DATABASE_URL environment variable is required"
    echo "Example: postgresql://user:password@host:5432/database"
    exit 1
fi

# Parse DATABASE_URL
DB_USER=$(echo $DATABASE_URL | sed -n 's/.*:\/\/\([^:]*\):.*/\1/p')
DB_PASS=$(echo $DATABASE_URL | sed -n 's/.*:\/\/[^:]*:\([^@]*\)@.*/\1/p')
DB_HOST=$(echo $DATABASE_URL | sed -n 's/.*@\([^:]*\):.*/\1/p')
DB_PORT=$(echo $DATABASE_URL | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')
DB_NAME=$(echo $DATABASE_URL | sed -n 's/.*\/\([^?]*\).*/\1/p')

echo "Database Configuration:"
echo "  Host: $DB_HOST"
echo "  Port: $DB_PORT"
echo "  User: $DB_USER"
echo "  Database: $DB_NAME"
echo ""

# Test connection
echo "Testing database connection..."
PGPASSWORD=$DB_PASS psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d postgres -c "SELECT version();" > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "✓ Database connection successful"
else
    echo "✗ Database connection failed"
    exit 1
fi
echo ""

# Create databases if they don't exist
echo "Creating databases..."

# Customer Portal Database
# 2026-10-03 (W7-B11): customer-portal-full is retired, but this DB is still
# created so any existing customer_portal data survives; drop only after data
# has been migrated into the monolith DB (see docs/CUSTOMER_PORTAL_RETIREMENT.md).
PGPASSWORD=$DB_PASS psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d postgres -c "CREATE DATABASE customer_portal;" 2>/dev/null || echo "  - customer_portal already exists"

# Telco Service Database
PGPASSWORD=$DB_PASS psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d postgres -c "CREATE DATABASE telco_service;" 2>/dev/null || echo "  - telco_service already exists"

# Fraud Database
PGPASSWORD=$DB_PASS psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d postgres -c "CREATE DATABASE fraud_database;" 2>/dev/null || echo "  - fraud_database already exists"

echo "✓ All databases created"
echo ""

# 2026-10-03 (W7-B11): customer-portal schema init removed — customer-portal-full/
# is retired (succeeded by the monolith member portal, /member/*). The schema push
# ran `pnpm db:push` from /home/ubuntu/customer-portal-full, which no longer exists.
# The `customer_portal` database itself is intentionally still created above so any
# existing data is preserved; migrate data into the monolith DB before dropping it.

# Initialize Telco Service Schema
echo "Initializing telco service schema..."
cd /home/ubuntu/telco-data-integration-service
export DATABASE_URL="postgresql://$DB_USER:$DB_PASS@$DB_HOST:$DB_PORT/telco_service"
python3 -c "
from app.models.telco_data import Base
from app.services.database import engine
Base.metadata.create_all(bind=engine)
print('✓ Telco service schema initialized')
"
echo ""

# Initialize Fraud Database Schema
echo "Initializing fraud database schema..."
cd /home/ubuntu/cross-company-fraud-database
export DATABASE_URL="postgresql://$DB_USER:$DB_PASS@$DB_HOST:$DB_PORT/fraud_database"
python3 -c "
from app.models.fraud_record import Base
from app.services.database import engine
Base.metadata.create_all(bind=engine)
print('✓ Fraud database schema initialized')
"
echo ""

# 2026-10-03 (W7-B11): customer-portal seeding removed — it ran
# customer-portal-full/server/seed.mjs, retired with the portal. Use the monolith's
# seed scripts (root seed.mjs) for member-portal data.

echo "=== Database Initialization Complete ==="
echo ""
echo "Next steps:"
echo "1. Configure API credentials in .env files"
echo "2. Start the services with docker-compose up"
echo "3. Access customer portal at http://localhost:3000"
