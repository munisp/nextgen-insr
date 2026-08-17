package db

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/insureportal/microinsurance-engine/config"
	"github.com/insureportal/microinsurance-engine/models"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Postgres provides database access with a connection pool.
type Postgres struct {
	Pool *pgxpool.Pool
}

// NewPostgres creates a new database connection pool and verifies connectivity.
func NewPostgres(ctx context.Context, cfg *config.PostgresConfig) (*Postgres, error) {
	poolCfg, err := pgxpool.ParseConfig(cfg.DSN())
	if err != nil {
		return nil, fmt.Errorf("parse postgres config: %w", err)
	}
	poolCfg.MaxConns = int32(cfg.MaxOpenConns)
	poolCfg.MinConns = 3
	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		return nil, fmt.Errorf("connect to postgres: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("ping postgres: %w", err)
	}
	return &Postgres{Pool: pool}, nil
}

// Close releases the connection pool.
func (p *Postgres) Close() {
	if p != nil && p.Pool != nil {
		p.Pool.Close()
	}
}

// RunMigrations creates all tables and indexes required by the microinsurance engine.
func (p *Postgres) RunMigrations(ctx context.Context) error {
	migrations := []string{
		// Products table
		`CREATE TABLE IF NOT EXISTS micro_products (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			product_id VARCHAR(64) UNIQUE NOT NULL,
			name VARCHAR(255) NOT NULL,
			type VARCHAR(32) NOT NULL,
			description TEXT,
			premium DECIMAL(12,2) NOT NULL,
			currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
			coverage_amount DECIMAL(15,2) NOT NULL,
			coverage_type VARCHAR(32) NOT NULL DEFAULT 'benefit',
			duration VARCHAR(32) NOT NULL DEFAULT 'monthly',
			claim_sla VARCHAR(16) NOT NULL DEFAULT '48h',
			max_age INT NOT NULL DEFAULT 65,
			min_age INT NOT NULL DEFAULT 18,
			max_sum_insured DECIMAL(15,2) NOT NULL DEFAULT 0,
			waiting_period VARCHAR(32) DEFAULT '0',
			parametric_trigger TEXT,
			exclusions JSONB DEFAULT '[]'::jsonb,
			status VARCHAR(32) NOT NULL DEFAULT 'active',
			metadata JSONB DEFAULT '{}'::jsonb,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_products_type ON micro_products(type)`,
		`CREATE INDEX IF NOT EXISTS idx_products_status ON micro_products(status)`,
		`CREATE INDEX IF NOT EXISTS idx_products_product_id ON micro_products(product_id)`,

		// Enrollments table
		`CREATE TABLE IF NOT EXISTS enrollments (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			enrollment_id VARCHAR(64) UNIQUE NOT NULL,
			product_id UUID NOT NULL REFERENCES micro_products(id),
			customer_id VARCHAR(64) NOT NULL,
			phone_number VARCHAR(20),
			first_name VARCHAR(128),
			last_name VARCHAR(128),
			channel VARCHAR(32) NOT NULL,
			status VARCHAR(32) NOT NULL DEFAULT 'active',
			start_date DATE NOT NULL,
			end_date DATE NOT NULL,
			premium DECIMAL(12,2) NOT NULL,
			payment_method VARCHAR(32),
			group_id VARCHAR(64),
			ussd_code VARCHAR(32),
			next_payment_due DATE,
			auto_renew BOOLEAN NOT NULL DEFAULT true,
			metadata JSONB DEFAULT '{}'::jsonb,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_enrollments_customer ON enrollments(customer_id)`,
		`CREATE INDEX IF NOT EXISTS idx_enrollments_product ON enrollments(product_id)`,
		`CREATE INDEX IF NOT EXISTS idx_enrollments_status ON enrollments(status)`,
		`CREATE INDEX IF NOT EXISTS idx_enrollments_end_date ON enrollments(end_date)`,
		`CREATE INDEX IF NOT EXISTS idx_enrollments_enrollment_id ON enrollments(enrollment_id)`,

		// Claims table
		`CREATE TABLE IF NOT EXISTS claims (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			claim_id VARCHAR(64) UNIQUE NOT NULL,
			enrollment_id UUID NOT NULL REFERENCES enrollments(id),
			product_id UUID NOT NULL REFERENCES micro_products(id),
			customer_id VARCHAR(64) NOT NULL,
			type VARCHAR(32) NOT NULL,
			description TEXT,
			claim_amount DECIMAL(15,2) NOT NULL,
			settlement_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
			status VARCHAR(32) NOT NULL DEFAULT 'submitted',
			documents_required INT NOT NULL DEFAULT 3,
			documents_submitted INT NOT NULL DEFAULT 0,
			parametric_value DECIMAL(15,2),
			parametric_trigger VARCHAR(128),
			approved_by VARCHAR(128),
			approved_at TIMESTAMPTZ,
			rejected_at TIMESTAMPTZ,
			reject_reason TEXT,
			paid_at TIMESTAMPTZ,
			settlement_date TIMESTAMPTZ,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_claims_enrollment ON claims(enrollment_id)`,
		`CREATE INDEX IF NOT EXISTS idx_claims_customer ON claims(customer_id)`,
		`CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status)`,
		`CREATE INDEX IF NOT EXISTS idx_claims_claim_id ON claims(claim_id)`,

		// Micropayments table
		`CREATE TABLE IF NOT EXISTS micropayments (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			payment_id VARCHAR(64) UNIQUE NOT NULL,
			enrollment_id UUID NOT NULL REFERENCES enrollments(id),
			customer_id VARCHAR(64) NOT NULL,
			amount DECIMAL(12,2) NOT NULL,
			currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
			method VARCHAR(32) NOT NULL,
			status VARCHAR(32) NOT NULL DEFAULT 'completed',
			reference VARCHAR(128),
			period_from DATE NOT NULL,
			period_to DATE NOT NULL,
			paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			metadata JSONB DEFAULT '{}'::jsonb
		)`,
		`CREATE INDEX IF NOT EXISTS idx_payments_enrollment ON micropayments(enrollment_id)`,
		`CREATE INDEX IF NOT EXISTS idx_payments_customer ON micropayments(customer_id)`,
		`CREATE INDEX IF NOT EXISTS idx_payments_payment_id ON micropayments(payment_id)`,

		// Group policies table
		`CREATE TABLE IF NOT EXISTS group_policies (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			group_id VARCHAR(64) UNIQUE NOT NULL,
			group_name VARCHAR(255) NOT NULL,
			product_id UUID NOT NULL REFERENCES micro_products(id),
			product_type VARCHAR(32) NOT NULL DEFAULT 'crop',
			group_leader VARCHAR(255) NOT NULL,
			member_count INT NOT NULL DEFAULT 0,
			enrolled_count INT NOT NULL DEFAULT 0,
			premium_per_member DECIMAL(12,2) NOT NULL,
			total_premium DECIMAL(15,2) NOT NULL DEFAULT 0,
			status VARCHAR(32) NOT NULL DEFAULT 'active',
			start_date DATE NOT NULL,
			end_date DATE NOT NULL,
			metadata JSONB DEFAULT '{}'::jsonb,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_groups_group_id ON group_policies(group_id)`,
		`CREATE INDEX IF NOT EXISTS idx_groups_status ON group_policies(status)`,

		// USSD sessions table
		`CREATE TABLE IF NOT EXISTS ussd_sessions (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			phone_number VARCHAR(20) NOT NULL,
			session_id VARCHAR(128) UNIQUE NOT NULL,
			step INT NOT NULL DEFAULT 1,
			status VARCHAR(32) NOT NULL DEFAULT 'active',
			product_id UUID REFERENCES micro_products(id),
			customer_info JSONB DEFAULT '{}'::jsonb,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			expires_at TIMESTAMPTZ NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_ussd_phone ON ussd_sessions(phone_number)`,
		`CREATE INDEX IF NOT EXISTS idx_ussd_session ON ussd_sessions(session_id)`,

		// Parametric triggers table
		`CREATE TABLE IF NOT EXISTS parametric_triggers (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			product_id UUID NOT NULL REFERENCES micro_products(id),
			trigger_type VARCHAR(64) NOT NULL,
			trigger_value DECIMAL(12,2) NOT NULL,
			threshold DECIMAL(12,2) NOT NULL,
			triggered BOOLEAN NOT NULL DEFAULT false,
			triggered_at TIMESTAMPTZ,
			data_source VARCHAR(128),
			data_reference VARCHAR(256),
			total_payout DECIMAL(15,2) NOT NULL DEFAULT 0,
			enrolled_count INT NOT NULL DEFAULT 0,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_triggers_product ON parametric_triggers(product_id)`,
		`CREATE INDEX IF NOT EXISTS idx_triggers_triggered ON parametric_triggers(triggered)`,
	}

	for _, migration := range migrations {
		if _, err := p.Pool.Exec(ctx, migration); err != nil {
			return fmt.Errorf("execute migration: %w", err)
		}
	}
	return nil
}

