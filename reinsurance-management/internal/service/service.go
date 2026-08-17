package service

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/unified-insurance/reinsurance-management/internal/models"
	"github.com/unified-insurance/reinsurance-management/internal/repository"

	"github.com/google/uuid"
)

type ReinsuranceService struct {
	repo *repository.ReinsuranceRepository
}

func NewReinsuranceService(repo *repository.ReinsuranceRepository) *ReinsuranceService {
	return &ReinsuranceService{repo: repo}
}

func (s *ReinsuranceService) CreateTreaty(ctx context.Context, req CreateTreatyRequest) (*models.Treaty, error) {
	if req.CessionPercentage <= 0 || req.CessionPercentage > 1.0 {
		return nil, fmt.Errorf("cession percentage must be between 0 and 1")
	}
	treatyNumber := fmt.Sprintf("TR-%s-%d", time.Now().Format("2006"), time.Now().UnixNano()%1000000)
	treaty := &models.Treaty{
		TreatyNumber: treatyNumber, TreatyName: req.TreatyName, TreatyType: req.TreatyType,
		LineOfBusiness: req.LineOfBusiness, LeadReinsurer: req.LeadReinsurer,
		EffectiveDate: req.EffectiveDate, ExpiryDate: req.ExpiryDate,
		RetentionLimit: req.RetentionLimit, CessionPercentage: req.CessionPercentage,
		CommissionRate: req.CommissionRate, ProfitCommission: req.ProfitCommission, Status: "active",
	}
	if err := s.repo.CreateTreaty(ctx, treaty); err != nil {
		return nil, fmt.Errorf("failed to create treaty: %w", err)
	}
	return treaty, nil
}

func (s *ReinsuranceService) AddReinsurerParticipation(ctx context.Context, req AddParticipationRequest) (*models.ReinsurerParticipation, error) {
	if _, err := s.repo.GetTreaty(ctx, req.TreatyID); err != nil {
		return nil, fmt.Errorf("treaty not found: %w", err)
	}
	existing, _ := s.repo.GetParticipations(ctx, req.TreatyID)
	totalShare := req.SharePercentage
	for _, p := range existing {
		totalShare += p.SharePercentage
	}
	if totalShare > 1.0 {
		return nil, fmt.Errorf("total reinsurer share exceeds 100%%: %.2f%%", totalShare*100)
	}
	part := &models.ReinsurerParticipation{
		TreatyID: req.TreatyID, ReinsurerName: req.ReinsurerName, ReinsurerCode: req.ReinsurerCode,
		SharePercentage: req.SharePercentage, CreditRating: req.CreditRating,
		Country: req.Country, ContactEmail: req.ContactEmail, IsLeader: req.IsLeader,
	}
	if err := s.repo.CreateParticipation(ctx, part); err != nil {
		return nil, fmt.Errorf("failed to add participation: %w", err)
	}
	return part, nil
}

func (s *ReinsuranceService) CalculateCession(ctx context.Context, req CessionRequest) (*models.CessionRecord, error) {
	treaty, err := s.repo.GetTreaty(ctx, req.TreatyID)
	if err != nil {
		return nil, fmt.Errorf("treaty not found: %w", err)
	}
	if treaty.Status != "active" {
		return nil, fmt.Errorf("treaty is not active")
	}

	var retainedAmount, cededAmount, cededPremium, commission float64

	switch treaty.TreatyType {
	case "quota_share":
		cededAmount = req.SumInsured * treaty.CessionPercentage
		retainedAmount = req.SumInsured - cededAmount
		cededPremium = req.GrossPremium * treaty.CessionPercentage
		commission = cededPremium * treaty.CommissionRate
	case "surplus":
		if req.SumInsured <= treaty.RetentionLimit {
			retainedAmount = req.SumInsured
			cededAmount = 0
		} else {
			retainedAmount = treaty.RetentionLimit
			cededAmount = math.Min(req.SumInsured-treaty.RetentionLimit, treaty.RetentionLimit*float64(req.NumberOfLines))
		}
		if req.SumInsured > 0 {
			cededPremium = req.GrossPremium * (cededAmount / req.SumInsured)
		}
		commission = cededPremium * treaty.CommissionRate
	case "excess_of_loss":
		retainedAmount = math.Min(req.SumInsured, treaty.RetentionLimit)
		cededAmount = math.Max(0, req.SumInsured-treaty.RetentionLimit)
		cededPremium = req.GrossPremium * treaty.CessionPercentage
		commission = cededPremium * treaty.CommissionRate
	case "stop_loss":
		retainedAmount = req.SumInsured
		cededAmount = 0
		cededPremium = req.GrossPremium * treaty.CessionPercentage
		commission = cededPremium * treaty.CommissionRate
	}

	cession := &models.CessionRecord{
		TreatyID: req.TreatyID, PolicyID: req.PolicyID, PolicyNumber: req.PolicyNumber,
		LineOfBusiness: treaty.LineOfBusiness, SumInsured: req.SumInsured,
		RetainedAmount: math.Round(retainedAmount*100) / 100,
		CededAmount:    math.Round(cededAmount*100) / 100,
		GrossPremium:   req.GrossPremium,
		CededPremium:   math.Round(cededPremium*100) / 100,
		Commission:     math.Round(commission*100) / 100,
		EffectiveDate:  req.EffectiveDate, ExpiryDate: req.ExpiryDate,
	}
	if err := s.repo.CreateCession(ctx, cession); err != nil {
		return nil, fmt.Errorf("failed to create cession: %w", err)
	}
	return cession, nil
}

