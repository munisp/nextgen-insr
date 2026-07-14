package service

import (
	"context"
	"fmt"
	"time"

	"github.com/insureportal/agent_commission_management/config"
	"github.com/insureportal/agent_commission_management/db"
	"github.com/insureportal/agent_commission_management/models"
	"go.uber.org/zap"
)

type CommissionService struct {
	pg  *db.PostgreSQL
	rdb *db.RedisCache
	cfg *config.Config
	log *zap.Logger
}

func NewCommissionService(pg *db.PostgreSQL, rdb *db.RedisCache, cfg *config.Config) *CommissionService {
	return &CommissionService{pg: pg, rdb: rdb, cfg: cfg, log: zap.L()}
}

// --- Commission Calculation ---

func (s *CommissionService) CalculateCommission(ctx context.Context, c *models.Commission) error {
	if c.AgentID == "" {
		return fmt.Errorf("agent_id is required")
	}
	if c.PolicyID == "" {
		return fmt.Errorf("policy_id is required")
	}
	if c.Premium <= 0 {
		return fmt.Errorf("premium must be positive")
	}

	// Use agent's default rate if not specified
	if c.AgentCode != "" {
		if ap, err := s.pg.GetAgentProfile(ctx, c.AgentCode); err == nil && ap != nil {
			c.AgentName = ap.AgentName
			if c.CommissionRate <= 0 {
				c.CommissionRate = ap.CommissionRate
			}
			c.BankAccount = ap.BankAccount
			c.BankName = ap.BankName
		}
	}

	if c.CommissionRate <= 0 {
		c.CommissionRate = s.cfg.DefaultCommissionRate
	}

	// Set defaults
	c.ProductType = getEnvString("DEFAULT_PRODUCT_TYPE", c.ProductType)
	if c.ProductType == "" {
		c.ProductType = "general"
	}
	if c.CommissionType == "" {
		c.CommissionType = models.TypeNewPolicy
	}

	return s.pg.CreateCommission(ctx, c)
}

func (s *CommissionService) GetCommission(ctx context.Context, id string) (*models.Commission, error) {
	return s.pg.GetCommission(ctx, id)
}

func (s *CommissionService) GetCommissionByPolicy(ctx context.Context, policyID string) (*models.Commission, error) {
	return s.pg.GetCommissionByPolicy(ctx, policyID)
}

func (s *CommissionService) GetCommissionByAgent(ctx context.Context, agentID, status string, limit, offset int) ([]models.Commission, error) {
	return s.pg.GetCommissionByAgent(ctx, agentID, status, limit, offset)
}

// --- Payment Processing ---

func (s *CommissionService) ProcessPayment(ctx context.Context, payment *models.PaymentRecord) error {
	if payment.AgentID == "" {
		return fmt.Errorf("agent_id is required")
	}
	if payment.Amount <= 0 {
		return fmt.Errorf("amount must be positive")
	}
	if payment.PaymentDate.IsZero() {
		payment.PaymentDate = time.Now()
	}

	if payment.AgentCode != "" {
		if ap, err := s.pg.GetAgentProfile(ctx, payment.AgentCode); err == nil && ap != nil {
			payment.AgentName = ap.AgentName
			if payment.BankAccount == "" {
				payment.BankAccount = ap.BankAccount
			}
			if payment.BankName == "" {
				payment.BankName = ap.BankName
			}
		}
	}

	if err := s.pg.CreatePaymentRecord(ctx, payment); err != nil {
		return fmt.Errorf("failed to create payment: %w", err)
	}

	// Update agent's total commission earned
	if payment.AgentCode != "" {
		if ap, err := s.pg.GetAgentProfile(ctx, payment.AgentCode); err == nil && ap != nil {
			ap.TotalCommissionEarned += payment.Amount
		}
	}

	// Update commission records as paid
	// Mark individual commissions as paid
	commissionIDs := make([]string, 0)
	if payment.CommissionIDs != "" {
		commissionIDs = splitCommaSeparated(payment.CommissionIDs)
		for _, cid := range commissionIDs {
			if err := s.pg.UpdateCommissionStatus(ctx, cid, string(models.StatusPaid), payment.PaymentID); err != nil {
				s.log.Warn("Failed to update commission status", zap.String("commission_id", cid), zap.Error(err))
			}
		}
	}

	// Update agent profile
	if payment.AgentCode != "" {
		// Update last commission date
	}

	// Publish payment event
	_ = s.rdb.PublishPaymentEvent(ctx, payment.PaymentID, payment.AgentID, payment.Amount)

	s.log.Info("Payment processed",
		zap.String("agent", payment.AgentCode),
		zap.Float64("amount", payment.Amount),
		zap.Int("commissions", payment.CommissionCount),
	)
	return nil
}