// ===== Products CRUD =====

// InsertProduct creates a new product record. Returns the created product.
func (p *Postgres) InsertProduct(ctx context.Context, product *models.MicroProduct) error {
	exclusionsJSON, _ := toJSON(product.Exclusions)
	metadataJSON, _ := toJSON(product.Metadata)

	_, err := p.Pool.Exec(ctx, `
		INSERT INTO micro_products
			(id, product_id, name, type, description, premium, currency,
			 coverage_amount, coverage_type, duration, claim_sla, max_age, min_age,
			 max_sum_insured, waiting_period, parametric_trigger, exclusions, status, metadata)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
		ON CONFLICT (product_id) DO UPDATE SET
			name=EXCLUDED.name, type=EXCLUDED.type, description=EXCLUDED.description,
			premium=EXCLUDED.premium, coverage_amount=EXCLUDED.coverage_amount,
			coverage_type=EXCLUDED.coverage_type, duration=EXCLUDED.duration,
			claim_sla=EXCLUDED.claim_sla, max_age=EXCLUDED.max_age, min_age=EXCLUDED.min_age,
			max_sum_insured=EXCLUDED.max_sum_insured, waiting_period=EXCLUDED.waiting_period,
			parametric_trigger=EXCLUDED.parametric_trigger, exclusions=EXCLUDED.exclusions,
			status=EXCLUDED.status, metadata=EXCLUDED.metadata, updated_at=NOW()
	`, product.ID, product.ProductID, product.Name, string(product.Type), product.Description,
		product.Premium, product.Currency, product.CoverageAmount, string(product.CoverageType),
		product.Duration, product.ClaimSLA, product.MaxAge, product.MinAge, product.MaxSumInsured,
		product.WaitingPeriod, product.ParametricTrigger, exclusionsJSON, string(product.Status), metadataJSON)
	return err
}

