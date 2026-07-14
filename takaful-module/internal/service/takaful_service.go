package service

import (
	"context"
	"fmt"
	"time"

	"github.com/insureportal/takaful_module/config"
	"github.com/insureportal/takaful_module/db"
	"github.com/insureportal/takaful_module/models"
	"go.uber.org/zap"
)

type TakafulService struct {
	pg   *db.PostgreSQL
	rdb  *db.RedisCache
	cfg  *config.Config
	log  *zap.Logger
}

func NewTakafulService(pg *db.PostgreSQL, rdb *db.RedisCache, cfg *config.Config) *TakafulService {
	return &TakafulService{pg: pg, rdb: rdb, cfg: cfg, log: zap.L()}
}

// --- Product Operations ---

func (s *TakafulService) CreateProduct(ctx context.Context, prod *models.TakafulProduct) error {
	if prod.ProductCode == "" {
		return fmt.Errorf("product_code is required")
	}
	if prod.Name == "" {
		return fmt.Errorf("product name is required")
	}
	if prod.Category == "" {
		return fmt.Errorf("product category is required")
	}
	if prod.WakalaFeePercent == 0 {
		prod.WakalaFeePercent = s.cfg.WakalaFeePercent
	}
	if prod.ParticipantShare == 0 {
		prod.ParticipantShare = s.cfg.ParticipantShare
	}
	if prod.TabarruPercent == 0 {
		prod.TabarruPercent = prod.ParticipantShare
	}
	prod.IsShariahCertified = s.cfg.ShariahBoardApproval
	return s.pg.CreateProduct(ctx, prod)
}

func (s *TakafulService) GetProduct(ctx context.Context, id string) (*models.TakafulProduct, error) {
	if cached, err := s.rdb.GetProduct(ctx, id); err == nil && cached != nil {
		return cached, nil
	}
	prod, err := s.pg.GetProduct(ctx, id)
	if err != nil {
		return nil, err
	}
	_ = s.rdb.CacheProduct(ctx, prod)
	return prod, nil
}

func (s *TakafulService) ListProducts(ctx context.Context, category string) ([]models.TakafulProduct, error) {
	return s.pg.ListProducts(ctx, category, true)
}

// --- Participant Operations ---

func (s *TakafulService) RegisterParticipant(ctx context.Context, ptc *models.Participant) error {
	if ptc.FirstName == "" || ptc.LastName == "" {
		return fmt.Errorf("first_name and last_name are required")
	}
	if ptc.Email != "" {
		if !isValidEmail(ptc.Email) {
			return fmt.Errorf("invalid email address")
		}
	}
	if ptc.Phone != "" {
		if !isValidPhone(ptc.Phone) {
			return fmt.Errorf("invalid phone number")
		}
	}
	return s.pg.CreateParticipant(ctx, ptc)
}

func (s *TakafulService) GetParticipant(ctx context.Context, id string) (*models.Participant, error) {
	if cached, err := s.rdb.GetParticipant(ctx, id); err == nil && cached != nil {
		return cached, nil
	}
	ptc, err := s.pg.GetParticipant(ctx, id)
	if err != nil {
		return nil, err
	}
	_ = s.rdb.CacheParticipant(ctx, ptc)
	return ptc, nil
}

func (s *TakafulService) ListParticipants(ctx context.Context, status, kycStatus string, limit, offset int) ([]models.Participant, error) {
	return s.pg.ListParticipants(ctx, status, kycStatus, limit, offset)
}

func (s *TakafulService) VerifyKYC(ctx context.Context, participantID string, status string) error {
	if status != "verified" && status != "rejected" {
		return fmt.Errorf("KYC status must be 'verified' or 'rejected'")
	}
	verifiedAt := time.Now()
	return s.pg.UpdateParticipantKYC(ctx, participantID, status, verifiedAt)
}

// --- Contribution Operations ---