func (s *ReinsuranceService) CreateFacultativePlacement(ctx context.Context, req FacultativeRequest) (*models.FacultativePlacement, error) {
	placementRef := fmt.Sprintf("FAC-%s-%d", time.Now().Format("2006"), time.Now().UnixNano()%1000000)
	cededAmount := req.SumInsured - req.RetainedAmount
	cededPremium := 0.0
	if req.SumInsured > 0 {
		cededPremium = req.Premium * (cededAmount / req.SumInsured)
	}
	commission := cededPremium * req.CommissionRate

	fac := &models.FacultativePlacement{
		PlacementRef: placementRef, PolicyID: req.PolicyID, InsuredName: req.InsuredName,
		RiskDescription: req.RiskDescription, LineOfBusiness: req.LineOfBusiness,
		SumInsured: req.SumInsured, RetainedAmount: req.RetainedAmount,
		CededAmount: math.Round(cededAmount*100) / 100,
		Premium:     req.Premium, CededPremium: math.Round(cededPremium*100) / 100,
		Commission:  math.Round(commission*100) / 100,
		RiskDetails: req.RiskDetails, Status: "pending",
	}
	if err := s.repo.CreateFacPlacement(ctx, fac); err != nil {
		return nil, fmt.Errorf("failed to create placement: %w", err)
	}
	return fac, nil
}

func (s *ReinsuranceService) PlaceFacultative(ctx context.Context, placementID uuid.UUID, reinsurerName string) error {
	return s.repo.UpdateFacPlacementStatus(ctx, placementID, "placed", reinsurerName)
}

func (s *ReinsuranceService) CalculateClaimRecovery(ctx context.Context, req ClaimRecoveryRequest) (*models.ClaimRecovery, error) {
	treaty, err := s.repo.GetTreaty(ctx, req.TreatyID)
	if err != nil {
		return nil, fmt.Errorf("treaty not found: %w", err)
	}

	var retainedAmount, recoveryAmount float64
	switch treaty.TreatyType {
	case "quota_share":
		recoveryAmount = req.GrossClaimAmount * treaty.CessionPercentage
		retainedAmount = req.GrossClaimAmount - recoveryAmount
	case "surplus":
		cessions, _ := s.repo.GetCessionsByTreaty(ctx, req.TreatyID)
		cessionRatio := 0.0
		for _, c := range cessions {
			if c.PolicyID == req.PolicyID && c.SumInsured > 0 {
				cessionRatio = c.CededAmount / c.SumInsured
				break
			}
		}
		recoveryAmount = req.GrossClaimAmount * cessionRatio
		retainedAmount = req.GrossClaimAmount - recoveryAmount
	case "excess_of_loss":
		retainedAmount = math.Min(req.GrossClaimAmount, treaty.RetentionLimit)
		recoveryAmount = math.Max(0, req.GrossClaimAmount-treaty.RetentionLimit)
	default:
		retainedAmount = req.GrossClaimAmount
		recoveryAmount = 0
	}

	recovery := &models.ClaimRecovery{
		ClaimID: req.ClaimID, TreatyID: req.TreatyID, PolicyID: req.PolicyID,
		GrossClaimAmount: req.GrossClaimAmount,
		RetainedAmount:   math.Round(retainedAmount*100) / 100,
		RecoveryAmount:   math.Round(recoveryAmount*100) / 100,
		Status:           "pending",
	}
	if err := s.repo.CreateClaimRecovery(ctx, recovery); err != nil {
		return nil, fmt.Errorf("failed to create recovery: %w", err)
	}
	return recovery, nil
}

func (s *ReinsuranceService) SubmitClaimRecovery(ctx context.Context, recoveryID uuid.UUID) error {
	return s.repo.UpdateClaimRecoveryStatus(ctx, recoveryID, "submitted")
}

func (s *ReinsuranceService) GenerateBordereau(ctx context.Context, treatyID uuid.UUID, period string) ([]models.BordereauEntry, error) {
	cessions, err := s.repo.GetCessionsByTreaty(ctx, treatyID)
	if err != nil {
		return nil, fmt.Errorf("failed to get cessions: %w", err)
	}
	var entries []models.BordereauEntry
	for _, c := range cessions {
		entry := models.BordereauEntry{
			TreatyID: treatyID, Period: period, EntryType: "premium",
			PolicyNumber: c.PolicyNumber, RiskClass: c.LineOfBusiness,
			InceptionDate: c.EffectiveDate, ExpiryDate: c.ExpiryDate,
			SumInsured: c.SumInsured, GrossPremium: c.GrossPremium,
			CededPremium: c.CededPremium, Commission: c.Commission,
		}
		if err := s.repo.CreateBordereauxEntry(ctx, &entry); err != nil {
			return nil, fmt.Errorf("failed to create bordereau entry: %w", err)
		}
		entries = append(entries, entry)
	}
	return entries, nil
}

