package db

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/insureportal/agent_commission_management/config"
	"github.com/insureportal/agent_commission_management/models"
	"go.uber.org/zap"
)

type PostgreSQL struct {
	db *sql.DB
}

func NewPostgreSQL(cfg *config.Config) (*PostgreSQL, error) {
	db, err := sql.Open("postgres", cfg.DSN())
	if err != nil {
		return nil, fmt.Errorf("postgres connect: %w", err)
	}
	db.SetMaxOpenConns(cfg.DBMaxConns)
	db.SetMaxIdleConns(cfg.DBMinConns)
	db.SetConnMaxLifetime(30 * time.Minute)
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("postgres ping: %w", err)
	}
	zap.L().Info("PostgreSQL connected", zap.String("host", cfg.DBHost), zap.Int("port", cfg.DBPort))
	pg := &PostgreSQL{db: db}
	if err := pg.Migrate(context.Background()); err != nil {
		return nil, fmt.Errorf("migration: %w", err)
	}
	return pg, nil
}

func (p *PostgreSQL) Close() error { return p.db.Close() }

func (p *PostgreSQL) Migrate(ctx context.Context) error {
	tables := []string{
		`CREATE TABLE IF NOT EXISTS commissions (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			commission_id VARCHAR(50) UNIQUE NOT NULL,
			agent_id VARCHAR(255) NOT NULL,
			agent_code VARCHAR(50),
			agent_name VARCHAR(255),
			policy_id VARCHAR(255),
			policy_number VARCHAR(50),
			product_code VARCHAR(50),
			product_type VARCHAR(50),
			commission_type VARCHAR(30) NOT NULL,
			premium REAL NOT NULL DEFAULT 0,
			commission_rate REAL NOT NULL DEFAULT 0,
			commission_amount REAL NOT NULL DEFAULT 0,
			net_commission REAL DEFAULT 0,
			withholding_tax REAL DEFAULT 0,
			payable_amount REAL DEFAULT 0,
			status VARCHAR(30) DEFAULT 'calculated',
			payment_date TIMESTAMP WITH TIME ZONE,
			payment_ref VARCHAR(255),
			bank_account VARCHAR(50),
			bank_name VARCHAR(255),
			issued_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			policy_start DATE,
			policy_end DATE,
			renewal_year INTEGER DEFAULT 1,
			is_renewal BOOLEAN DEFAULT FALSE,
			clawback_amount REAL DEFAULT 0,
			clawback_reason TEXT,
			notes TEXT,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_commissions_agent ON commissions(agent_id)`,
		`CREATE INDEX IF NOT EXISTS idx_commissions_policy ON commissions(policy_id)`,
		`CREATE INDEX IF NOT EXISTS idx_commissions_status ON commissions(status)`,
		`CREATE INDEX IF NOT EXISTS idx_commissions_issued ON commissions(issued_at)`,

		`CREATE TABLE IF NOT EXISTS commission_periods (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			agent_id VARCHAR(255) NOT NULL,
			period_start DATE NOT NULL,
			period_end DATE NOT NULL,
			total_premium REAL DEFAULT 0,
			total_commission REAL DEFAULT 0,
			total_clawbacks REAL DEFAULT 0,
			net_commission REAL DEFAULT 0,
			tax_amount REAL DEFAULT 0,
			payable_amount REAL DEFAULT 0,
			status VARCHAR(20) DEFAULT 'pending',
			paid_at TIMESTAMP WITH TIME ZONE,
			payment_ref VARCHAR(255),
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_periods_agent ON commission_periods(agent_id)`,
		`CREATE INDEX IF NOT EXISTS idx_periods_dates ON commission_periods(period_start, period_end)`,

		`CREATE TABLE IF NOT EXISTS agent_profiles (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			agent_code VARCHAR(50) UNIQUE NOT NULL,
			agent_name VARCHAR(255) NOT NULL,
			email VARCHAR(255),
			phone VARCHAR(50),
			license_no VARCHAR(100),
			license_expiry DATE,
			status VARCHAR(20) DEFAULT 'active',
			commission_rate REAL DEFAULT 0,
			bonus_threshold REAL DEFAULT 0,
			bonus_rate REAL DEFAULT 0,
			bank_account VARCHAR(50),
			bank_name VARCHAR(255),
			branch_code VARCHAR(50),
			region VARCHAR(100),
			products_authorized TEXT,
			join_date DATE,
			last_commission_date DATE,
			total_commission_earned REAL DEFAULT 0,
			total_policies INTEGER DEFAULT 0,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_agents_code ON agent_profiles(agent_code)`,
		`CREATE INDEX IF NOT EXISTS idx_agents_status ON agent_profiles(status)`,

		`CREATE TABLE IF NOT EXISTS commission_adjustments (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			commission_id VARCHAR(50) NOT NULL,
			adjustment_type VARCHAR(30) NOT NULL,
			original_amount REAL NOT NULL,
			adjustment_amount REAL NOT NULL,
			new_amount REAL NOT NULL,
			reason TEXT,
			approved_by VARCHAR(255),
			approved_at TIMESTAMP WITH TIME ZONE,
			status VARCHAR(20) DEFAULT 'pending',
			created_by VARCHAR(255),
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_adjustments_commission ON commission_adjustments(commission_id)`,

		`CREATE TABLE IF NOT EXISTS commission_reports (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			report_name VARCHAR(255),
			report_type VARCHAR(30),
			period_start DATE NOT NULL,
			period_end DATE NOT NULL,
			total_policies INTEGER DEFAULT 0,
			total_premium REAL DEFAULT 0,
			total_commission REAL DEFAULT 0,
			total_clawbacks REAL DEFAULT 0,
			net_commission REAL DEFAULT 0,
			total_tax REAL DEFAULT 0,
			payable_total REAL DEFAULT 0,
			agent_ids TEXT,
			product_codes TEXT,
			status VARCHAR(20) DEFAULT 'draft',
			generated_by VARCHAR(255),
			generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_reports_dates ON commission_reports(period_start, period_end)`,

		`CREATE TABLE IF NOT EXISTS payment_records (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			payment_id VARCHAR(50) UNIQUE NOT NULL,
			agent_id VARCHAR(255) NOT NULL,
			agent_code VARCHAR(50),
			agent_name VARCHAR(255),
			amount REAL NOT NULL,
			period_start DATE NOT NULL,
			period_end DATE NOT NULL,
			payment_date DATE NOT NULL,
			payment_method VARCHAR(30),
			bank_account VARCHAR(50),
			bank_name VARCHAR(255),
			status VARCHAR(20) DEFAULT 'processed',
			reference_no VARCHAR(255),
			commission_count INTEGER DEFAULT 0,
			commission_ids TEXT,
			notes TEXT,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_payments_agent ON payment_records(agent_id)`,
		`CREATE INDEX IF NOT EXISTS idx_payments_date ON payment_records(payment_date)`,
		`CREATE INDEX IF NOT EXISTS idx_payments_status ON payment_records(status)`,

		`CREATE TABLE IF NOT EXISTS clawbacks (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			commission_id VARCHAR(50) NOT NULL,
			agent_id VARCHAR(255) NOT NULL,
			policy_id VARCHAR(255),
			policy_number VARCHAR(50),
			original_amount REAL NOT NULL,
			clawback_amount REAL NOT NULL,
			clawback_reason VARCHAR(100),
			cancellation_date DATE NOT NULL,
			is_within_clawback_period BOOLEAN DEFAULT TRUE,
			status VARCHAR(20) DEFAULT 'pending',
			processed_at TIMESTAMP WITH TIME ZONE,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_clawbacks_commission ON clawbacks(commission_id)`,
		`CREATE INDEX IF NOT EXISTS idx_clawbacks_agent ON clawbacks(agent_id)`,
		`CREATE INDEX IF NOT EXISTS idx_clawbacks_status ON clawbacks(status)`,
	}

	for _, q := range tables {
		if _, err := p.db.ExecContext(ctx, q); err != nil {
			return fmt.Errorf("migrate '%s...': %w", q[:50], err)
		}
	}
	zap.L().Info("Agent commission management migrations completed")
	return nil
}