func (s *TakafulService) MakeContribution(ctx context.Context, contrib *models.Contribution, participant *models.Participant, product *models.TakafulProduct) error {
	if contrib.Amount <= 0 {
		return fmt.Errorf("contribution amount must be positive")
	}
	if contrib.Amount < product.MinContribution {
		return fmt.Errorf("contribution amount %.2f is below minimum %.2f", contrib.Amount, product.MinContribution)
	}
	if contrib.TransactionID == "" {
		return fmt.Errorf("transaction_id is required")
	}

	// Calculate tabarru (donation) and wakala (fee) portions
	tabarruPct := product.TabarruPercent / 100.0
	wakalaPct := product.WakalaFeePercent / 100.0

	contrib.TabarruPortion = contrib.Amount * tabarruPct
	contrib.WakalaFee = contrib.Amount * wakalaPct
	contrib.InvestmentPortion = contrib.Amount - contrib.TabarruPortion - contrib.WakalaFee

	if contrib.InvestmentPortion < 0 {
		contrib.InvestmentPortion = 0
		contrib.TabarruPortion = contrib.Amount - contrib.WakalaFee
	}

	contrib.Status = "completed"
	processedAt := time.Now()
	contrib.ProcessedAt = &processedAt
	contrib.PaymentMethod = getEnvString("PAYMENT_METHOD", contrib.PaymentMethod)
	if contrib.PaymentMethod == "" {
		contrib.PaymentMethod = "bank_transfer"
	}

	if err := s.pg.CreateContribution(ctx, contrib); err != nil {
		return fmt.Errorf("failed to create contribution: %w", err)
	}

	// Update participant totals
	participant.TotalContributions += contrib.Amount
	participant.LastContribution = processedAt
	participant.IsParticipant = true
	_ = s.rdb.CacheParticipant(ctx, participant)

	// Update pool balance
	pool, err := s.pg.GetPool(ctx, contrib.ProductID)
	if err != nil {
		s.log.Warn("Pool not found, creating default pool", zap.String("product_id", contrib.ProductID))
		pool = &models.TabarruPool{
			ID:        contrib.ProductID,
			PoolName:  fmt.Sprintf("%s Pool", product.Name),
			PoolType:  product.Category,
			Status:    "active",
			PeriodStart: time.Date(time.Now().Year(), 1, 1, 0, 0, 0, 0, time.UTC),
			PeriodEnd:   time.Date(time.Now().Year(), 12, 31, 23, 59, 59, 0, time.UTC),
		}
	}

	pool.TotalContributions += contrib.Amount
	pool.TotalTabarru += contrib.TabarruPortion
	pool.TotalWakalaFee += contrib.WakalaFee
	pool.InvestmentBalance += contrib.InvestmentPortion
	pool.CurrentBalance = pool.TotalContributions - pool.TotalClaims
	pool.TotalParticipants++
	pool.UpdatedAt = time.Now()
	if err := s.pg.UpsertPool(ctx, pool); err != nil {
		return fmt.Errorf("failed to update pool: %w", err)
	}

	// Cache updated pool
	_ = s.rdb.CachePool(ctx, pool)

	// Publish event
	_ = s.rdb.PublishContributionEvent(ctx, *contrib)
	_ = s.rdb.IncrementContributionCount(ctx)

	s.log.Info("Contribution processed",
		zap.String("participant", contrib.ParticipantID),
		zap.Float64("amount", contrib.Amount),
		zap.Float64("tabarru", contrib.TabarruPortion),
		zap.Float64("wakala", contrib.WakalaFee),
	)
	return nil
}

// --- Pool Operations ---

func (s *TakafulService) GetPool(ctx context.Context, id string) (*models.TabarruPool, error) {
	if cached, err := s.rdb.GetPool(ctx, id); err == nil && cached != nil {
		return cached, nil
	}
	pool, err := s.pg.GetPool(ctx, id)
	if err != nil {
		return nil, err
	}
	_ = s.rdb.CachePool(ctx, pool)
	return pool, nil
}

func (s *TakafulService) ListPools(ctx context.Context, status string) ([]models.TabarruPool, error) {
	return s.pg.ListPools(ctx, status)
}

// --- Claim Operations ---