func (s *ReinsuranceService) GenerateAccountStatement(ctx context.Context, treatyID uuid.UUID, period string) (*models.ReinsuranceAccount, error) {
	start, _ := time.Parse("2006-01", period)
	end := start.AddDate(0, 3, 0) // quarterly

	cededPremium, _ := s.repo.GetTotalCededPremium(ctx, treatyID, start, end)
	totalRecoveries, _ := s.repo.GetTotalRecoveries(ctx, treatyID)

	treaty, err := s.repo.GetTreaty(ctx, treatyID)
	if err != nil {
		return nil, fmt.Errorf("treaty not found: %w", err)
	}

	commission := cededPremium * treaty.CommissionRate
	profitComm := 0.0
	if cededPremium > totalRecoveries {
		profitComm = (cededPremium - totalRecoveries - commission) * treaty.ProfitCommission
	}
	balance := cededPremium - commission - totalRecoveries - profitComm

	account := &models.ReinsuranceAccount{
		TreatyID: treatyID, Period: period,
		CededPremium:     math.Round(cededPremium*100) / 100,
		Commission:       math.Round(commission*100) / 100,
		ClaimsRecovered:  math.Round(totalRecoveries*100) / 100,
		ProfitCommission: math.Round(profitComm*100) / 100,
		Balance:          math.Round(balance*100) / 100,
		Status:           "open",
	}
	if err := s.repo.CreateAccount(ctx, account); err != nil {
		return nil, fmt.Errorf("failed to create account: %w", err)
	}
	return account, nil
}

func (s *ReinsuranceService) CalculateAnalytics(ctx context.Context, period string) (*models.ReinsuranceAnalytics, error) {
	treaties, err := s.repo.ListTreaties(ctx, "")
	if err != nil {
		return nil, fmt.Errorf("failed to list treaties: %w", err)
	}

	totalCeded := 0.0
	totalRecovered := 0.0
	byLOB := make(map[string]float64)

	start, _ := time.Parse("2006-01", period)
	end := start.AddDate(0, 3, 0)

	for _, treaty := range treaties {
		ceded, _ := s.repo.GetTotalCededPremium(ctx, treaty.ID, start, end)
		recovered, _ := s.repo.GetTotalRecoveries(ctx, treaty.ID)
		totalCeded += ceded
		totalRecovered += recovered
		byLOB[treaty.LineOfBusiness] += ceded
	}

	cessionRatio := 0.0
	recoveryRatio := 0.0
	if totalCeded > 0 {
		recoveryRatio = totalRecovered / totalCeded
	}

	analytics := &models.ReinsuranceAnalytics{
		Period: period, TotalCeded: totalCeded, TotalRecovered: totalRecovered,
		NetRetention: totalCeded - totalRecovered, CessionRatio: cessionRatio,
		RecoveryRatio: math.Round(recoveryRatio*10000) / 10000, ByLineOfBusiness: byLOB,
	}
	if err := s.repo.CreateAnalytics(ctx, analytics); err != nil {
		return nil, fmt.Errorf("failed to create analytics: %w", err)
	}
	return analytics, nil
}

func (s *ReinsuranceService) GetTreaties(ctx context.Context, lob string) ([]models.Treaty, error) {
	return s.repo.ListTreaties(ctx, lob)
}

func (s *ReinsuranceService) GetTreaty(ctx context.Context, id uuid.UUID) (*models.Treaty, error) {
	return s.repo.GetTreaty(ctx, id)
}

func (s *ReinsuranceService) GetParticipations(ctx context.Context, treatyID uuid.UUID) ([]models.ReinsurerParticipation, error) {
	return s.repo.GetParticipations(ctx, treatyID)
}

func (s *ReinsuranceService) GetFacPlacements(ctx context.Context, status string) ([]models.FacultativePlacement, error) {
	return s.repo.ListFacPlacements(ctx, status)
}

func (s *ReinsuranceService) GetRecoveries(ctx context.Context, treatyID uuid.UUID) ([]models.ClaimRecovery, error) {
	return s.repo.GetRecoveriesByTreaty(ctx, treatyID)
}

func (s *ReinsuranceService) GetBordereau(ctx context.Context, treatyID uuid.UUID, period string) ([]models.BordereauEntry, error) {
	return s.repo.GetBordereauxByTreaty(ctx, treatyID, period)
}

func (s *ReinsuranceService) GetAccounts(ctx context.Context, treatyID uuid.UUID) ([]models.ReinsuranceAccount, error) {
	return s.repo.GetAccountsByTreaty(ctx, treatyID)
}
