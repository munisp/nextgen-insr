#!/bin/bash

# Complete Database Setup and Migration Script
# This script sets up all databases for the insurance platform

set -e

echo "======================================"
echo "Insurance Platform Database Setup"
echo "======================================"
echo ""

# Check for required environment variables
if [ -z "$DATABASE_URL" ]; then
    echo "❌ ERROR: DATABASE_URL environment variable is required"
    echo ""
    echo "Example:"
    echo "  export DATABASE_URL='postgresql://user:password@host:5432/insurance_db'"
    echo ""
    exit 1
fi

echo "✓ DATABASE_URL found"
echo ""

# Extract database connection details
DB_HOST=$(echo $DATABASE_URL | sed -n 's/.*@\([^:]*\).*/\1/p')
DB_PORT=$(echo $DATABASE_URL | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')
DB_USER=$(echo $DATABASE_URL | sed -n 's/.*\/\/\([^:]*\).*/\1/p')
DB_PASS=$(echo $DATABASE_URL | sed -n 's/.*:\([^@]*\)@.*/\1/p')
DB_NAME=$(echo $DATABASE_URL | sed -n 's/.*\/\([^?]*\).*/\1/p')

echo "Database Configuration:"
echo "  Host: $DB_HOST"
echo "  Port: $DB_PORT"
echo "  User: $DB_USER"
echo "  Database: $DB_NAME"
echo ""

# Test database connection
echo "Testing database connection..."
PGPASSWORD=$DB_PASS psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "SELECT version();" > /dev/null 2>&1

if [ $? -eq 0 ]; then
    echo "✓ Database connection successful"
else
    echo "❌ Failed to connect to database"
    exit 1
fi
echo ""

# Run migrations for insurance-platform Go services
echo "======================================"
echo "Running Go Services Migrations"
echo "======================================"
echo ""

if [ -f "/home/ubuntu/insurance-platform/init-all-databases.sql" ]; then
    echo "Applying schema migrations..."
    PGPASSWORD=$DB_PASS psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f /home/ubuntu/insurance-platform/init-all-databases.sql
    
    if [ $? -eq 0 ]; then
        echo "✓ Go services schema applied successfully"
    else
        echo "⚠️  Warning: Some migrations may have failed"
    fi
else
    echo "⚠️  Warning: init-all-databases.sql not found"
fi
echo ""

# 2026-10-03 (W7-B11): Customer Portal migration block removed — it cd'd into
# /home/ubuntu/customer-portal-full and ran `pnpm db:push`; that app is retired
# (succeeded by the monolith member portal, /member/*). Member-portal schema is
# managed by the monolith's own drizzle migrations from the repo root.
echo ""

# Setup telco service database
echo "======================================"
echo "Running Telco Service Migrations"
echo "======================================"
echo ""

TELCO_DB_URL="${DATABASE_URL/insurance_db/telco_db}"

echo "Creating telco_db if not exists..."
PGPASSWORD=$DB_PASS psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d postgres -c "CREATE DATABASE telco_db;" 2>/dev/null || echo "Database telco_db already exists"

if [ -f "/home/ubuntu/telco-data-integration-service/migrations/init.sql" ]; then
    PGPASSWORD=$DB_PASS psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d telco_db -f /home/ubuntu/telco-data-integration-service/migrations/init.sql
    echo "✓ Telco service schema applied"
else
    echo "Creating telco service tables..."
    PGPASSWORD=$DB_PASS psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d telco_db <<EOF
CREATE TABLE IF NOT EXISTS telco_data (
    id VARCHAR(36) PRIMARY KEY,
    customer_id VARCHAR(36) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    phone_number VARCHAR(20) NOT NULL,
    account_age_months INTEGER,
    monthly_spend DECIMAL(10,2),
    data_usage_gb DECIMAL(10,2),
    airtime_spend DECIMAL(10,2),
    late_payments INTEGER DEFAULT 0,
    failed_transactions INTEGER DEFAULT 0,
    last_recharge_date TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS credit_scores (
    id VARCHAR(36) PRIMARY KEY,
    customer_id VARCHAR(36) NOT NULL,
    score INTEGER NOT NULL,
    score_category VARCHAR(20),
    payment_history_score DECIMAL(5,2),
    account_age_score DECIMAL(5,2),
    spending_consistency_score DECIMAL(5,2),
    usage_pattern_score DECIMAL(5,2),
    account_health_score DECIMAL(5,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS loan_applications (
    id VARCHAR(36) PRIMARY KEY,
    customer_id VARCHAR(36) NOT NULL,
    credit_score INTEGER,
    loan_amount DECIMAL(12,2),
    status VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS loan_outcomes (
    id VARCHAR(36) PRIMARY KEY,
    application_id VARCHAR(36) REFERENCES loan_applications(id),
    defaulted BOOLEAN DEFAULT FALSE,
    days_past_due INTEGER DEFAULT 0,
    final_status VARCHAR(20),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_telco_customer ON telco_data(customer_id);
CREATE INDEX idx_credit_customer ON credit_scores(customer_id);
CREATE INDEX idx_loan_customer ON loan_applications(customer_id);

EOF
    echo "✓ Telco service schema created"
fi
echo ""

# Setup fraud database
echo "======================================"
echo "Running Fraud Database Migrations"
echo "======================================"
echo ""

FRAUD_DB_URL="${DATABASE_URL/insurance_db/fraud_db}"

echo "Creating fraud_db if not exists..."
PGPASSWORD=$DB_PASS psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d postgres -c "CREATE DATABASE fraud_db;" 2>/dev/null || echo "Database fraud_db already exists"

PGPASSWORD=$DB_PASS psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d fraud_db <<EOF
CREATE TABLE IF NOT EXISTS fraud_records (
    id VARCHAR(36) PRIMARY KEY,
    company_id VARCHAR(36) NOT NULL,
    customer_identifier VARCHAR(255) NOT NULL,
    fraud_type VARCHAR(50) NOT NULL,
    amount DECIMAL(12,2),
    description TEXT,
    reported_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'reported'
);

CREATE TABLE IF NOT EXISTS companies (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    api_key VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fraud_checks (
    id VARCHAR(36) PRIMARY KEY,
    company_id VARCHAR(36) NOT NULL,
    customer_identifier VARCHAR(255) NOT NULL,
    match_count INTEGER DEFAULT 0,
    risk_level VARCHAR(20),
    checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_fraud_customer ON fraud_records(customer_identifier);
CREATE INDEX idx_fraud_company ON fraud_records(company_id);
CREATE INDEX idx_check_customer ON fraud_checks(customer_identifier);

EOF
echo "✓ Fraud database schema created"
echo ""

# Summary
echo "======================================"
echo "Database Setup Complete!"
echo "======================================"
echo ""
echo "Databases configured:"
echo "  ✓ insurance_db (Go services + customer portal)"
echo "  ✓ telco_db (credit scoring + ML)"
echo "  ✓ fraud_db (cross-company fraud detection)"
echo ""
echo "Next steps:"
echo "  1. Seed test data: ./seed-test-data.sh"
echo "  2. Start services: ./start-platform.sh"
echo "  3. Verify health: ./monitor-platform.sh"
echo ""