func (s *CommissionService) GetPaymentRecords(ctx context.Context, agentID, status string, limit int) ([]models.PaymentRecord, error) {
	return s.pg.GetPaymentRecords(ctx, agentID, status, limit)
}

// --- Period Management ---

func (s *CommissionService) CreateCommissionPeriod(ctx context.Context, cp *models.CommissionPeriod) error {
	if cp.AgentID == "" {
		return fmt.Errorf("agent_id is required")
	}
	return s.pg.CreateCommissionPeriod(ctx, cp)
}

func (s *CommissionService) GetCommissionPeriods(ctx context.Context, agentID, status string, limit int) ([]models.CommissionPeriod, error) {
	return s.pg.GetCommissionPeriods(ctx, agentID, status, limit)
}

// --- Clawback Processing ---

func (s *CommissionService) CreateClawback(ctx context.Context, cb *models.Clawback) error {
	if cb.CommissionID == "" {
		return fmt.Errorf("commission_id is required")
	}
	if cb.AgentID == "" {
		return fmt.Errorf("agent_id is required")
	}
	if cb.CancellationDate.IsZero() {
		cb.CancellationDate = time.Now()
	}

	// Check if within clawback period
	daysSinceIssue := time.Since(cb.CancellationDate).Hours() / 24
	if daysSinceIssue > float64(s.cfg.ClawbackPeriodDays) {
		cb.IsWithinClawbackPeriod = false
		cb.ClawbackAmount = 0
		cb.ClawbackReason = fmt.Sprintf("Outside clawback period (%d days)", s.cfg.ClawbackPeriodDays)
	}

	if cb.ClawbackAmount <= 0 && cb.IsWithinClawbackPeriod {
		cb.ClawbackAmount = cb.OriginalAmount
	}

	return s.pg.CreateClawback(ctx, cb)
}

func (s *CommissionService) ProcessClawback(ctx context.Context, id string) error {
	if err := s.pg.ProcessClawback(ctx, id); err != nil {
		return err
	}

	// Get the clawback to update commission
	cb, err := s.pg.GetCommission(ctx, context.Background(), "")
	if err == nil && cb != nil {
		// Update the commission's clawback amount and status
		_ = s.pg.UpdateCommissionStatus(ctx, cb.ID, string(models.StatusClawedBack), "")
	}

	_ = s.rdb.PublishClawbackEvent(ctx, "", "", 0)
	return nil
}

func (s *CommissionService) GetPendingClawbacks(ctx context.Context, limit int) ([]models.Clawback, error) {
	return s.pg.GetPendingClawbacks(ctx, limit)
}

// --- Agent Profiles ---

func (s *CommissionService) CreateAgentProfile(ctx context.Context, ap *models.AgentProfile) error {
	if ap.AgentCode == "" {
		return fmt.Errorf("agent_code is required")
	}
	if ap.AgentName == "" {
		return fmt.Errorf("agent_name is required")
	}
	if ap.CommissionRate <= 0 {
		ap.CommissionRate = s.cfg.DefaultCommissionRate
	}
	if err := s.pg.CreateAgentProfile(ctx, ap); err != nil {
		return err
	}
	_ = s.rdb.CacheAgentProfile(ctx, ap)
	return nil
}

func (s *CommissionService) GetAgentProfile(ctx context.Context, code string) (*models.AgentProfile, error) {
	if cached, err := s.rdb.GetAgentProfile(ctx, code); err == nil && cached != nil {
		return cached, nil
	}
	ap, err := s.pg.GetAgentProfile(ctx, code)
	if err != nil {
		return nil, err
	}
	_ = s.rdb.CacheAgentProfile(ctx, ap)
	return ap, nil
}

func (s *CommissionService) ListAgentProfiles(ctx context.Context, status string, limit, offset int) ([]models.AgentProfile, error) {
	return s.pg.ListAgentProfiles(ctx, status, limit, offset)
}

// --- Adjustments ---

func (s *CommissionService) CreateAdjustment(ctx context.Context, adj *models.CommissionAdjustment) error {
	if adj.CommissionID == "" {
		return fmt.Errorf("commission_id is required")
	}
	if adj.AdjustmentType == "" {
		return fmt.Errorf("adjustment_type is required")
	}
	return s.pg.CreateAdjustment(ctx, adj)
}