// GetProduct retrieves a product by its UUID.
func (p *Postgres) GetProduct(ctx context.Context, id string) (*models.MicroProduct, error) {
	pd := &models.MicroProduct{}
	var exclusionsJSON, metadataJSON string
	err := p.Pool.QueryRow(ctx, `
		SELECT id, product_id, name, type, description, premium, currency, coverage_amount,
			coverage_type, duration, claim_sla, max_age, min_age, max_sum_insured,
			waiting_period, parametric_trigger, exclusions, status, metadata, created_at, updated_at
		FROM micro_products WHERE id = $1
	`, id).Scan(
		&pd.ID, &pd.ProductID, &pd.Name, (*string)(&pd.Type), &pd.Description,
		&pd.Premium, &pd.Currency, &pd.CoverageAmount, (*string)(&pd.CoverageType),
		&pd.Duration, &pd.ClaimSLA, &pd.MaxAge, &pd.MinAge, &pd.MaxSumInsured,
		&pd.WaitingPeriod, &pd.ParametricTrigger, &exclusionsJSON, (*string)(&pd.Status),
		&metadataJSON, &pd.CreatedAt, &pd.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	if err := fromJSON(exclusionsJSON, &pd.Exclusions); err != nil {
		pd.Exclusions = []string{}
	}
	if err := fromJSON(metadataJSON, &pd.Metadata); err != nil {
		pd.Metadata = map[string]any{}
	}
	return pd, nil
}

// ListProducts returns products with optional filtering and pagination.
func (p *Postgres) ListProducts(ctx context.Context, status, pType string, limit, offset int) ([]*models.MicroProduct, error) {
	query := `SELECT id, product_id, name, type, description, premium, currency, coverage_amount,
		coverage_type, duration, claim_sla, max_age, min_age, max_sum_insured, waiting_period,
		parametric_trigger, exclusions, status, metadata, created_at, updated_at FROM micro_products`
	args := []interface{}{}
	argCount := 1

	var conditions []string
	if status != "" {
		conditions = append(conditions, fmt.Sprintf("status = $%d", argCount))
		args = append(args, status)
		argCount++
	}
	if pType != "" {
		conditions = append(conditions, fmt.Sprintf("type = $%d", argCount))
		args = append(args, pType)
		argCount++
	}
	if len(conditions) > 0 {
		query += " WHERE " + strings.Join(conditions, " AND ")
	}
	query += fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", argCount, argCount+1)
	args = append(args, limit, offset)

	rows, err := p.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanProducts(rows)
}

// UpdateProduct updates an existing product and returns it.
func (p *Postgres) UpdateProduct(ctx context.Context, product *models.MicroProduct) error {
	exclusionsJSON, _ := toJSON(product.Exclusions)
	metadataJSON, _ := toJSON(product.Metadata)

	_, err := p.Pool.Exec(ctx, `
		UPDATE micro_products SET
			name=$1, description=$2, premium=$3, coverage_amount=$4,
			coverage_type=$5, duration=$6, claim_sla=$7, max_age=$8, min_age=$9,
			exclusions=$10, status=$11, metadata=$12, updated_at=NOW()
		WHERE id=$13
	`, product.Name, product.Description, product.Premium, product.CoverageAmount,
		string(product.CoverageType), product.Duration, product.ClaimSLA,
		product.MaxAge, product.MinAge, exclusionsJSON, string(product.Status),
		metadataJSON, product.ID)
	return err
}

// DeleteProduct soft-deletes a product by marking it retired.
func (p *Postgres) DeleteProduct(ctx context.Context, id string) error {
	_, err := p.Pool.Exec(ctx, `UPDATE micro_products SET status='retired', updated_at=NOW() WHERE id=$1`, id)
	return err
}

func scanProducts(rows pgx.Rows) ([]*models.MicroProduct, error) {
	var products []*models.MicroProduct
	for rows.Next() {
		pd := &models.MicroProduct{}
		var exclusionsJSON, metadataJSON string
		if err := rows.Scan(
			&pd.ID, &pd.ProductID, &pd.Name, (*string)(&pd.Type), &pd.Description,
			&pd.Premium, &pd.Currency, &pd.CoverageAmount, (*string)(&pd.CoverageType),
			&pd.Duration, &pd.ClaimSLA, &pd.MaxAge, &pd.MinAge, &pd.MaxSumInsured,
			&pd.WaitingPeriod, &pd.ParametricTrigger, &exclusionsJSON, (*string)(&pd.Status),
			&metadataJSON, &pd.CreatedAt, &pd.UpdatedAt,
		); err != nil {
			return nil, err
		}
		_ = fromJSON(exclusionsJSON, &pd.Exclusions)
		_ = fromJSON(metadataJSON, &pd.Metadata)
		products = append(products, pd)
	}
	return products, rows.Err()
}

// ===== Enrollments CRUD =====

// InsertEnrollment creates a new enrollment record.
func (p *Postgres) InsertEnrollment(ctx context.Context, enrollment *models.Enrollment) error {
	metadataJSON, _ := toJSON(enrollment.Metadata)
	_, err := p.Pool.Exec(ctx, `
		INSERT INTO enrollments
			(id, enrollment_id, product_id, customer_id, phone_number, first_name, last_name,
			 channel, status, start_date, end_date, premium, payment_method, group_id,
			 ussd_code, next_payment_due, auto_renew, metadata)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
		ON CONFLICT (enrollment_id) DO UPDATE SET
			channel=EXCLUDED.channel, status=EXCLUDED.status,
			start_date=EXCLUDED.start_date, end_date=EXCLUDED.end_date,
			premium=EXCLUDED.premium, payment_method=EXCLUDED.payment_method,
			group_id=EXCLUDED.group_id, next_payment_due=EXCLUDED.next_payment_due,
			auto_renew=EXCLUDED.auto_renew, metadata=EXCLUDED.metadata, updated_at=NOW()
	`, enrollment.ID, enrollment.EnrollmentID, enrollment.ProductID, enrollment.CustomerID,
		enrollment.PhoneNumber, enrollment.FirstName, enrollment.LastName,
		string(enrollment.Channel), string(enrollment.Status), enrollment.StartDate,
		enrollment.EndDate, enrollment.Premium, enrollment.PaymentMethod, enrollment.GroupID,
		enrollment.USSDCode, enrollment.NextPaymentDue, enrollment.AutoRenew, metadataJSON)
	return err
}

// GetEnrollment retrieves an enrollment by its UUID.
func (p *Postgres) GetEnrollment(ctx context.Context, id string) (*models.Enrollment, error) {
	e := &models.Enrollment{}
	var metadataJSON string
	err := p.Pool.QueryRow(ctx, `
		SELECT id, enrollment_id, product_id, customer_id, phone_number, first_name, last_name,
			channel, status, start_date, end_date, premium, payment_method, group_id,
			ussd_code, next_payment_due, auto_renew, metadata, created_at, updated_at
		FROM enrollments WHERE id = $1
	`, id).Scan(
		&e.ID, &e.EnrollmentID, &e.ProductID, &e.CustomerID, &e.PhoneNumber,
		&e.FirstName, &e.LastName, (*string)(&e.Channel), (*string)(&e.Status),
		&e.StartDate, &e.EndDate, &e.Premium, &e.PaymentMethod, &e.GroupID,
		&e.USSDCode, &e.NextPaymentDue, &e.AutoRenew, &metadataJSON,
		&e.CreatedAt, &e.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	_ = fromJSON(metadataJSON, &e.Metadata)
	return e, nil
}

// ListEnrollments returns enrollments with filtering and pagination. Returns (items, total).
func (p *Postgres) ListEnrollments(ctx context.Context, status, productID, customerID string, limit, offset int) ([]*models.Enrollment, int64, error) {
	base := `SELECT id, enrollment_id, product_id, customer_id, phone_number, first_name, last_name,
		channel, status, start_date, end_date, premium, payment_method, group_id,
		ussd_code, next_payment_due, auto_renew, metadata, created_at, updated_at FROM enrollments`

	var conditions []string
	var args []interface{}
	argCount := 1

	if status != "" {
		conditions = append(conditions, fmt.Sprintf("status = $%d", argCount))
		args = append(args, status)
		argCount++
	}
	if productID != "" {
		conditions = append(conditions, fmt.Sprintf("product_id = $%d", argCount))
		args = append(args, productID)
		argCount++
	}
	if customerID != "" {
		conditions = append(conditions, fmt.Sprintf("customer_id = $%d", argCount))
		args = append(args, customerID)
		argCount++
	}

	var whereClause string
	if len(conditions) > 0 {
		whereClause = "WHERE " + strings.Join(conditions, " AND ")
	}

	// Count total
	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM enrollments %s", whereClause)
	var total int64
	if err := p.Pool.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	// Paginate
	query := fmt.Sprintf("%s %s ORDER BY created_at DESC LIMIT $%d OFFSET $%d",
		base, whereClause, argCount, argCount+1)
	args = append(args, limit, offset)

	rows, err := p.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	enrollments, err := scanEnrollments(rows)
	return enrollments, total, err
}

func scanEnrollments(rows pgx.Rows) ([]*models.Enrollment, error) {
	var enrollments []*models.Enrollment
	for rows.Next() {
		e := &models.Enrollment{}
		var metadataJSON string
		if err := rows.Scan(
			&e.ID, &e.EnrollmentID, &e.ProductID, &e.CustomerID, &e.PhoneNumber,
			&e.FirstName, &e.LastName, (*string)(&e.Channel), (*string)(&e.Status),
			&e.StartDate, &e.EndDate, &e.Premium, &e.PaymentMethod, &e.GroupID,
			&e.USSDCode, &e.NextPaymentDue, &e.AutoRenew, &metadataJSON,
			&e.CreatedAt, &e.UpdatedAt,
		); err != nil {
			return nil, err
		}
		_ = fromJSON(metadataJSON, &e.Metadata)
		enrollments = append(enrollments, e)
	}
	return enrollments, rows.Err()
}

// UpdateEnrollmentStatus updates the status of an enrollment.
func (p *Postgres) UpdateEnrollmentStatus(ctx context.Context, id, status string) error {
	_, err := p.Pool.Exec(ctx, "UPDATE enrollments SET status = $1, updated_at = NOW() WHERE id = $2", status, id)
	return err
}

// ===== Claims CRUD =====

// InsertClaim creates a new claim record. Returns the created claim.
func (p *Postgres) InsertClaim(ctx context.Context, claim *models.Claim) (*models.Claim, error) {
	_, err := p.Pool.Exec(ctx, `
		INSERT INTO claims
			(id, claim_id, enrollment_id, product_id, customer_id, type, description,
			 claim_amount, settlement_amount, status, documents_required, documents_submitted,
			 parametric_value, parametric_trigger, approved_by, approved_at, rejected_at,
			 reject_reason, paid_at, settlement_date)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
		ON CONFLICT (claim_id) DO UPDATE SET
			description=EXCLUDED.description, claim_amount=EXCLUDED.claim_amount,
			settlement_amount=EXCLUDED.settlement_amount, status=EXCLUDED.status,
			documents_submitted=EXCLUDED.documents_submitted, parametric_value=EXCLUDED.parametric_value,
			parametric_trigger=EXCLUDED.parametric_trigger, approved_by=EXCLUDED.approved_by,
			approved_at=EXCLUDED.approved_at, rejected_at=EXCLUDED.rejected_at,
			reject_reason=EXCLUDED.reject_reason, paid_at=EXCLUDED.paid_at,
			settlement_date=EXCLUDED.settlement_date, updated_at=NOW()
	`, claim.ID, claim.ClaimID, claim.EnrollmentID, claim.ProductID, claim.CustomerID,
		string(claim.Type), claim.Description, claim.ClaimAmount, claim.SettlementAmount,
		string(claim.Status), claim.DocumentsRequired, claim.DocumentsSubmitted,
		claim.ParametricValue, claim.ParametricTrigger, claim.ApprovedBy, claim.ApprovedAt,
		claim.RejectedAt, claim.RejectReason, claim.PaidAt, claim.SettlementDate)
	return claim, err
}

// GetClaim retrieves a claim by its unique claim_id string.
func (p *Postgres) GetClaim(ctx context.Context, claimID string) (*models.Claim, error) {
	c := &models.Claim{}
	err := p.Pool.QueryRow(ctx, `
		SELECT id, claim_id, enrollment_id, product_id, customer_id, type, description,
			claim_amount, settlement_amount, status, documents_required, documents_submitted,
			parametric_value, parametric_trigger, approved_by, approved_at, rejected_at,
			reject_reason, paid_at, settlement_date, created_at, updated_at
		FROM claims WHERE claim_id = $1
	`, claimID).Scan(
		&c.ID, &c.ClaimID, &c.EnrollmentID, &c.ProductID, &c.CustomerID, (*string)(&c.Type),
		&c.Description, &c.ClaimAmount, &c.SettlementAmount, (*string)(&c.Status),
		&c.DocumentsRequired, &c.DocumentsSubmitted, &c.ParametricValue, &c.ParametricTrigger,
		&c.ApprovedBy, &c.ApprovedAt, &c.RejectedAt, &c.RejectReason, &c.PaidAt,
		&c.SettlementDate, &c.CreatedAt, &c.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return c, nil
}

// ListClaims returns claims with filtering and pagination. Returns (items, total).
func (p *Postgres) ListClaims(ctx context.Context, status, customerID, enrollmentID string, limit, offset int) ([]*models.Claim, int64, error) {
	base := `SELECT id, claim_id, enrollment_id, product_id, customer_id, type, description,
		claim_amount, settlement_amount, status, documents_required, documents_submitted,
		parametric_value, parametric_trigger, approved_by, approved_at, rejected_at,
		reject_reason, paid_at, settlement_date, created_at, updated_at FROM claims`

	var conditions []string
	var args []interface{}
	argCount := 1

	if status != "" {
		conditions = append(conditions, fmt.Sprintf("status = $%d", argCount))
		args = append(args, status)
		argCount++
	}
	if customerID != "" {
		conditions = append(conditions, fmt.Sprintf("customer_id = $%d", argCount))
		args = append(args, customerID)
		argCount++
	}
	if enrollmentID != "" {
		conditions = append(conditions, fmt.Sprintf("enrollment_id = $%d", argCount))
		args = append(args, enrollmentID)
		argCount++
	}

	var whereClause string
	if len(conditions) > 0 {
		whereClause = "WHERE " + strings.Join(conditions, " AND ")
	}

	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM claims %s", whereClause)
	var total int64
	if err := p.Pool.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	query := fmt.Sprintf("%s %s ORDER BY created_at DESC LIMIT $%d OFFSET $%d",
		base, whereClause, argCount, argCount+1)
	args = append(args, limit, offset)

	rows, err := p.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	claims, err := scanClaims(rows)
	return claims, total, err
}

func scanClaims(rows pgx.Rows) ([]*models.Claim, error) {
	var claims []*models.Claim
	for rows.Next() {
		c := &models.Claim{}
		if err := rows.Scan(
			&c.ID, &c.ClaimID, &c.EnrollmentID, &c.ProductID, &c.CustomerID,
			(*string)(&c.Type), &c.Description, &c.ClaimAmount, &c.SettlementAmount,
			(*string)(&c.Status), &c.DocumentsRequired, &c.DocumentsSubmitted,
			&c.ParametricValue, &c.ParametricTrigger, &c.ApprovedBy, &c.ApprovedAt,
			&c.RejectedAt, &c.RejectReason, &c.PaidAt, &c.SettlementDate,
			&c.CreatedAt, &c.UpdatedAt,
		); err != nil {
			return nil, err
		}
		claims = append(claims, c)
	}
	return claims, rows.Err()
}

// UpdateClaimStatus updates a claim's status and metadata.
func (p *Postgres) UpdateClaimStatus(ctx context.Context, id string, claim *models.Claim) error {
	_, err := p.Pool.Exec(ctx, `
		UPDATE claims SET
			status=$1, settlement_amount=$2, parametric_value=$3, parametric_trigger=$4,
			approved_by=$5, approved_at=$6, rejected_at=$7, reject_reason=$8,
			paid_at=$9, settlement_date=$10, updated_at=NOW()
		WHERE id=$11
	`, string(claim.Status), claim.SettlementAmount, claim.ParametricValue,
		claim.ParametricTrigger, claim.ApprovedBy, claim.ApprovedAt, claim.RejectedAt,
		claim.RejectReason, claim.PaidAt, claim.SettlementDate, id)
	return err
}

// ===== Micropayments CRUD =====

// InsertMicropayment records a premium payment.
func (p *Postgres) InsertMicropayment(ctx context.Context, pay *models.Micropayment) error {
	metadataJSON, _ := toJSON(pay.Metadata)
	_, err := p.Pool.Exec(ctx, `
		INSERT INTO micropayments
			(id, payment_id, enrollment_id, customer_id, amount, currency, method,
			 status, reference, period_from, period_to, paid_at, metadata)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
		ON CONFLICT (payment_id) DO UPDATE SET
			status=EXCLUDED.status, reference=EXCLUDED.reference,
			period_from=EXCLUDED.period_from, period_to=EXCLUDED.period_to,
			paid_at=EXCLUDED.paid_at, metadata=EXCLUDED.metadata, updated_at=NOW()
	`, pay.ID, pay.PaymentID, pay.EnrollmentID, pay.CustomerID, pay.Amount,
		pay.Currency, pay.Method, pay.Status, pay.Reference, pay.PeriodFrom,
		pay.PeriodTo, pay.PaidAt, metadataJSON)
	return err
}

// GetPremiumSchedule returns upcoming premium payment schedules for active enrollments.
func (p *Postgres) GetPremiumSchedule(ctx context.Context, from time.Time, days int, status string) ([]*models.Enrollment, error) {
	to := from.AddDate(0, 0, days)

	query := `SELECT id, enrollment_id, product_id, customer_id, phone_number, first_name, last_name,
		channel, status, start_date, end_date, premium, payment_method, group_id,
		ussd_code, next_payment_due, auto_renew, metadata, created_at, updated_at
		FROM enrollments WHERE next_payment_due BETWEEN $1 AND $2`

	var args []interface{}
	argCount := 2
	if status != "" {
		query += fmt.Sprintf(" AND status = $%d", argCount)
		args = append(args, status)
		argCount++
	}
	query += " ORDER BY next_payment_due ASC"

	rows, err := p.Pool.Query(ctx, query, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanEnrollments(rows)
}

// ===== Group Policies CRUD =====

// InsertGroupPolicy creates a new group policy record.
func (p *Postgres) InsertGroupPolicy(ctx context.Context, group *models.GroupPolicy) error {
	metadataJSON, _ := toJSON(group.Metadata)
	_, err := p.Pool.Exec(ctx, `
		INSERT INTO group_policies
			(id, group_id, group_name, product_id, product_type, group_leader,
			 member_count, enrolled_count, premium_per_member, total_premium,
			 status, start_date, end_date, metadata)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
		ON CONFLICT (group_id) DO UPDATE SET
			group_name=EXCLUDED.group_name, product_id=EXCLUDED.product_id,
			member_count=EXCLUDED.member_count, enrolled_count=EXCLUDED.enrolled_count,
			premium_per_member=EXCLUDED.premium_per_member, total_premium=EXCLUDED.total_premium,
			status=EXCLUDED.status, start_date=EXCLUDED.start_date, end_date=EXCLUDED.end_date,
			metadata=EXCLUDED.metadata, updated_at=NOW()
	`, group.ID, group.GroupID, group.GroupName, group.ProductID, string(group.ProductType),
		group.GroupLeader, group.MemberCount, group.EnrolledCount, group.PremiumPerMember,
		group.TotalPremium, group.Status, group.StartDate, group.EndDate, metadataJSON)
	return err
}

// GetGroupPolicy retrieves a group policy by its UUID.
func (p *Postgres) GetGroupPolicy(ctx context.Context, id string) (*models.GroupPolicy, error) {
	g := &models.GroupPolicy{}
	var metadataJSON string
	err := p.Pool.QueryRow(ctx, `
		SELECT id, group_id, group_name, product_id, product_type, group_leader,
			member_count, enrolled_count, premium_per_member, total_premium, status,
			start_date, end_date, metadata, created_at
		FROM group_policies WHERE id = $1
	`, id).Scan(
		&g.ID, &g.GroupID, &g.GroupName, &g.ProductID, (*string)(&g.ProductType),
		&g.GroupLeader, &g.MemberCount, &g.EnrolledCount, &g.PremiumPerMember,
		&g.TotalPremium, &g.Status, &g.StartDate, &g.EndDate, &metadataJSON, &g.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	_ = fromJSON(metadataJSON, &g.Metadata)
	return g, nil
}

// ListGroupPolicies returns group policies with optional filtering and pagination.
func (p *Postgres) ListGroupPolicies(ctx context.Context, status string, limit, offset int) ([]*models.GroupPolicy, int64, error) {
	base := `SELECT id, group_id, group_name, product_id, product_type, group_leader,
		member_count, enrolled_count, premium_per_member, total_premium, status,
		start_date, end_date, metadata, created_at FROM group_policies`

	var conditions []string
	var args []interface{}
	argCount := 1

	if status != "" {
		conditions = append(conditions, fmt.Sprintf("status = $%d", argCount))
		args = append(args, status)
		argCount++
	}

	var whereClause string
	if len(conditions) > 0 {
		whereClause = "WHERE " + strings.Join(conditions, " AND ")
	}

	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM group_policies %s", whereClause)
	var total int64
	if err := p.Pool.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	query := fmt.Sprintf("%s %s ORDER BY created_at DESC LIMIT $%d OFFSET $%d",
		base, whereClause, argCount, argCount+1)
	args = append(args, limit, offset)

	rows, err := p.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var groups []*models.GroupPolicy
	for rows.Next() {
		g := &models.GroupPolicy{}
		var metadataJSON string
		if err := rows.Scan(
			&g.ID, &g.GroupID, &g.GroupName, &g.ProductID, (*string)(&g.ProductType),
			&g.GroupLeader, &g.MemberCount, &g.EnrolledCount, &g.PremiumPerMember,
			&g.TotalPremium, &g.Status, &g.StartDate, &g.EndDate, &metadataJSON, &g.CreatedAt,
		); err != nil {
			return nil, 0, err
		}
		_ = fromJSON(metadataJSON, &g.Metadata)
		groups = append(groups, g)
	}
	return groups, total, rows.Err()
}

// ===== Parametric Triggers CRUD =====

// InsertParametricTrigger creates a new trigger event record.
func (p *Postgres) InsertParametricTrigger(ctx context.Context, trigger *models.ParametricTrigger) error {
	_, err := p.Pool.Exec(ctx, `
		INSERT INTO parametric_triggers
			(id, product_id, trigger_type, trigger_value, threshold, triggered,
			 triggered_at, data_source, data_reference, total_payout, enrolled_count)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
	`, trigger.ID, trigger.ProductID, trigger.TriggerType, trigger.TriggerValue,
		trigger.Threshold, trigger.Triggered, trigger.TriggeredAt,
		trigger.DataSource, trigger.DataReference, trigger.TotalPayout, trigger.EnrolledCount)
	return err
}

// ListParametricTriggers returns trigger events with filtering and pagination.
func (p *Postgres) ListParametricTriggers(ctx context.Context, productID, triggered string, limit, offset int) ([]*models.ParametricTrigger, int64, error) {
	base := `SELECT id, product_id, trigger_type, trigger_value, threshold, triggered,
		triggered_at, data_source, data_reference, total_payout, enrolled_count, created_at
		FROM parametric_triggers`

	var conditions []string
	var args []interface{}
	argCount := 1

	if productID != "" {
		conditions = append(conditions, fmt.Sprintf("product_id = $%d", argCount))
		args = append(args, productID)
		argCount++
	}
	if triggered != "" {
		conditions = append(conditions, fmt.Sprintf("triggered = $%d", argCount))
		args = append(args, triggered == "true")
		argCount++
	}

	var whereClause string
	if len(conditions) > 0 {
		whereClause = "WHERE " + strings.Join(conditions, " AND ")
	}

	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM parametric_triggers %s", whereClause)
	var total int64
	if err := p.Pool.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	query := fmt.Sprintf("%s %s ORDER BY created_at DESC LIMIT $%d OFFSET $%d",
		base, whereClause, argCount, argCount+1)
	args = append(args, limit, offset)

	rows, err := p.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var triggers []*models.ParametricTrigger
	for rows.Next() {
		t := &models.ParametricTrigger{}
		if err := rows.Scan(
			&t.ID, &t.ProductID, &t.TriggerType, &t.TriggerValue, &t.Threshold,
			&t.Triggered, &t.TriggeredAt, &t.DataSource, &t.DataReference,
			&t.TotalPayout, &t.EnrolledCount, &t.CreatedAt,
		); err != nil {
			return nil, 0, err
		}
		triggers = append(triggers, t)
	}
	return triggers, total, rows.Err()
}

// ===== Metrics & Aggregations =====

// PolicyMetrics holds dashboard statistics for the microinsurance engine.
type PolicyMetrics struct {
	EnrollmentStats struct {
		TotalEnrolled  int64   `json:"total_enrolled"`
		ActivePolicies int64   `json:"active_policies"`
		ExpiringSoon   int64   `json:"expiring_soon"`
		TotalPremium   float64 `json:"total_premium"`
	} `json:"enrollment_stats"`
	ClaimStats struct {
		ClaimsThisPeriod int64   `json:"claims_this_period"`
		ClaimsApproved   int64   `json:"claims_approved"`
		ClaimsRejected   int64   `json:"claims_rejected"`
		TotalPayout      float64 `json:"total_payout"`
		AvgSettlement    float64 `json:"avg_settlement"`
	} `json:"claim_stats"`
	RevenueStats struct {
		TotalCollected  float64 `json:"total_collected"`
		AvgPremium      float64 `json:"avg_premium"`
		PendingPayments int64   `json:"pending_payments"`
		LossRatio       float64 `json:"loss_ratio"`
		PenetrationRate float64 `json:"penetration_rate"`
	} `json:"revenue_stats"`
}

// GetPolicyStats computes dashboard metrics from all tables.
func (p *Postgres) GetPolicyStats(ctx context.Context) (*PolicyMetrics, error) {
	stats := &PolicyMetrics{}

	// Enrollment stats
	if err := p.Pool.QueryRow(ctx, `
		SELECT COUNT(*), COUNT(CASE WHEN status='active' THEN 1 END),
			COUNT(CASE WHEN end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days' THEN 1 END),
			SUM(premium) FROM enrollments
	`).Scan(&stats.EnrollmentStats.TotalEnrolled, &stats.EnrollmentStats.ActivePolicies,
		&stats.EnrollmentStats.ExpiringSoon, &stats.EnrollmentStats.TotalPremium); err != nil {
		return nil, err
	}

	// Claim stats
	if err := p.Pool.QueryRow(ctx, `
		SELECT COUNT(*), COUNT(CASE WHEN status IN ('approved','paid','settled') THEN 1 END),
			COUNT(CASE WHEN status = 'rejected' THEN 1 END),
			COALESCE(SUM(settlement_amount), 0),
			COALESCE(AVG(settlement_amount), 0)
		FROM claims WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
	`).Scan(&stats.ClaimStats.ClaimsThisPeriod, &stats.ClaimStats.ClaimsApproved,
		&stats.ClaimStats.ClaimsRejected, &stats.ClaimStats.TotalPayout,
		&stats.ClaimStats.AvgSettlement); err != nil {
		return nil, err
	}

	// Revenue stats
	if err := p.Pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount), 0),
			COALESCE(AVG(amount), 0),
			COUNT(*)
		FROM micropayments WHERE status = 'completed'
	`).Scan(&stats.RevenueStats.TotalCollected, &stats.RevenueStats.AvgPremium,
		&stats.RevenueStats.PendingPayments); err != nil {
		return nil, err
	}

	// Loss ratio
	if stats.ClaimStats.TotalPayout > 0 && stats.EnrollmentStats.TotalPremium > 0 {
		stats.RevenueStats.LossRatio = float64(stats.ClaimStats.TotalPayout) / stats.EnrollmentStats.TotalPremium
	}

	// Penetration rate (estimates based on active policies vs population)
	stats.RevenueStats.PenetrationRate = float64(stats.EnrollmentStats.ActivePolicies) / 200000 * 100

	return stats, nil
}

// ---- JSON Helpers ----

// toJSON serializes a value to JSON bytes for storing in JSONB columns.
func toJSON(v interface{}) ([]byte, error) {
	return json.Marshal(v)
}

// fromJSON deserializes JSON bytes from a JSONB column into a Go value.
func fromJSON(data string, v interface{}) error {
	if data == "" || data == "null" {
		return nil
	}
	return json.Unmarshal([]byte(data), v)
}
