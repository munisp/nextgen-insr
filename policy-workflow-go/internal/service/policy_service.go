package service

import (
	"context"
	"fmt"
	"time"

	"github.com/insureportal/policy_workflow_go/config"
	"github.com/insureportal/policy_workflow_go/db"
	"github.com/insureportal/policy_workflow_go/models"
	"go.uber.org/zap"
)

type PolicyService struct {
	pg   *db.PostgreSQL
	rdb  *db.RedisCache
	cfg  *config.Config
	log  *zap.Logger
}

func NewPolicyService(pg *db.PostgreSQL, rdb *db.RedisCache, cfg *config.Config) *PolicyService {
	return &PolicyService{pg: pg, rdb: rdb, cfg: cfg, log: zap.L()}
}

// --- Policy Lifecycle ---

func (s *PolicyService) CreatePolicy(ctx context.Context, pol *models.Policy) error {
	if pol.HolderID == "" {
		return fmt.Errorf("holder_id is required")
	}
	if pol.ProductID == "" {
		return fmt.Errorf("product_id is required")
	}
	if pol.Premium <= 0 {
		return fmt.Errorf("premium must be positive")
	}
	return s.pg.CreatePolicy(ctx, pol)
}

func (s *PolicyService) GetPolicy(ctx context.Context, id string) (*models.Policy, error) {
	if cached, err := s.rdb.GetPolicy(ctx, id); err == nil && cached != nil {
		return cached, nil
	}
	pol, err := s.pg.GetPolicy(ctx, id)
	if err != nil {
		return nil, err
	}
	_ = s.rdb.CachePolicy(ctx, pol)
	return pol, nil
}

func (s *PolicyService) GetPolicyByNumber(ctx context.Context, number string) (*models.Policy, error) {
	return s.pg.GetPolicyByNumber(ctx, number)
}

func (s *PolicyService) ListPolicies(ctx context.Context, status, productType string, limit, offset int) ([]models.Policy, error) {
	return s.pg.ListPolicies(ctx, status, productType, limit, offset)
}

// --- State Machine Transitions ---

func (s *PolicyService) TransitionPolicy(ctx context.Context, policyID string, from, to models.PolicyState, actor, actorRole, reason string) error {
	pol, err := s.pg.GetPolicy(ctx, policyID)
	if err != nil {
		return fmt.Errorf("policy not found: %w", err)
	}

	allowed := models.ValidTransitions[from]
	valid := false
	for _, s := range allowed {
		if s == to {
			valid = true
			break
		}
	}
	if !valid {
		return fmt.Errorf("invalid transition: %s -> %s (allowed: %v)", from, to, allowed)
	}

	// Validate business rules for specific transitions
	if err := s.validateTransition(pol, from, to); err != nil {
		return fmt.Errorf("validation failed: %w", err)
	}

	// Execute transition
	if err := s.executeTransition(ctx, pol, from, to, actor, actorRole, reason); err != nil {
		return err
	}

	// Publish event
	_ = s.rdb.PublishStateChange(ctx, policyID, from, to)
	_ = s.rdb.InvalidatePolicy(ctx, policyID)
	_ = s.rdb.IncrementTransitionCount(ctx)

	s.log.Info("Policy state transitioned",
		zap.String("policy", policyID),
		zap.String("from", string(from)),
		zap.String("to", string(to)),
		zap.String("actor", actor),
	)
	return nil
}

func (s *PolicyService) validateTransition(pol *models.Policy, from, to models.PolicyState) error {
	switch to {
	case models.StateSubmitted:
		if !pol.KYCVerified {
			return fmt.Errorf("KYC must be verified before submission")
		}
	case models.StateUnderwriting:
		if pol.RiskScore < s.cfg.UnderwritingAutoThreshold {
			// Auto-route underwriting
			s.log.Info("Auto-routing underwriting", zap.String("policy", pol.ID))
		}
	case models.StateIssued:
		if pol.PaymentStatus != "paid" {
			return fmt.Errorf("payment must be confirmed before issuance")
		}
	case models.StateActive:
		if pol.IssuedAt == nil {
			return fmt.Errorf("policy must be issued before activation")
		}
	case models.StateCancelled:
		// Check cooling-off period for refund eligibility
		if pol.IssuedAt != nil {
			coolingOffEnd := pol.IssuedAt.AddDate(0, 0, s.cfg.CoolingOffDays)
			if time.Now().Before(coolingOffEnd) {
				s.log.Info("Cancellation within cooling-off period", zap.String("policy", pol.ID))
			}
		}
	case models.StateLapsed:
		// Check grace period
		if pol.LastPaymentDate != nil {
			graceEnd := pol.LastPaymentDate.AddDate(0, 0, s.cfg.LapseGracePeriodDays)
			if time.Now().Before(graceEnd) {
				s.log.Info("Grace period still active", zap.String("policy", pol.ID))
			}
		}
	}
	return nil
}

