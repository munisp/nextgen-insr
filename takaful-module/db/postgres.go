package db

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/insureportal/takaful_module/config"
	"github.com/insureportal/takaful_module/models"
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
		`CREATE TABLE IF NOT EXISTS takaful_products (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			product_code VARCHAR(50) UNIQUE NOT NULL,
			name VARCHAR(255) NOT NULL,
			description TEXT,
			category VARCHAR(50) NOT NULL,
			risk_type VARCHAR(50),
			min_contribution REAL NOT NULL DEFAULT 0,
			max_contribution REAL NOT NULL DEFAULT 0,
			max_sum_assured REAL NOT NULL DEFAULT 0,
			wakala_fee_percent REAL NOT NULL DEFAULT 30,
			participant_share REAL NOT NULL DEFAULT 70,
			tabarru_percent REAL NOT NULL DEFAULT 70,
			is_shariah_certified BOOLEAN DEFAULT FALSE,
			shariah_board_id UUID,
			shariah_cert_date TIMESTAMP WITH TIME ZONE,
			shariah_expiry_date TIMESTAMP WITH TIME ZONE,
			is_active BOOLEAN DEFAULT TRUE,
			max_coverage_amount REAL DEFAULT 0,
			waiting_period_days INTEGER DEFAULT 0,
			co_insurance_pct REAL DEFAULT 0,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_products_category ON takaful_products(category)`,
		`CREATE INDEX IF NOT EXISTS idx_products_active ON takaful_products(is_active)`,

		`CREATE TABLE IF NOT EXISTS participants (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			participant_code VARCHAR(50) UNIQUE NOT NULL,
			first_name VARCHAR(100) NOT NULL,
			last_name VARCHAR(100) NOT NULL,
			middle_name VARCHAR(100),
			nin VARCHAR(50),
			phone VARCHAR(20),
			email VARCHAR(255),
			dob DATE,
			gender VARCHAR(10),
			address TEXT,
			city VARCHAR(100),
			state VARCHAR(100),
			kyc_status VARCHAR(20) DEFAULT 'pending',
			kyc_verified_at TIMESTAMP WITH TIME ZONE,
			is_participant BOOLEAN DEFAULT FALSE,
			enrollment_date DATE DEFAULT CURRENT_DATE,
			last_contribution TIMESTAMP WITH TIME ZONE,
			total_contributions REAL DEFAULT 0,
			current_share REAL DEFAULT 0,
			surplus_balance REAL DEFAULT 0,
			status VARCHAR(20) DEFAULT 'active',
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_participants_nin ON participants(nin)`,
		`CREATE INDEX IF NOT EXISTS idx_participants_email ON participants(email)`,
		`CREATE INDEX IF NOT EXISTS idx_participants_status ON participants(status)`,

		`CREATE TABLE IF NOT EXISTS contributions (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			participant_id UUID NOT NULL REFERENCES participants(id),
			product_id UUID NOT NULL REFERENCES takaful_products(id),
			transaction_id VARCHAR(100) UNIQUE NOT NULL,
			amount REAL NOT NULL,
			tabarru_portion REAL NOT NULL DEFAULT 0,
			wakala_fee REAL NOT NULL DEFAULT 0,
			investment_portion REAL NOT NULL DEFAULT 0,
			payment_method VARCHAR(50),
			status VARCHAR(20) DEFAULT 'pending',
			processed_at TIMESTAMP WITH TIME ZONE,
			reference_no VARCHAR(100),
			notes TEXT,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_contributions_participant ON contributions(participant_id)`,
		`CREATE INDEX IF NOT EXISTS idx_contributions_product ON contributions(product_id)`,
		`CREATE INDEX IF NOT EXISTS idx_contributions_status ON contributions(status)`,

		`CREATE TABLE IF NOT EXISTS tabarru_pools (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			pool_name VARCHAR(255) NOT NULL,
			pool_type VARCHAR(50) NOT NULL,
			total_contributions REAL DEFAULT 0,
			total_claims REAL DEFAULT 0,
			current_balance REAL DEFAULT 0,
			investment_balance REAL DEFAULT 0,
			total_participants INTEGER DEFAULT 0,
			total_tabarru REAL DEFAULT 0,
			total_wakala_fee REAL DEFAULT 0,
			investment_return REAL DEFAULT 0,
			is_shariah_compliant BOOLEAN DEFAULT TRUE,
			period_start DATE,
			period_end DATE,
			status VARCHAR(20) DEFAULT 'active',
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_pools_status ON tabarru_pools(status)`,

		`CREATE TABLE IF NOT EXISTS surplus_distributions (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			period VARCHAR(20) NOT NULL,
			pool_id UUID NOT NULL REFERENCES tabarru_pools(id),
			total_surplus REAL NOT NULL DEFAULT 0,
			participant_share REAL NOT NULL DEFAULT 0,
			operator_share REAL NOT NULL DEFAULT 0,
			distribution_ratio VARCHAR(10) DEFAULT '70/30',
			participant_count INTEGER DEFAULT 0,
			avg_participant_share REAL DEFAULT 0,
			status VARCHAR(20) DEFAULT 'calculated',
			approved_by UUID,
			approved_at TIMESTAMP WITH TIME ZONE,
			distributed_at TIMESTAMP WITH TIME ZONE,
			notes TEXT,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_surplus_period ON surplus_distributions(period)`,

		`CREATE TABLE IF NOT EXISTS claims (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			claim_number VARCHAR(50) UNIQUE NOT NULL,
			participant_id UUID NOT NULL REFERENCES participants(id),
			product_id UUID NOT NULL REFERENCES takaful_products(id),
			pool_id UUID REFERENCES tabarru_pools(id),
			claim_type VARCHAR(50) NOT NULL,
			claim_amount REAL NOT NULL,
			deductible REAL DEFAULT 0,
			paid_amount REAL DEFAULT 0,
			rejection_reason TEXT,
			status VARCHAR(30) DEFAULT 'filed',
			filed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			approved_at TIMESTAMP WITH TIME ZONE,
			paid_at TIMESTAMP WITH TIME ZONE,
			reviewed_by UUID,
			claim_documents TEXT,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_claims_participant ON claims(participant_id)`,
		`CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status)`,

		`CREATE TABLE IF NOT EXISTS shariah_board (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			board_name VARCHAR(255) NOT NULL,
			member_name VARCHAR(255) NOT NULL,
			title VARCHAR(100),
			certification TEXT,
			appointed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			expiry_date DATE,
			is_active BOOLEAN DEFAULT TRUE,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,

		`CREATE TABLE IF NOT EXISTS product_approvals (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			product_id UUID NOT NULL REFERENCES takaful_products(id),
			shariah_board_id UUID NOT NULL REFERENCES shariah_board(id),
			approval_number VARCHAR(50),
			approved_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			expiry_date DATE,
			notes TEXT,
			is_certified BOOLEAN DEFAULT TRUE,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_approvals_product ON product_approvals(product_id)`,

		`CREATE TABLE IF NOT EXISTS zakat_records (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			participant_id UUID NOT NULL REFERENCES participants(id),
			year INTEGER NOT NULL,
			net_wealth REAL NOT NULL DEFAULT 0,
			nisab_threshold REAL NOT NULL,
			is_zakat_obliged BOOLEAN DEFAULT FALSE,
			zakat_rate REAL NOT NULL DEFAULT 0.025,
			zakat_amount REAL DEFAULT 0,
			paid BOOLEAN DEFAULT FALSE,
			paid_at TIMESTAMP WITH TIME ZONE,
			recipients TEXT,
			status VARCHAR(20) DEFAULT 'calculated',
			calculated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_zakat_participant ON zakat_records(participant_id)`,
		`CREATE INDEX IF NOT EXISTS idx_zakat_year ON zakat_records(year)`,

		`CREATE TABLE IF NOT EXISTS retakaful_entries (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			cession_number VARCHAR(50),
			participant_id UUID REFERENCES participants(id),
			product_id UUID REFERENCES takaful_products(id),
			retakaful_operator VARCHAR(255),
			ceded_amount REAL DEFAULT 0,
			ceded_percentage REAL DEFAULT 0,
			treaty_type VARCHAR(50),
			is_active BOOLEAN DEFAULT TRUE,
			effective_date DATE,
			expiry_date DATE,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_retakaful_active ON retakaful_entries(is_active)`,

		`CREATE TABLE IF NOT EXISTS pool_snapshots (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			pool_id UUID NOT NULL REFERENCES tabarru_pools(id),
			snapshot_date DATE NOT NULL,
			total_balance REAL NOT NULL,
			total_claims REAL NOT NULL,
			total_participants INTEGER NOT NULL,
			investment_return REAL DEFAULT 0,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_snapshots_pool ON pool_snapshots(pool_id)`,
		`CREATE INDEX IF NOT EXISTS idx_snapshots_date ON pool_snapshots(snapshot_date)`,
	}
	for _, q := range tables {
		if _, err := p.db.ExecContext(ctx, q); err != nil {
			return fmt.Errorf("migrate '%s...': %w", q[:50], err)
		}
	}
	zap.L().Info("Takaful migrations completed")
	return nil
}

// --- Product CRUD ---
func (p *PostgreSQL) CreateProduct(ctx context.Context, prod *models.TakafulProduct) error {
	prod.ID = uuid.New().String()
	query := `INSERT INTO takaful_products (id,product_code,name,description,category,risk_type,
		min_contribution,max_contribution,max_sum_assured,wakala_fee_percent,participant_share,
		tabarru_percent,is_shariah_certified,shariah_board_id,shariah_cert_date,shariah_expiry_date,
		is_active,max_coverage_amount,waiting_period_days,co_insurance_pct)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`
	_, err := p.db.ExecContext(ctx, query, prod.ID, prod.ProductCode, prod.Name, prod.Description,
		prod.Category, prod.RiskType, prod.MinContribution, prod.MaxContribution,
		prod.MaxSumAssured, prod.WakalaFeePercent, prod.ParticipantShare,
		prod.TabarruPercent, prod.IsShariahCertified, prod.ShariahBoardID,
		prod.ShariahCertDate, prod.ShariahExpiryDate, prod.IsActive,
		prod.MaxCoverageAmount, prod.WaitingPeriodDays, prod.CoInsurancePct)
	return err
}

func (p *PostgreSQL) GetProduct(ctx context.Context, id string) (*models.TakafulProduct, error) {
	var prod models.TakafulProduct
	q := `SELECT id,product_code,name,description,category,risk_type,min_contribution,max_contribution,
		max_sum_assured,wakala_fee_percent,participant_share,tabarru_percent,is_shariah_certified,
		shariah_board_id,shariah_cert_date,shariah_expiry_date,is_active,max_coverage_amount,
		waiting_period_days,co_insurance_pct,created_at,updated_at
		FROM takaful_products WHERE id=$1`
	err := p.db.QueryRowContext(ctx, q, id).Scan(
		&prod.ID, &prod.ProductCode, &prod.Name, &prod.Description, &prod.Category,
		&prod.RiskType, &prod.MinContribution, &prod.MaxContribution, &prod.MaxSumAssured,
		&prod.WakalaFeePercent, &prod.ParticipantShare, &prod.TabarruPercent,
		&prod.IsShariahCertified, &prod.ShariahBoardID, &prod.ShariahCertDate,
		&prod.ShariahExpiryDate, &prod.IsActive, &prod.MaxCoverageAmount,
		&prod.WaitingPeriodDays, &prod.CoInsurancePct, &prod.CreatedAt, &prod.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &prod, nil
}

func (p *PostgreSQL) ListProducts(ctx context.Context, category string, isActive bool) ([]models.TakafulProduct, error) {
	query := `SELECT id,product_code,name,description,category,risk_type,min_contribution,max_contribution,
		max_sum_assured,wakala_fee_percent,participant_share,tabarru_percent,is_shariah_certified,
		shariah_board_id,shariah_cert_date,shariah_expiry_date,is_active,max_coverage_amount,
		waiting_period_days,co_insurance_pct,created_at,updated_at
		FROM takaful_products`
	args := []interface{}{}
	pos := 1
	if category != "" {
		query += fmt.Sprintf(" WHERE category=$%d", pos)
		args = append(args, category)
		pos++
	}
	if !isActive {
		if len(args) > 0 {
			query += fmt.Sprintf(" AND is_active=$%d", pos)
		} else {
			query += fmt.Sprintf(" WHERE is_active=$%d", pos)
		}
		args = append(args, isActive)
	}
	query += " ORDER BY created_at DESC"
	rows, err := p.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	return scanProducts(rows)
}

// --- Participant CRUD ---
func (p *PostgreSQL) CreateParticipant(ctx context.Context, ptc *models.Participant) error {
	ptc.ID = uuid.New().String()
	ptc.ParticipantCode = "PTC-" + time.Now().Format("20060102") + "-" + uuid.New().String()[:6]
	ptc.CreatedAt = time.Now()
	ptc.UpdatedAt = time.Now()
	query := `INSERT INTO participants (id,participant_code,first_name,last_name,middle_name,nin,
		phone,email,dob,gender,address,city,state,kyc_status,enrollment_date,
		total_contributions,current_share,surplus_balance,status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`
	_, err := p.db.ExecContext(ctx, query, ptc.ID, ptc.ParticipantCode, ptc.FirstName,
		ptc.LastName, ptc.MiddleName, ptc.NIN, ptc.Phone, ptc.Email, ptc.DOB,
		ptc.Gender, ptc.Address, ptc.City, ptc.State, ptc.KYCStatus, ptc.EnrollmentDate,
		ptc.TotalContributions, ptc.CurrentShare, ptc.SurplusBalance, ptc.Status)
	return err
}

func (p *PostgreSQL) GetParticipant(ctx context.Context, id string) (*models.Participant, error) {
	var ptc models.Participant
	q := `SELECT id,participant_code,first_name,last_name,middle_name,nin,phone,email,dob,gender,
		address,city,state,kyc_status,kyc_verified_at,is_participant,enrollment_date,
		last_contribution,total_contributions,current_share,surplus_balance,status,created_at,updated_at
		FROM participants WHERE id=$1`
	err := p.db.QueryRowContext(ctx, q, id).Scan(
		&ptc.ID, &ptc.ParticipantCode, &ptc.FirstName, &ptc.LastName, &ptc.MiddleName,
		&ptc.NIN, &ptc.Phone, &ptc.Email, &ptc.DOB, &ptc.Gender, &ptc.Address,
		&ptc.City, &ptc.State, &ptc.KYCStatus, &ptc.KYCVerifiedAt, &ptc.IsParticipant,
		&ptc.EnrollmentDate, &ptc.LastContribution, &ptc.TotalContributions,
		&ptc.CurrentShare, &ptc.SurplusBalance, &ptc.Status, &ptc.CreatedAt, &ptc.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &ptc, nil
}

func (p *PostgreSQL) UpdateParticipantKYC(ctx context.Context, id string, status string, verifiedAt time.Time) error {
	_, err := p.db.ExecContext(ctx,
		`UPDATE participants SET kyc_status=$1, kyc_verified_at=$2, updated_at=NOW() WHERE id=$3`,
		status, verifiedAt, id)
	return err
}

func (p *PostgreSQL) ListParticipants(ctx context.Context, status, kycStatus string, limit, offset int) ([]models.Participant, error) {
	query := `SELECT id,participant_code,first_name,last_name,middle_name,nin,phone,email,dob,gender,
		address,city,state,kyc_status,kyc_verified_at,is_participant,enrollment_date,
		last_contribution,total_contributions,current_share,surplus_balance,status,created_at,updated_at
		FROM participants WHERE 1=1`
	args := []interface{}{}
	pos := 1
	if status != "" {
		query += fmt.Sprintf(" AND status=$%d", pos)
		args = append(args, status)
		pos++
	}
	if kycStatus != "" {
		query += fmt.Sprintf(" AND kyc_status=$%d", pos)
		args = append(args, kycStatus)
		pos++
	}
	query += " ORDER BY created_at DESC"
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
	return scanParticipants(rows)
}

// --- Contribution CRUD ---
func (p *PostgreSQL) CreateContribution(ctx context.Context, contrib *models.Contribution) error {
	contrib.ID = uuid.New().String()
	contrib.CreatedAt = time.Now()
	query := `INSERT INTO contributions (id,participant_id,product_id,transaction_id,amount,
		tabarru_portion,wakala_fee,investment_portion,payment_method,status,reference_no,notes)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`
	_, err := p.db.ExecContext(ctx, query, contrib.ID, contrib.ParticipantID, contrib.ProductID,
		contrib.TransactionID, contrib.Amount, contrib.TabarruPortion, contrib.WakalaFee,
		contrib.InvestmentPortion, contrib.PaymentMethod, contrib.Status,
		contrib.ReferenceNo, contrib.Notes)
	return err
}

func (p *PostgreSQL) GetContribution(ctx context.Context, id string) (*models.Contribution, error) {
	var c models.Contribution
	q := `SELECT id,participant_id,product_id,transaction_id,amount,tabarru_portion,wakala_fee,
		investment_portion,payment_method,status,processed_at,reference_no,notes,created_at
		FROM contributions WHERE id=$1`
	err := p.db.QueryRowContext(ctx, q, id).Scan(
		&c.ID, &c.ParticipantID, &c.ProductID, &c.TransactionID, &c.Amount,
		&c.TabarruPortion, &c.WakalaFee, &c.InvestmentPortion, &c.PaymentMethod,
		&c.Status, &c.ProcessedAt, &c.ReferenceNo, &c.Notes, &c.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (p *PostgreSQL) GetContributionsByParticipant(ctx context.Context, participantID string, limit int) ([]models.Contribution, error) {
	query := `SELECT id,participant_id,product_id,transaction_id,amount,tabarru_portion,wakala_fee,
		investment_portion,payment_method,status,processed_at,reference_no,notes,created_at
		FROM contributions WHERE participant_id=$1 ORDER BY created_at DESC`
	var rows *sql.Rows
	var err error
	if limit > 0 {
		query += " LIMIT $2"
		rows, err = p.db.QueryContext(ctx, query, participantID, limit)
	} else {
		rows, err = p.db.QueryContext(ctx, query, participantID)
	}
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	return scanContributions(rows)
}

// --- Pool CRUD ---
func (p *PostgreSQL) UpsertPool(ctx context.Context, pool *models.TabarruPool) error {
	if pool.ID == "" {
		pool.ID = uuid.New().String()
	}
	pool.UpdatedAt = time.Now()
	query := `INSERT INTO tabarru_pools (id,pool_name,pool_type,total_contributions,total_claims,
		current_balance,investment_balance,total_participants,total_tabarru,total_wakala_fee,
		investment_return,is_shariah_compliant,period_start,period_end,status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
		ON CONFLICT (id) DO UPDATE SET current_balance=EXCLUDED.current_balance,
		total_claims=EXCLUDED.total_claims,updated_at=NOW()`
	_, err := p.db.ExecContext(ctx, query, pool.ID, pool.PoolName, pool.PoolType,
		pool.TotalContributions, pool.TotalClaims, pool.CurrentBalance,
		pool.InvestmentBalance, pool.TotalParticipants, pool.TotalTabarru,
		pool.TotalWakalaFee, pool.InvestmentReturn, pool.IsShariahCompliant,
		pool.PeriodStart, pool.PeriodEnd, pool.Status)
	return err
}

func (p *PostgreSQL) GetPool(ctx context.Context, id string) (*models.TabarruPool, error) {
	var pool models.TabarruPool
	q := `SELECT id,pool_name,pool_type,total_contributions,total_claims,current_balance,
		investment_balance,total_participants,total_tabarru,total_wakala_fee,investment_return,
		is_shariah_compliant,period_start,period_end,status,created_at,updated_at
		FROM tabarru_pools WHERE id=$1`
	err := p.db.QueryRowContext(ctx, q, id).Scan(
		&pool.ID, &pool.PoolName, &pool.PoolType, &pool.TotalContributions, &pool.TotalClaims,
		&pool.CurrentBalance, &pool.InvestmentBalance, &pool.TotalParticipants,
		&pool.TotalTabarru, &pool.TotalWakalaFee, &pool.InvestmentReturn,
		&pool.IsShariahCompliant, &pool.PeriodStart, &pool.PeriodEnd, &pool.Status,
		&pool.CreatedAt, &pool.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &pool, nil
}

func (p *PostgreSQL) ListPools(ctx context.Context, status string) ([]models.TabarruPool, error) {
	query := `SELECT id,pool_name,pool_type,total_contributions,total_claims,current_balance,
		investment_balance,total_participants,total_tabarru,total_wakala_fee,investment_return,
		is_shariah_compliant,period_start,period_end,status,created_at,updated_at
		FROM tabarru_pools`
	args := []interface{}{}
	pos := 1
	if status != "" {
		query += fmt.Sprintf(" WHERE status=$%d", pos)
		args = append(args, status)
	}
	query += " ORDER BY created_at DESC"
	rows, err := p.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	return scanPools(rows)
}

// --- Claim CRUD ---
func (p *PostgreSQL) CreateClaim(ctx context.Context, claim *models.Claim) error {
	claim.ID = uuid.New().String()
	claim.ClaimNumber = "CLM-" + time.Now().Format("20060102") + "-" + uuid.New().String()[:6]
	claim.CreatedAt = time.Now()
	claim.UpdatedAt = time.Now()
	claim.Status = "filed"
	query := `INSERT INTO claims (id,claim_number,participant_id,product_id,pool_id,claim_type,
		claim_amount,deductible,paid_amount,rejection_reason,status,filed_at,claim_documents)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`
	_, err := p.db.ExecContext(ctx, query, claim.ID, claim.ClaimNumber, claim.ParticipantID,
		claim.ProductID, claim.PoolID, claim.ClaimType, claim.ClaimAmount,
		claim.Deductible, claim.PaidAmount, claim.RejectionReason, claim.Status,
		claim.FiledAt, claim.ClaimDocuments)
	return err
}

func (p *PostgreSQL) UpdateClaimStatus(ctx context.Context, claimID, status string, paidAmount float64) error {
	_, err := p.db.ExecContext(ctx,
		`UPDATE claims SET status=$1, paid_amount=$2, updated_at=NOW(),
		 approved_at=CASE WHEN $1='approved' OR $1='paid' THEN NOW() ELSE approved_at END,
		 paid_at=CASE WHEN $1='paid' THEN NOW() ELSE paid_at END
		 WHERE id=$3`, status, paidAmount, claimID)
	return err
}

func (p *PostgreSQL) GetClaim(ctx context.Context, id string) (*models.Claim, error) {
	var c models.Claim
	q := `SELECT id,claim_number,participant_id,product_id,pool_id,claim_type,claim_amount,
		deductible,paid_amount,rejection_reason,status,filed_at,approved_at,paid_at,
		reviewed_by,claim_documents,created_at,updated_at
		FROM claims WHERE id=$1`
	err := p.db.QueryRowContext(ctx, q, id).Scan(
		&c.ID, &c.ClaimNumber, &c.ParticipantID, &c.ProductID, &c.PoolID,
		&c.ClaimType, &c.ClaimAmount, &c.Deductible, &c.PaidAmount, &c.RejectionReason,
		&c.Status, &c.FiledAt, &c.ApprovedAt, &c.PaidAt, &c.ReviewedBy,
		&c.ClaimDocuments, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (p *PostgreSQL) GetClaimsByParticipant(ctx context.Context, participantID string, status string, limit int) ([]models.Claim, error) {
	query := `SELECT id,claim_number,participant_id,product_id,pool_id,claim_type,claim_amount,
		deductible,paid_amount,rejection_reason,status,filed_at,approved_at,paid_at,
		reviewed_by,claim_documents,created_at,updated_at
		FROM claims WHERE participant_id=$1`
	args := []interface{}{participantID}
	pos := 2
	if status != "" {
		query += fmt.Sprintf(" AND status=$%d", pos)
		args = append(args, status)
		pos++
	}
	query += " ORDER BY filed_at DESC"
	if limit > 0 {
		query += fmt.Sprintf(" LIMIT $%d", pos)
		args = append(args, limit)
	}
	rows, err := p.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	return scanClaims(rows)
}

// --- Surplus Distribution ---
func (p *PostgreSQL) CreateSurplusDistribution(ctx context.Context, sd *models.SurplusDistribution) error {
	sd.ID = uuid.New().String()
	sd.CreatedAt = time.Now()
	query := `INSERT INTO surplus_distributions (id,period,pool_id,total_surplus,participant_share,
		operator_share,distribution_ratio,participant_count,avg_participant_share,status,notes)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`
	_, err := p.db.ExecContext(ctx, query, sd.ID, sd.Period, sd.PoolID, sd.TotalSurplus,
		sd.ParticipantShare, sd.OperatorShare, sd.DistributionRatio, sd.ParticipantCount,
		sd.AvgParticipantShare, sd.Status, sd.Notes)
	return err
}

func (p *PostgreSQL) GetSurplusDistribution(ctx context.Context, period, poolID string) (*models.SurplusDistribution, error) {
	var sd models.SurplusDistribution
	q := `SELECT id,period,pool_id,total_surplus,participant_share,operator_share,
		distribution_ratio,participant_count,avg_participant_share,status,approved_by,
		approved_at,distributed_at,notes,created_at
		FROM surplus_distributions WHERE period=$1 AND pool_id=$2`
	err := p.db.QueryRowContext(ctx, q, period, poolID).Scan(
		&sd.ID, &sd.Period, &sd.PoolID, &sd.TotalSurplus, &sd.ParticipantShare,
		&sd.OperatorShare, &sd.DistributionRatio, &sd.ParticipantCount,
		&sd.AvgParticipantShare, &sd.Status, &sd.ApprovedBy, &sd.ApprovedAt,
		&sd.DistributedAt, &sd.Notes, &sd.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &sd, nil
}

// --- Zakat ---
func (p *PostgreSQL) CreateZakatRecord(ctx context.Context, z *models.ZakatRecord) error {
	z.ID = uuid.New().String()
	if z.CalculatedAt.IsZero() {
		z.CalculatedAt = time.Now()
	}
	query := `INSERT INTO zakat_records (id,participant_id,year,net_wealth,nisab_threshold,
		is_zakat_obliged,zakat_rate,zakat_amount,paid,paid_at,recipients,status,calculated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`
	_, err := p.db.ExecContext(ctx, query, z.ID, z.ParticipantID, z.Year, z.NetWealth,
		z.NisabThreshold, z.IsZakatObliged, z.ZakatRate, z.ZakatAmount, z.Paid,
		z.PaidAt, z.Recipients, z.Status, z.CalculatedAt)
	return err
}

func (p *PostgreSQL) GetZakatRecords(ctx context.Context, participantID string, year int) ([]models.ZakatRecord, error) {
	query := `SELECT id,participant_id,year,net_wealth,nisab_threshold,is_zakat_obliged,
		zakat_rate,zakat_amount,paid,paid_at,recipients,status,calculated_at
		FROM zakat_records WHERE participant_id=$1`
	args := []interface{}{participantID}
	pos := 2
	if year > 0 {
		query += fmt.Sprintf(" AND year=$%d", pos)
		args = append(args, year)
	}
	query += " ORDER BY year DESC"
	rows, err := p.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	return scanZakatRecords(rows)
}

// --- Retakaful ---
func (p *PostgreSQL) CreateRetakafulEntry(ctx context.Context, r *models.RetakafulEntry) error {
	r.ID = uuid.New().String()
	r.CreatedAt = time.Now()
	query := `INSERT INTO retakaful_entries (id,cession_number,participant_id,product_id,
		retakaful_operator,ceded_amount,ceded_percentage,treaty_type,is_active,
		effective_date,expiry_date)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`
	_, err := p.db.ExecContext(ctx, query, r.ID, r.CessionNumber, r.ParticipantID, r.ProductID,
		r.RetakafulOperator, r.CededAmount, r.CededPercentage, r.TreatyType,
		r.IsActive, r.EffectiveDate, r.ExpiryDate)
	return err
}

// --- Pool Snapshot ---
func (p *PostgreSQL) CreatePoolSnapshot(ctx context.Context, s *models.PoolSnapshot) error {
	s.ID = uuid.New().String()
	s.CreatedAt = time.Now()
	query := `INSERT INTO pool_snapshots (id,pool_id,snapshot_date,total_balance,total_claims,
		total_participants,investment_return)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`
	_, err := p.db.ExecContext(ctx, query, s.ID, s.PoolID, s.SnapshotDate,
		s.TotalBalance, s.TotalClaims, s.TotalParticipants, s.InvestmentReturn)
	return err
}

// --- Helpers ---
func scanProducts(rows *sql.Rows) ([]models.TakafulProduct, error) {
	var products []models.TakafulProduct
	for rows.Next() {
		var p models.TakafulProduct
		err := rows.Scan(&p.ID, &p.ProductCode, &p.Name, &p.Description, &p.Category,
			&p.RiskType, &p.MinContribution, &p.MaxContribution, &p.MaxSumAssured,
			&p.WakalaFeePercent, &p.ParticipantShare, &p.TabarruPercent, &p.IsShariahCertified,
			&p.ShariahBoardID, &p.ShariahCertDate, &p.ShariahExpiryDate, &p.IsActive,
			&p.MaxCoverageAmount, &p.WaitingPeriodDays, &p.CoInsurancePct, &p.CreatedAt, &p.UpdatedAt)
		if err != nil {
			return nil, err
		}
		products = append(products, p)
	}
	return products, nil
}

func scanParticipants(rows *sql.Rows) ([]models.Participant, error) {
	var participants []models.Participant
	for rows.Next() {
		var p models.Participant
		err := rows.Scan(&p.ID, &p.ParticipantCode, &p.FirstName, &p.LastName, &p.MiddleName,
			&p.NIN, &p.Phone, &p.Email, &p.DOB, &p.Gender, &p.Address, &p.City, &p.State,
			&p.KYCStatus, &p.KYCVerifiedAt, &p.IsParticipant, &p.EnrollmentDate,
			&p.LastContribution, &p.TotalContributions, &p.CurrentShare, &p.SurplusBalance,
			&p.Status, &p.CreatedAt, &p.UpdatedAt)
		if err != nil {
			return nil, err
		}
		participants = append(participants, p)
	}
	return participants, nil
}

func scanContributions(rows *sql.Rows) ([]models.Contribution, error) {
	var c []models.Contribution
	for rows.Next() {
		var item models.Contribution
		err := rows.Scan(&item.ID, &item.ParticipantID, &item.ProductID, &item.TransactionID,
			&item.Amount, &item.TabarruPortion, &item.WakalaFee, &item.InvestmentPortion,
			&item.PaymentMethod, &item.Status, &item.ProcessedAt, &item.ReferenceNo,
			&item.Notes, &item.CreatedAt)
		if err != nil {
			return nil, err
		}
		c = append(c, item)
	}
	return c, nil
}

func scanPools(rows *sql.Rows) ([]models.TabarruPool, error) {
	var pools []models.TabarruPool
	for rows.Next() {
		var p models.TabarruPool
		err := rows.Scan(&p.ID, &p.PoolName, &p.PoolType, &p.TotalContributions, &p.TotalClaims,
			&p.CurrentBalance, &p.InvestmentBalance, &p.TotalParticipants, &p.TotalTabarru,
			&p.TotalWakalaFee, &p.InvestmentReturn, &p.IsShariahCompliant, &p.PeriodStart,
			&p.PeriodEnd, &p.Status, &p.CreatedAt, &p.UpdatedAt)
		if err != nil {
			return nil, err
		}
		pools = append(pools, p)
	}
	return pools, nil
}

func scanClaims(rows *sql.Rows) ([]models.Claim, error) {
	var claims []models.Claim
	for rows.Next() {
		var c models.Claim
		err := rows.Scan(&c.ID, &c.ClaimNumber, &c.ParticipantID, &c.ProductID, &c.PoolID,
			&c.ClaimType, &c.ClaimAmount, &c.Deductible, &c.PaidAmount, &c.RejectionReason,
			&c.Status, &c.FiledAt, &c.ApprovedAt, &c.PaidAt, &c.ReviewedBy,
			&c.ClaimDocuments, &c.CreatedAt, &c.UpdatedAt)
		if err != nil {
			return nil, err
		}
		claims = append(claims, c)
	}
	return claims, nil
}

func scanZakatRecords(rows *sql.Rows) ([]models.ZakatRecord, error) {
	var records []models.ZakatRecord
	for rows.Next() {
		var z models.ZakatRecord
		err := rows.Scan(&z.ID, &z.ParticipantID, &z.Year, &z.NetWealth, &z.NisabThreshold,
			&z.IsZakatObliged, &z.ZakatRate, &z.ZakatAmount, &z.Paid, &z.PaidAt,
			&z.Recipients, &z.Status, &z.CalculatedAt)
		if err != nil {
			return nil, err
		}
		records = append(records, z)
	}
	return records, nil
}