func (s *TakafulService) CreateClaim(ctx context.Context, claim *models.Claim) error {
	if claim.ParticipantID == "" {
		return fmt.Errorf("participant_id is required")
	}
	if claim.ProductID == "" {
		return fmt.Errorf("product_id is required")
	}
	if claim.ClaimAmount <= 0 {
		return fmt.Errorf("claim_amount must be positive")
	}
	if claim.ClaimType == "" {
		return fmt.Errorf("claim_type is required")
	}
	return s.pg.CreateClaim(ctx, claim)
}

func (s *TakafulService) UpdateClaimStatus(ctx context.Context, claimID, status string, paidAmount float64) error {
	if status == "paid" && paidAmount <= 0 {
		return fmt.Errorf("paid_amount must be positive for paid status")
	}
	if err := s.pg.UpdateClaimStatus(ctx, claimID, status, paidAmount); err != nil {
		return err
	}

	// Publish claim event
	claim, err := s.pg.GetClaim(ctx, claimID)
	if err == nil {
		_ = s.rdb.PublishClaimEvent(ctx, *claim)
	}
	return nil
}

func (s *TakafulService) GetClaim(ctx context.Context, id string) (*models.Claim, error) {
	return s.pg.GetClaim(ctx, id)
}

func (s *TakafulService) GetClaimsByParticipant(ctx context.Context, participantID, status string, limit int) ([]models.Claim, error) {
	return s.pg.GetClaimsByParticipant(ctx, participantID, status, limit)
}

// --- Surplus Distribution ---

func (s *TakafulService) CalculateSurplusDistribution(ctx context.Context, poolID, period string) (*models.SurplusDistribution, error) {
	pool, err := s.pg.GetPool(ctx, poolID)
	if err != nil {
		return nil, fmt.Errorf("pool not found: %w", err)
	}

	totalSurplus := pool.CurrentBalance
	if totalSurplus <= 0 {
		return nil, fmt.Errorf("no surplus to distribute (current_balance: %.2f)", pool.CurrentBalance)
	}

	participantShare := totalSurplus * (s.cfg.ParticipantShare / 100.0)
	operatorShare := totalSurplus * (s.cfg.WakalaFeePercent / 100.0)

	sd := &models.SurplusDistribution{
		Period:           period,
		PoolID:           poolID,
		TotalSurplus:     totalSurplus,
		ParticipantShare: participantShare,
		OperatorShare:    operatorShare,
		DistributionRatio: "70/30",
		ParticipantCount: pool.TotalParticipants,
		AvgParticipantShare: func() float64 {
			if pool.TotalParticipants > 0 {
				return participantShare / float64(pool.TotalParticipants)
			}
			return 0
		}(),
		Status: "calculated",
	}

	if err := s.pg.CreateSurplusDistribution(ctx, sd); err != nil {
		return nil, fmt.Errorf("failed to create surplus distribution: %w", err)
	}

	s.log.Info("Surplus calculated",
		zap.Float64("total_surplus", totalSurplus),
		zap.Float64("participant_share", participantShare),
		zap.Float64("operator_share", operatorShare),
	)
	return sd, nil
}

// --- Zakat Calculation ---

func (s *TakafulService) CalculateZakat(ctx context.Context, participantID string, year int) (*models.ZakatRecord, error) {
	ptc, err := s.pg.GetParticipant(ctx, participantID)
	if err != nil {
		return nil, fmt.Errorf("participant not found: %w", err)
	}

	netWealth := ptc.TotalContributions + ptc.SurplusBalance
	nisabThreshold := s.cfg.ZakatNisabThreshold * 31.0 // Nisab = ~85g gold / 31g per unit

	isObliged := netWealth >= nisabThreshold
	zakatAmount := 0.0
	if isObliged {
		zakatAmount = netWealth * s.cfg.ZakatRate
	}

	record := &models.ZakatRecord{
		ParticipantID:  participantID,
		Year:           year,
		NetWealth:      netWealth,
		NisabThreshold: nisabThreshold,
		IsZakatObliged: isObliged,
		ZakatRate:      s.cfg.ZakatRate,
		ZakatAmount:    zakatAmount,
		Status: func() string {
			if isObliged {
				return "calculated"
			}
			return "exempt"
		}(),
		CalculatedAt: time.Now(),
	}

	if err := s.pg.CreateZakatRecord(ctx, record); err != nil {
		return nil, fmt.Errorf("failed to create zakat record: %w", err)
	}

	return record, nil
}