func (s *PolicyService) executeTransition(ctx context.Context, pol *models.Policy, from, to models.PolicyState, actor, actorRole, reason string) error {
	startTime := time.Now()

	// Create transition record
	transition := &models.PolicyTransition{
		PolicyID:  pol.ID,
		FromState: from,
		ToState:   to,
		Actor:     actor,
		ActorRole: actorRole,
		Reason:    reason,
	}
	if err := s.pg.CreateTransition(ctx, transition); err != nil {
		return fmt.Errorf("failed to record transition: %w", err)
	}

	// Update policy state and business fields based on transition
	updates := map[string]interface{}{
		"current_state": string(to),
		"updated_at":    time.Now(),
	}

	switch to {
	case models.StateUnderwriting:
		// Create underwriting record
		uw := &models.UnderwritingRecord{
			PolicyID:     pol.ID,
			RiskScore:    pol.RiskScore,
			AutoRoute:    pol.RiskScore < s.cfg.UnderwritingAutoThreshold,
			Recommendation: "pending",
			Status:       "pending",
		}
		if err := s.pg.CreateUnderwritingRecord(ctx, uw); err != nil {
			s.log.Warn("Failed to create underwriting record", zap.Error(err))
		}
	case models.StateApproved:
		updates["status"] = "approved"
	case models.StateDeclined:
		updates["status"] = "declined"
	case models.StateIssued:
		now := time.Now()
		updates["status"] = "active"
		updates["issued_at"] = &now
		updates["current_state"] = string(models.StateIssued)
	case models.StateActive:
		now := time.Now()
		updates["status"] = "active"
		updates["active_since"] = &now
		updates["current_state"] = string(models.StateActive)
	case models.StateLapsed:
		now := time.Now()
		updates["lapsed_at"] = &now
		updates["status"] = "lapsed"
		updates["current_state"] = string(models.StateLapsed)
	case models.StateCancelled:
		now := time.Now()
		updates["cancelled_at"] = &now
		updates["status"] = "cancelled"
		updates["cancellation_reason"] = reason
		updates["current_state"] = string(models.StateCancelled)
	}

	if err := s.pg.UpdatePolicy(ctx, pol.ID, updates); err != nil {
		return fmt.Errorf("failed to update policy state: %w", err)
	}

	return nil
}

// --- Underwriting ---

func (s *PolicyService) StartUnderwriting(ctx context.Context, policyID string) error {
	pol, err := s.pg.GetPolicy(ctx, policyID)
	if err != nil {
		return err
	}

	// Check risk score for auto-route
	autoRoute := pol.RiskScore < s.cfg.UnderwritingAutoThreshold
	recommendation := "pending"

	if autoRoute {
		if pol.RiskScore < 30 {
			recommendation = "approve"
		} else if pol.RiskScore > 80 {
			recommendation = "decline"
		} else {
			recommendation = "approve"
		}
	}

	uw := &models.UnderwritingRecord{
		PolicyID:       pol.ID,
		RiskScore:      pol.RiskScore,
		RiskFactors:    fmt.Sprintf(`{"score":%d, "auto_route":%t}`, pol.RiskScore, autoRoute),
		AutoRoute:      autoRoute,
		Recommendation: recommendation,
		Status:         "completed",
		CompletedAt:    func() *time.Time { t := time.Now(); return &t }(),
	}

	if err := s.pg.CreateUnderwritingRecord(ctx, uw); err != nil {
		return err
	}

	return nil
}