// --- Commission CRUD ---
func (p *PostgreSQL) CreateCommission(ctx context.Context, c *models.Commission) error {
	c.ID = uuid.New().String()
	c.CommissionID = "COM-" + time.Now().Format("20060102") + "-" + uuid.New().String()[:6]
	c.CreatedAt = time.Now()
	c.UpdatedAt = time.Now()
	c.IssuedAt = time.Now()
	c.Status = models.StatusCalculated

	// Calculate commission amount
	c.CommissionAmount = c.Premium * c.CommissionRate / 100.0
	c.NetCommission = c.CommissionAmount - c.ClawbackAmount
	c.WithholdingTax = c.NetCommission * 0.05 // 5% withholding tax
	c.PayableAmount = c.NetCommission - c.WithholdingTax

	query := `INSERT INTO commissions (id,commission_id,agent_id,agent_code,agent_name,policy_id,
		policy_number,product_code,product_type,commission_type,premium,commission_rate,
		commission_amount,net_commission,withholding_tax,payable_amount,status,
		policy_start,policy_end,renewal_year,is_renewal,clawback_amount,clawback_reason,notes)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`
	_, err := p.db.ExecContext(ctx, query, c.ID, c.CommissionID, c.AgentID, c.AgentCode, c.AgentName,
		c.PolicyID, c.PolicyNumber, c.ProductCode, c.ProductType, string(c.CommissionType),
		c.Premium, c.CommissionRate, c.CommissionAmount, c.NetCommission, c.WithholdingTax,
		c.PayableAmount, string(c.Status), c.PolicyStart, c.PolicyEnd, c.RenewalYear,
		c.IsRenewal, c.ClawbackAmount, c.ClawbackReason, c.Notes)
	return err
}