// --- Retakaful ---

func (s *TakafulService) CreateRetakafulEntry(ctx context.Context, entry *models.RetakafulEntry) error {
	if entry.RetakafulOperator == "" {
		return fmt.Errorf("retakaful_operator is required")
	}
	if entry.TreatyType == "" {
		return fmt.Errorf("treaty_type is required")
	}
	return s.pg.CreateRetakafulEntry(ctx, entry)
}

// --- Pool Snapshot ---

func (s *TakafulService) CreatePoolSnapshot(ctx context.Context, poolID string) error {
	pool, err := s.pg.GetPool(ctx, poolID)
	if err != nil {
		return err
	}
	snapshot := &models.PoolSnapshot{
		PoolID:          poolID,
		SnapshotDate:    time.Now(),
		TotalBalance:    pool.CurrentBalance,
		TotalClaims:     pool.TotalClaims,
		TotalParticipants: pool.TotalParticipants,
		InvestmentReturn: pool.InvestmentReturn,
	}
	return s.pg.CreatePoolSnapshot(ctx, snapshot)
}

// --- Pool Stats ---

type PoolStats struct {
	TotalPools          int       `json:"total_pools"`
	TotalContributions  float64   `json:"total_contributions"`
	TotalClaims         float64   `json:"total_claims"`
	TotalParticipants   int       `json:"total_participants"`
	TotalTabarru        float64   `json:"total_tabarru"`
	TotalWakalaFee      float64   `json:"total_wakala_fee"`
	InvestmentBalance   float64   `json:"investment_balance"`
	InvestmentReturn    float64   `json:"investment_return"`
	ActiveProducts      int       `json:"active_products"`
	ActiveParticipants  int       `json:"active_participants"`
	ContributionCount   int64     `json:"contribution_count"`
	ShariahCompliant    bool      `json:"shariah_compliant"`
}

func (s *TakafulService) GetPoolStats(ctx context.Context) (*PoolStats, error) {
	stats := &PoolStats{ShariahCompliant: true}

	pools, err := s.pg.ListPools(ctx, "active")
	if err == nil {
		stats.TotalPools = len(pools)
		for _, pool := range pools {
			stats.TotalContributions += pool.TotalContributions
			stats.TotalClaims += pool.TotalClaims
			stats.TotalParticipants += pool.TotalParticipants
			stats.TotalTabarru += pool.TotalTabarru
			stats.TotalWakalaFee += pool.TotalWakalaFee
			stats.InvestmentBalance += pool.InvestmentBalance
			stats.InvestmentReturn = pool.InvestmentReturn
			if !pool.IsShariahCompliant {
				stats.ShariahCompliant = false
			}
		}
	}

	products, err := s.pg.ListProducts(ctx, "", true)
	if err == nil {
		stats.ActiveProducts = len(products)
	}

	participants, err := s.pg.ListParticipants(ctx, "active", "", 1, 0)
	if err == nil && len(participants) > 0 {
		stats.ActiveParticipants = 1
	}

	count, err := s.rdb.GetContributionCount(ctx)
	if err == nil {
		stats.ContributionCount = count
	}

	return stats, nil
}

// --- Validation helpers ---

func isValidEmail(email string) bool {
	for _, c := range email {
		if c == '@' {
			return true
		}
	}
	return false
}

func isValidPhone(phone string) bool {
	for _, c := range phone {
		if c >= '0' && c <= '9' {
			return true
		}
	}
	return false
}

func getEnvString(key, fallback string) string {
	if val := getEnv(key); val != "" {
		return val
	}
	return fallback
}

func getEnv(key string) string {
	return "" // Simplified - use os.LookupEnv in production
}