func (s *PolicyService) GetUnderwritingRecord(ctx context.Context, policyID string) (*models.UnderwritingRecord, error) {
	return s.pg.GetUnderwritingRecord(ctx, policyID)
}

// --- Renewal ---

func (s *PolicyService) CreateRenewalRecord(ctx context.Context, renewal *models.RenewalRecord) error {
	if renewal.PolicyID == "" {
		return fmt.Errorf("policy_id is required")
	}
	return s.pg.CreateRenewalRecord(ctx, renewal)
}

func (s *PolicyService) GetRenewalRecords(ctx context.Context, policyID string) ([]models.RenewalRecord, error) {
	return s.pg.GetRenewalRecords(ctx, policyID)
}

func (s *PolicyService) ProcessRenewal(ctx context.Context, policyID string, newPremium, newSumAssured float64) error {
	pol, err := s.pg.GetPolicy(ctx, policyID)
	if err != nil {
		return err
	}

	renewal := &models.RenewalRecord{
		PolicyID:       pol.ID,
		OriginalExpiry: pol.CoverageEnd,
		RenewalDate:    time.Now(),
		NewExpiry:      pol.CoverageEnd.AddDate(1, 0, 0),
		NewPremium:     newPremium,
		NewSumAssured:  newSumAssured,
		RenewalStatus:  "offered",
		PaymentStatus:  "pending",
		RenewalMethod:  "auto",
		GracePeriodEnd: pol.CoverageEnd.AddDate(0, 0, s.cfg.RenewalGracePeriodDays),
	}

	if err := s.pg.CreateRenewalRecord(ctx, renewal); err != nil {
		return err
	}

	return nil
}

func (s *PolicyService) AcceptRenewal(ctx context.Context, renewalID string) error {
	return s.pg.UpdateRenewalStatus(ctx, renewalID, "accepted")
}

// --- Endorsement ---

func (s *PolicyService) CreateEndorsement(ctx context.Context, end *models.Endorsement) error {
	if end.PolicyID == "" {
		return fmt.Errorf("policy_id is required")
	}
	return s.pg.CreateEndorsement(ctx, end)
}

func (s *PolicyService) GetEndorsements(ctx context.Context, policyID, status string, limit int) ([]models.Endorsement, error) {
	return s.pg.GetEndorsements(ctx, policyID, status, limit)
}

func (s *PolicyService) ApproveEndorsement(ctx context.Context, endorsementID, approvedBy string) error {
	return s.pg.ApproveEndorsement(ctx, endorsementID, approvedBy)
}

// --- Lapse Management ---

func (s *PolicyService) CreateLapseRule(ctx context.Context, lr *models.LapseRule) error {
	if lr.PolicyID == "" {
		return fmt.Errorf("policy_id is required")
	}
	lr.GracePeriodDays = s.cfg.LapseGracePeriodDays
	lr.Status = "current"
	return s.pg.CreateLapseRule(ctx, lr)
}

func (s *PolicyService) CheckAndProcessLapses(ctx context.Context) error {
	// Find policies that are active but past due
	activePolicies, _ := s.pg.ListPolicies(ctx, "active", "", 100, 0)
	now := time.Now()

	for _, pol := range activePolicies {
		if pol.LastPaymentDate == nil {
			continue
		}
		graceEnd := pol.LastPaymentDate.AddDate(0, 0, s.cfg.LapseGracePeriodDays)
		if now.After(graceEnd) {
			// Policy has lapsed
			transition := &models.PolicyTransition{
				PolicyID:  pol.ID,
				FromState: models.StateActive,
				ToState:   models.StateLapsed,
				Actor:     "system",
				ActorRole: "scheduler",
				Reason:    "Payment overdue, grace period expired",
			}
			if err := s.pg.CreateTransition(ctx, transition); err != nil {
				s.log.Warn("Failed to record lapse transition", zap.String("policy", pol.ID), zap.Error(err))
			}

			updates := map[string]interface{}{
				"current_state": string(models.StateLapsed),
				"status":        "lapsed",
				"lapsed_at":     now,
				"updated_at":    now,
			}
			if err := s.pg.UpdatePolicy(ctx, pol.ID, updates); err != nil {
				s.log.Warn("Failed to update lapsed policy", zap.String("policy", pol.ID), zap.Error(err))
			}

			s.log.Info("Policy lapsed", zap.String("policy", pol.PolicyNumber))
		}
	}
	return nil
}