func (p *PostgreSQL) GetCommission(ctx context.Context, id string) (*models.Commission, error) {
	var c models.Commission
	q := `SELECT id,commission_id,agent_id,agent_code,agent_name,policy_id,policy_number,
		product_code,product_type,commission_type,premium,commission_rate,commission_amount,
		net_commission,withholding_tax,payable_amount,status,payment_date,payment_ref,
		bank_account,bank_name,issued_at,policy_start,policy_end,renewal_year,is_renewal,
		clawback_amount,clawback_reason,notes,created_at,updated_at
		FROM commissions WHERE id=$1`
	err := p.db.QueryRowContext(ctx, q, id).Scan(
		&c.ID, &c.CommissionID, &c.AgentID, &c.AgentCode, &c.AgentName, &c.PolicyID,
		&c.PolicyNumber, &c.ProductCode, &c.ProductType, &c.CommissionType, &c.Premium,
		&c.CommissionRate, &c.CommissionAmount, &c.NetCommission, &c.WithholdingTax,
		&c.PayableAmount, &c.Status, &c.PaymentDate, &c.PaymentRef, &c.BankAccount,
		&c.BankName, &c.IssuedAt, &c.PolicyStart, &c.PolicyEnd, &c.RenewalYear,
		&c.IsRenewal, &c.ClawbackAmount, &c.ClawbackReason, &c.Notes, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (p *PostgreSQL) GetCommissionByPolicy(ctx context.Context, policyID string) (*models.Commission, error) {
	var c models.Commission
	q := `SELECT id,commission_id,agent_id,agent_code,agent_name,policy_id,policy_number,
		product_code,product_type,commission_type,premium,commission_rate,commission_amount,
		net_commission,withholding_tax,payable_amount,status,payment_date,payment_ref,
		bank_account,bank_name,issued_at,policy_start,policy_end,renewal_year,is_renewal,
		clawback_amount,clawback_reason,notes,created_at,updated_at
		FROM commissions WHERE policy_id=$1`
	err := p.db.QueryRowContext(ctx, q, policyID).Scan(
		&c.ID, &c.CommissionID, &c.AgentID, &c.AgentCode, &c.AgentName, &c.PolicyID,
		&c.PolicyNumber, &c.ProductCode, &c.ProductType, &c.CommissionType, &c.Premium,
		&c.CommissionRate, &c.CommissionAmount, &c.NetCommission, &c.WithholdingTax,
		&c.PayableAmount, &c.Status, &c.PaymentDate, &c.PaymentRef, &c.BankAccount,
		&c.BankName, &c.IssuedAt, &c.PolicyStart, &c.PolicyEnd, &c.RenewalYear,
		&c.IsRenewal, &c.ClawbackAmount, &c.ClawbackReason, &c.Notes, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (p *PostgreSQL) GetCommissionByAgent(ctx context.Context, agentID, status string, limit, offset int) ([]models.Commission, error) {
	query := `SELECT id,commission_id,agent_id,agent_code,agent_name,policy_id,policy_number,
		product_code,product_type,commission_type,premium,commission_rate,commission_amount,
		net_commission,withholding_tax,payable_amount,status,payment_date,payment_ref,
		bank_account,bank_name,issued_at,policy_start,policy_end,renewal_year,is_renewal,
		clawback_amount,clawback_reason,notes,created_at,updated_at
		FROM commissions WHERE agent_id=$1`
	args := []interface{}{agentID}
	pos := 2
	if status != "" {
		query += fmt.Sprintf(" AND status=$%d", pos)
		args = append(args, status)
		pos++
	}
	query += " ORDER BY issued_at DESC"
	if limit > 0 {
		query += fmt.Sprintf(" LIMIT $%d", pos)
		args = append(args, limit)
		pos++
	}
	if offset > 0 {
		query += fmt.Sprintf(" OFFSET $%d", pos)
		args = append(args, offset)
	}

	rows, err := p.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	return scanCommissions(rows)
}

func (p *PostgreSQL) UpdateCommissionStatus(ctx context.Context, id, status string, paymentRef string) error {
	_, err := p.db.ExecContext(ctx,
		`UPDATE commissions SET status=$1, payment_ref=$2, payment_date=CASE WHEN $1='paid' THEN NOW() ELSE payment_date END,
		 updated_at=NOW() WHERE id=$3`, status, paymentRef, id)
	return err
}

func (p *PostgreSQL) CountCommissionsByStatus(ctx context.Context) (map[string]int64, error) {
	rows, err := p.db.QueryContext(ctx, `SELECT status, COUNT(*) FROM commissions GROUP BY status`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	result := make(map[string]int64)
	for rows.Next() {
		var status string
		var count int64
		if err := rows.Scan(&status, &count); err != nil {
			return nil, err
		}
		result[status] = count
	}
	return result, nil
}

func (p *PostgreSQL) GetCommissionTotals(ctx context.Context, agentID, periodStart, periodEnd string) (float64, float64, float64, error) {
	var totalCommission, totalNet, totalPayable float64
	err := p.db.QueryRowContext(ctx,
		`SELECT COALESCE(SUM(commission_amount),0), COALESCE(SUM(net_commission),0),
			COALESCE(SUM(payable_amount),0)
			FROM commissions WHERE agent_id=$1 AND issued_at BETWEEN $2 AND $3 AND status != 'voided'`,
		agentID, periodStart, periodEnd).Scan(&totalCommission, &totalNet, &totalPayable)
	if err != nil {
		return 0, 0, 0, err
	}
	return totalCommission, totalNet, totalPayable, nil
}

// --- Commission Periods ---
func (p *PostgreSQL) CreateCommissionPeriod(ctx context.Context, cp *models.CommissionPeriod) error {
	cp.ID = uuid.New().String()
	cp.CreatedAt = time.Now()
	query := `INSERT INTO commission_periods (id,agent_id,period_start,period_end,total_premium,
		total_commission,total_clawbacks,net_commission,tax_amount,payable_amount,status,paid_at,payment_ref)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`
	_, err := p.db.ExecContext(ctx, query, cp.ID, cp.AgentID, cp.PeriodStart, cp.PeriodEnd,
		cp.TotalPremium, cp.TotalCommission, cp.TotalClawbacks, cp.NetCommission,
		cp.TaxAmount, cp.PayableAmount, cp.Status, cp.PaidAt, cp.PaymentRef)
	return err
}

func (p *PostgreSQL) GetCommissionPeriods(ctx context.Context, agentID, status string, limit int) ([]models.CommissionPeriod, error) {
	query := `SELECT id,agent_id,period_start,period_end,total_premium,total_commission,
		total_clawbacks,net_commission,tax_amount,payable_amount,status,paid_at,payment_ref,created_at
		FROM commission_periods WHERE agent_id=$1`
	args := []interface{}{agentID}
	pos := 2
	if status != "" {
		query += fmt.Sprintf(" AND status=$%d", pos)
		args = append(args, status)
		pos++
	}
	query += " ORDER BY period_end DESC"
	if limit > 0 {
		query += fmt.Sprintf(" LIMIT $%d", pos)
		args = append(args, limit)
	}

	rows, err := p.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	return scanPeriods(rows)
}

// --- Agent Profiles ---
func (p *PostgreSQL) CreateAgentProfile(ctx context.Context, ap *models.AgentProfile) error {
	ap.ID = uuid.New().String()
	ap.CreatedAt = time.Now()
	ap.UpdatedAt = time.Now()
	query := `INSERT INTO agent_profiles (id,agent_code,agent_name,email,phone,license_no,
		license_expiry,status,commission_rate,bonus_threshold,bonus_rate,bank_account,
		bank_name,branch_code,region,products_authorized,join_date)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`
	_, err := p.db.ExecContext(ctx, query, ap.ID, ap.AgentCode, ap.AgentName, ap.Email, ap.Phone,
		ap.LicenseNo, ap.LicenseExpiry, ap.Status, ap.CommissionRate, ap.BonusThreshold,
		ap.BonusRate, ap.BankAccount, ap.BankName, ap.BranchCode, ap.Region,
		ap.ProductsAuthorized, ap.JoinDate)
	return err
}

func (p *PostgreSQL) GetAgentProfile(ctx context.Context, code string) (*models.AgentProfile, error) {
	var ap models.AgentProfile
	q := `SELECT id,agent_code,agent_name,email,phone,license_no,license_expiry,status,
		commission_rate,bonus_threshold,bonus_rate,bank_account,bank_name,branch_code,
		region,products_authorized,join_date,last_commission_date,total_commission_earned,
		total_policies,created_at,updated_at FROM agent_profiles WHERE agent_code=$1`
	err := p.db.QueryRowContext(ctx, q, code).Scan(
		&ap.ID, &ap.AgentCode, &ap.AgentName, &ap.Email, &ap.Phone, &ap.LicenseNo,
		&ap.LicenseExpiry, &ap.Status, &ap.CommissionRate, &ap.BonusThreshold,
		&ap.BonusRate, &ap.BankAccount, &ap.BankName, &ap.BranchCode, &ap.Region,
		&ap.ProductsAuthorized, &ap.JoinDate, &ap.LastCommissionDate,
		&ap.TotalCommissionEarned, &ap.TotalPolicies, &ap.CreatedAt, &ap.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &ap, nil
}

func (p *PostgreSQL) ListAgentProfiles(ctx context.Context, status string, limit, offset int) ([]models.AgentProfile, error) {
	query := `SELECT id,agent_code,agent_name,email,phone,license_no,license_expiry,status,
		commission_rate,bonus_threshold,bonus_rate,bank_account,bank_name,branch_code,
		region,products_authorized,join_date,last_commission_date,total_commission_earned,
		total_policies,created_at,updated_at FROM agent_profiles`
	args := []interface{}{}
	pos := 1
	if status != "" {
		query += fmt.Sprintf(" WHERE status=$%d", pos)
		args = append(args, status)
		pos++
	}
	query += " ORDER BY agent_name"
	if limit > 0 {
		query += fmt.Sprintf(" LIMIT $%d", pos)
		args = append(args, limit)
		pos++
	}
	if offset > 0 {
		query += fmt.Sprintf(" OFFSET $%d", pos)
		args = append(args, offset)
	}

	rows, err := p.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	return scanAgentProfiles(rows)
}

// --- Adjustments ---
func (p *PostgreSQL) CreateAdjustment(ctx context.Context, adj *models.CommissionAdjustment) error {
	adj.ID = uuid.New().String()
	adj.CreatedAt = time.Now()
	if adj.Status == "" {
		adj.Status = "pending"
	}
	query := `INSERT INTO commission_adjustments (id,commission_id,adjustment_type,original_amount,
		adjustment_amount,new_amount,reason,approved_by,approved_at,status,created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`
	_, err := p.db.ExecContext(ctx, query, adj.ID, adj.CommissionID, adj.AdjustmentType,
		adj.OriginalAmount, adj.AdjustmentAmount, adj.NewAmount, adj.Reason,
		adj.ApprovedBy, adj.ApprovedAt, adj.Status, adj.CreatedBy)
	return err
}

func (p *PostgreSQL) GetAdjustments(ctx context.Context, commissionID string) ([]models.CommissionAdjustment, error) {
	rows, err := p.db.QueryContext(ctx,
		`SELECT id,commission_id,adjustment_type,original_amount,adjustment_amount,new_amount,
			reason,approved_by,approved_at,status,created_by,created_at
			FROM commission_adjustments WHERE commission_id=$1 ORDER BY created_at DESC`, commissionID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	return scanAdjustments(rows)
}

func (p *PostgreSQL) ApproveAdjustment(ctx context.Context, adjustmentID, approvedBy string) error {
	now := time.Now()
	_, err := p.db.ExecContext(ctx,
		`UPDATE commission_adjustments SET status='approved', approved_by=$1, approved_at=$2 WHERE id=$3`,
		approvedBy, &now, adjustmentID)
	return err
}

// --- Reports ---
func (p *PostgreSQL) CreateCommissionReport(ctx context.Context, report *models.CommissionReport) error {
	report.ID = uuid.New().String()
	report.GeneratedAt = time.Now()
	query := `INSERT INTO commission_reports (id,report_name,report_type,period_start,period_end,
		total_policies,total_premium,total_commission,total_clawbacks,net_commission,total_tax,
		payable_total,agent_ids,product_codes,status,generated_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`
	_, err := p.db.ExecContext(ctx, query, report.ID, report.ReportName, report.ReportType,
		report.PeriodStart, report.PeriodEnd, report.TotalPolicies, report.TotalPremium,
		report.TotalCommission, report.TotalClawbacks, report.NetCommission, report.TotalTax,
		report.PayableTotal, report.AgentIDs, report.ProductCodes, report.Status, report.GeneratedBy)
	return err
}

func (p *PostgreSQL) GetCommissionReports(ctx context.Context, reportType, status string, limit int) ([]models.CommissionReport, error) {
	query := `SELECT id,report_name,report_type,period_start,period_end,total_policies,
		total_premium,total_commission,total_clawbacks,net_commission,total_tax,payable_total,
		agent_ids,product_codes,status,generated_by,generated_at FROM commission_reports`
	args := []interface{}{}
	pos := 1
	if reportType != "" {
		query += fmt.Sprintf(" WHERE report_type=$%d", pos)
		args = append(args, reportType)
		pos++
	}
	if status != "" {
		if len(args) > 0 {
			query += fmt.Sprintf(" AND status=$%d", pos)
		} else {
			query += fmt.Sprintf(" WHERE status=$%d", pos)
		}
		args = append(args, status)
		pos++
	}
	query += " ORDER BY generated_at DESC"
	if limit > 0 {
		query += fmt.Sprintf(" LIMIT $%d", pos)
		args = append(args, limit)
	}

	rows, err := p.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	return scanReports(rows)
}

// --- Payment Records ---
func (p *PostgreSQL) CreatePaymentRecord(ctx context.Context, pr *models.PaymentRecord) error {
	pr.ID = uuid.New().String()
	pr.PaymentID = "PAY-" + time.Now().Format("20060102150405")
	pr.CreatedAt = time.Now()
	query := `INSERT INTO payment_records (id,payment_id,agent_id,agent_code,agent_name,amount,
		period_start,period_end,payment_date,payment_method,bank_account,bank_name,status,
		reference_no,commission_count,commission_ids,notes)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`
	_, err := p.db.ExecContext(ctx, query, pr.ID, pr.PaymentID, pr.AgentID, pr.AgentCode,
		pr.AgentName, pr.Amount, pr.PeriodStart, pr.PeriodEnd, pr.PaymentDate, pr.PaymentMethod,
		pr.BankAccount, pr.BankName, pr.Status, pr.ReferenceNo, pr.CommissionCount,
		pr.CommissionIDs, pr.Notes)
	return err
}

func (p *PostgreSQL) GetPaymentRecords(ctx context.Context, agentID, status string, limit int) ([]models.PaymentRecord, error) {
	query := `SELECT id,payment_id,agent_id,agent_code,agent_name,amount,period_start,period_end,
		payment_date,payment_method,bank_account,bank_name,status,reference_no,commission_count,
		commission_ids,notes,created_at FROM payment_records WHERE agent_id=$1`
	args := []interface{}{agentID}
	pos := 2
	if status != "" {
		query += fmt.Sprintf(" AND status=$%d", pos)
		args = append(args, status)
		pos++
	}
	query += " ORDER BY payment_date DESC"
	if limit > 0 {
		query += fmt.Sprintf(" LIMIT $%d", pos)
		args = append(args, limit)
	}

	rows, err := p.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	return scanPayments(rows)
}

// --- Clawbacks ---
func (p *PostgreSQL) CreateClawback(ctx context.Context, cb *models.Clawback) error {
	cb.ID = uuid.New().String()
	cb.CreatedAt = time.Now()
	if cb.Status == "" {
		cb.Status = "pending"
	}
	query := `INSERT INTO clawbacks (id,commission_id,agent_id,policy_id,policy_number,
		original_amount,clawback_amount,clawback_reason,cancellation_date,
		is_within_clawback_period,status,processed_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`
	_, err := p.db.ExecContext(ctx, query, cb.ID, cb.CommissionID, cb.AgentID, cb.PolicyID,
		cb.PolicyNumber, cb.OriginalAmount, cb.ClawbackAmount, cb.ClawbackReason,
		cb.CancellationDate, cb.IsWithinClawbackPeriod, cb.Status, cb.ProcessedAt)
	return err
}

func (p *PostgreSQL) GetPendingClawbacks(ctx context.Context, limit int) ([]models.Clawback, error) {
	query := `SELECT id,commission_id,agent_id,policy_id,policy_number,original_amount,
		clawback_amount,clawback_reason,cancellation_date,is_within_clawback_period,
		status,processed_at,created_at FROM clawbacks WHERE status='pending'`
	if limit > 0 {
		query += fmt.Sprintf(" ORDER BY cancellation_date DESC LIMIT $%d", limit+1)
	}
	rows, err := p.db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	return scanClawbacks(rows)
}

func (p *PostgreSQL) ProcessClawback(ctx context.Context, id string) error {
	now := time.Now()
	_, err := p.db.ExecContext(ctx,
		`UPDATE clawbacks SET status='processed', processed_at=$1 WHERE id=$2`, &now, id)
	return err
}

// --- Helpers ---
func scanCommissions(rows *sql.Rows) ([]models.Commission, error) {
	var commissions []models.Commission
	for rows.Next() {
		var c models.Commission
		err := rows.Scan(&c.ID, &c.CommissionID, &c.AgentID, &c.AgentCode, &c.AgentName,
			&c.PolicyID, &c.PolicyNumber, &c.ProductCode, &c.ProductType, &c.CommissionType,
			&c.Premium, &c.CommissionRate, &c.CommissionAmount, &c.NetCommission, &c.WithholdingTax,
			&c.PayableAmount, &c.Status, &c.PaymentDate, &c.PaymentRef, &c.BankAccount,
			&c.BankName, &c.IssuedAt, &c.PolicyStart, &c.PolicyEnd, &c.RenewalYear,
			&c.IsRenewal, &c.ClawbackAmount, &c.ClawbackReason, &c.Notes, &c.CreatedAt, &c.UpdatedAt)
		if err != nil {
			return nil, err
		}
		commissions = append(commissions, c)
	}
	return commissions, nil
}

func scanPeriods(rows *sql.Rows) ([]models.CommissionPeriod, error) {
	var periods []models.CommissionPeriod
	for rows.Next() {
		var p models.CommissionPeriod
		err := rows.Scan(&p.ID, &p.AgentID, &p.PeriodStart, &p.PeriodEnd, &p.TotalPremium,
			&p.TotalCommission, &p.TotalClawbacks, &p.NetCommission, &p.TaxAmount,
			&p.PayableAmount, &p.Status, &p.PaidAt, &p.PaymentRef, &p.CreatedAt)
		if err != nil {
			return nil, err
		}
		periods = append(periods, p)
	}
	return periods, nil
}

func scanAgentProfiles(rows *sql.Rows) ([]models.AgentProfile, error) {
	var agents []models.AgentProfile
	for rows.Next() {
		var ap models.AgentProfile
		err := rows.Scan(&ap.ID, &ap.AgentCode, &ap.AgentName, &ap.Email, &ap.Phone,
			&ap.LicenseNo, &ap.LicenseExpiry, &ap.Status, &ap.CommissionRate,
			&ap.BonusThreshold, &ap.BonusRate, &ap.BankAccount, &ap.BankName, &ap.BranchCode,
			&ap.Region, &ap.ProductsAuthorized, &ap.JoinDate, &ap.LastCommissionDate,
			&ap.TotalCommissionEarned, &ap.TotalPolicies, &ap.CreatedAt, &ap.UpdatedAt)
		if err != nil {
			return nil, err
		}
		agents = append(agents, ap)
	}
	return agents, nil
}

func scanAdjustments(rows *sql.Rows) ([]models.CommissionAdjustment, error) {
	var adj []models.CommissionAdjustment
	for rows.Next() {
		var a models.CommissionAdjustment
		err := rows.Scan(&a.ID, &a.CommissionID, &a.AdjustmentType, &a.OriginalAmount,
			&a.AdjustmentAmount, &a.NewAmount, &a.Reason, &a.ApprovedBy, &a.ApprovedAt,
			&a.Status, &a.CreatedBy, &a.CreatedAt)
		if err != nil {
			return nil, err
		}
		adj = append(adj, a)
	}
	return adj, nil
}

func scanReports(rows *sql.Rows) ([]models.CommissionReport, error) {
	var reports []models.CommissionReport
	for rows.Next() {
		var r models.CommissionReport
		err := rows.Scan(&r.ID, &r.ReportName, &r.ReportType, &r.PeriodStart, &r.PeriodEnd,
			&r.TotalPolicies, &r.TotalPremium, &r.TotalCommission, &r.TotalClawbacks,
			&r.NetCommission, &r.TotalTax, &r.PayableTotal, &r.AgentIDs, &r.ProductCodes,
			&r.Status, &r.GeneratedBy, &r.GeneratedAt)
		if err != nil {
			return nil, err
		}
		reports = append(reports, r)
	}
	return reports, nil
}

func scanPayments(rows *sql.Rows) ([]models.PaymentRecord, error) {
	var payments []models.PaymentRecord
	for rows.Next() {
		var p models.PaymentRecord
		err := rows.Scan(&p.ID, &p.PaymentID, &p.AgentID, &p.AgentCode, &p.AgentName, &p.Amount,
			&p.PeriodStart, &p.PeriodEnd, &p.PaymentDate, &p.PaymentMethod, &p.BankAccount,
			&p.BankName, &p.Status, &p.ReferenceNo, &p.CommissionCount, &p.CommissionIDs,
			&p.Notes, &p.CreatedAt)
		if err != nil {
			return nil, err
		}
		payments = append(payments, p)
	}
	return payments, nil
}

func scanClawbacks(rows *sql.Rows) ([]models.Clawback, error) {
	var clawbacks []models.Clawback
	for rows.Next() {
		var cb models.Clawback
		err := rows.Scan(&cb.ID, &cb.CommissionID, &cb.AgentID, &cb.PolicyID, &cb.PolicyNumber,
			&cb.OriginalAmount, &cb.ClawbackAmount, &cb.ClawbackReason, &cb.CancellationDate,
			&cb.IsWithinClawbackPeriod, &cb.Status, &cb.ProcessedAt, &cb.CreatedAt)
		if err != nil {
			return nil, err
		}
		clawbacks = append(clawbacks, cb)
	}
	return clawbacks, nil
}