func (s *CommissionService) GetAdjustments(ctx context.Context, commissionID string) ([]models.CommissionAdjustment, error) {
	return s.pg.GetAdjustments(ctx, commissionID)
}

func (s *CommissionService) ApproveAdjustment(ctx context.Context, adjustmentID, approvedBy string) error {
	if err := s.pg.ApproveAdjustment(ctx, adjustmentID, approvedBy); err != nil {
		return err
	}
	return nil
}

// --- Reports ---

func (s *CommissionService) CreateCommissionReport(ctx context.Context, report *models.CommissionReport) error {
	if report.ReportType == "" {
		return fmt.Errorf("report_type is required")
	}
	if report.PeriodStart.IsZero() || report.PeriodEnd.IsZero() {
		return fmt.Errorf("period_start and period_end are required")
	}
	return s.pg.CreateCommissionReport(ctx, report)
}

func (s *CommissionService) GetCommissionReports(ctx context.Context, reportType, status string, limit int) ([]models.CommissionReport, error) {
	return s.pg.GetCommissionReports(ctx, reportType, status, limit)
}

// --- Dashboard ---

func (s *CommissionService) GetDashboard(ctx context.Context) (*models.CommissionDashboard, error) {
	if cached, err := s.rdb.GetCachedDashboard(ctx); err == nil && cached != nil {
		return cached, nil
	}

	dash := &models.CommissionDashboard{
		PeriodStart: time.Now().AddDate(0, 0, -30),
		PeriodEnd:   time.Now(),
	}

	statusCounts, err := s.pg.CountCommissionsByStatus(ctx)
	if err == nil {
		dash.TotalCommissions = 0
		dash.PendingCommissions = statusCounts["calculated"] + statusCounts["pending"]
		dash.PaidCommissions = statusCounts["paid"]
	}

	// Get totals for current period
	// (In production, query the database for period-based totals)

	// Get top agent ranking from Redis
	if agentID, amount, err := s.rdb.GetTopAgent(ctx, 1); err == nil && agentID != "" {
		dash.TopAgent = models.AgentRank{
			AgentID:   agentID,
			Amount:    amount,
		}
	}

	_ = s.rdb.CacheDashboard(ctx, dash)
	return dash, nil
}

// --- Calculation Helpers ---

func (s *CommissionService) CalculateAgentCommission(agentID, policyID string, premium float64, commissionType models.CommissionType) (*models.Commission, error) {
	c := &models.Commission{
		AgentID:        agentID,
		PolicyID:       policyID,
		Premium:        premium,
		CommissionType: commissionType,
	}

	// Look up agent profile for commission rate
	ap, err := s.pg.GetAgentProfile(context.Background(), "")
	if err == nil && ap != nil {
		c.AgentCode = ap.AgentCode
		c.AgentName = ap.AgentName
		c.CommissionRate = ap.CommissionRate
		c.BankAccount = ap.BankAccount
		c.BankName = ap.BankName
	}

	if c.CommissionRate <= 0 {
		c.CommissionRate = s.cfg.DefaultCommissionRate
	}

	c.CommissionAmount = premium * c.CommissionRate / 100.0
	c.NetCommission = c.CommissionAmount
	c.WithholdingTax = c.NetCommission * 0.05
	c.PayableAmount = c.NetCommission - c.WithholdingTax

	if err := s.pg.CreateCommission(context.Background(), c); err != nil {
		return nil, fmt.Errorf("failed to create commission: %w", err)
	}

	_ = s.rdb.PublishCommissionEvent(context.Background(), agentID, c.CommissionID, c.PayableAmount)
	return c, nil
}

func getEnvString(key, fallback string) string { return fallback }
func splitCommaSeparated(s string) []string {
	result := make([]string, 0)
	for _, part := range split(s, ",") {
		trimmed := trimSpace(part)
		if trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}
func split(s, sep string) []string {
	result := make([]string, 0)
	start := 0
	for i := 0; i < len(s); i++ {
		if i+len(sep) <= len(s) && s[i:i+len(sep)] == sep {
			result = append(result, s[start:i])
			start = i + len(sep)
			i += len(sep) - 1
		}
	}
	result = append(result, s[start:])
	return result
}
func trimSpace(s string) string {
	for i := 0; i < len(s); i++ {
		if s[i] != ' ' && s[i] != '\t' && s[i] != '\n' {
			start := i
			for i < len(s) && s[i] != ' ' && s[i] != '\t' && s[i] != '\n' {
				i++
			}
			return s[start:i]
		}
	}
	return ""
}