// --- Cancellation ---

func (s *PolicyService) CancelPolicy(ctx context.Context, policyID, cancelType, reason, cancelledBy string) error {
	pol, err := s.pg.GetPolicy(ctx, policyID)
	if err != nil {
		return err
	}

	// Calculate refund if applicable
	refundAmount := 0.0
	if pol.IssuedAt != nil {
		coolingOffEnd := pol.IssuedAt.AddDate(0, 0, s.cfg.CoolingOffDays)
		if cancelType == "cooling_off" && time.Now().Before(coolingOffEnd) {
			refundAmount = pol.Premium // Full refund within cooling-off period
		} else if pol.SumAssured > 0 {
			// Pro-rata refund
			totalDays := pol.CoverageEnd.Sub(pol.IssuedAt).Hours() / 24
			remainingDays := pol.CoverageEnd.Sub(now()).Hours() / 24
			if totalDays > 0 {
				refundAmount = pol.Premium * (remainingDays / totalDays)
			}
		}
	}

	// Create cancellation record
	cancel := &models.CancellationRecord{
		PolicyID:       pol.ID,
		Type:           cancelType,
		Reason:         reason,
		CancellationDate: now(),
		CancelledBy:    cancelledBy,
		RefundAmount:   refundAmount,
		RefundStatus:   "pending",
	}
	if err := s.pg.CreateCancellationRecord(ctx, cancel); err != nil {
		return err
	}

	// Transition policy to cancelled
	transition := &models.PolicyTransition{
		PolicyID:  pol.ID,
		FromState: pol.CurrentState,
		ToState:   models.StateCancelled,
		Actor:     cancelledBy,
		ActorRole: "agent",
		Reason:    reason,
	}
	if err := s.pg.CreateTransition(ctx, transition); err != nil {
		s.log.Warn("Failed to record cancellation transition", zap.Error(err))
	}

	now := now()
	updates := map[string]interface{}{
		"current_state":        string(models.StateCancelled),
		"status":               "cancelled",
		"cancelled_at":         &now,
		"cancellation_reason":  reason,
		"refund_amount":        refundAmount,
		"updated_at":           now,
	}
	if err := s.pg.UpdatePolicy(ctx, pol.ID, updates); err != nil {
		return err
	}

	return nil
}

func (s *PolicyService) GetCancellationRecord(ctx context.Context, policyID string) (*models.CancellationRecord, error) {
	return s.pg.GetCancellationRecord(ctx, policyID)
}

// --- Dashboard ---

func (s *PolicyService) GetDashboard(ctx context.Context) (*models.PolicyDashboard, error) {
	if cached, err := s.rdb.GetCachedDashboard(ctx); err == nil && cached != nil {
		return cached, nil
	}

	stateCounts, err := s.pg.CountPoliciesByState(ctx)
	if err != nil {
		return nil, err
	}

	dash := &models.PolicyDashboard{
		TotalPolicies:      0,
		DraftCount:         stateCounts["draft"],
		ActiveCount:        stateCounts["active"],
		UnderwritingCount:  stateCounts["underwriting"],
		RenewalCount:       stateCounts["renewal"],
		LapsedCount:        stateCounts["lapsed"],
		CancelledCount:     stateCounts["cancelled"],
		DeclinedCount:      stateCounts["declined"],
	}

	policies, _ := s.pg.ListPolicies(ctx, "", "", 1000, 0)
	for _, pol := range policies {
		dash.TotalPolicies++
		dash.TotalPremium += pol.Premium
		dash.TotalSumAssured += pol.SumAssured
		if pol.CurrentState == models.StateUnderwriting || pol.CurrentState == models.StateReferred {
			if pol.RiskScore < s.cfg.UnderwritingAutoThreshold {
				dash.AutoUnderwritten++
			} else {
				dash.ManualUnderwritten++
			}
		}
	}

	if dash.TotalPolicies > 0 {
		dash.ApprovalRate = float64(dash.ActiveCount) / float64(dash.TotalPolicies) * 100
	}

	s.rdb.CacheDashboard(ctx, dash)
	return dash, nil
}

func now() time.Time { return time.Now() }
