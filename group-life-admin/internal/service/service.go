package service

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/unified-insurance/group-life-admin/internal/models"
	"github.com/unified-insurance/group-life-admin/internal/repository"

	"github.com/google/uuid"
)

type GroupLifeService struct {
	repo *repository.GroupLifeRepository
}

func NewGroupLifeService(repo *repository.GroupLifeRepository) *GroupLifeService {
	return &GroupLifeService{repo: repo}
}

func (s *GroupLifeService) CreateScheme(ctx context.Context, req CreateSchemeRequest) (*models.GroupScheme, error) {
	schemeNo := fmt.Sprintf("GLS-%s-%d", time.Now().Format("2006"), time.Now().UnixNano()%1000000)
	scheme := &models.GroupScheme{
		SchemeNumber: schemeNo, EmployerName: req.EmployerName, EmployerCode: req.EmployerCode,
		Industry: req.Industry, ContactPerson: req.ContactPerson, ContactEmail: req.ContactEmail,
		ContactPhone: req.ContactPhone, Address: req.Address, State: req.State,
		InceptionDate: req.InceptionDate, RenewalDate: req.InceptionDate.AddDate(1, 0, 0),
		Status: "active",
	}
	if err := s.repo.CreateScheme(ctx, scheme); err != nil {
		return nil, fmt.Errorf("failed to create scheme: %w", err)
	}
	return scheme, nil
}

func (s *GroupLifeService) AddMember(ctx context.Context, req AddMemberRequest) (*models.SchemeMember, error) {
	scheme, err := s.repo.GetScheme(ctx, req.SchemeID)
	if err != nil {
		return nil, fmt.Errorf("scheme not found")
	}
	if scheme.Status != "active" {
		return nil, fmt.Errorf("scheme is not active")
	}

	sumAssured := req.Salary * req.BenefitMultiple
	if req.BenefitMultiple == 0 {
		sumAssured = req.Salary * 3 // default 3x salary
	}

	member := &models.SchemeMember{
		SchemeID: req.SchemeID, EmployeeID: req.EmployeeID,
		FirstName: req.FirstName, LastName: req.LastName,
		DateOfBirth: req.DateOfBirth, Gender: req.Gender,
		Designation: req.Designation, Salary: req.Salary,
		SumAssured: sumAssured, BenefitMultiple: req.BenefitMultiple,
		JoinDate: time.Now(), Status: "active",
	}
	if err := s.repo.CreateMember(ctx, member); err != nil {
		return nil, fmt.Errorf("failed to add member: %w", err)
	}

	s.updateSchemeAggregates(ctx, req.SchemeID)
	return member, nil
}

func (s *GroupLifeService) RemoveMember(ctx context.Context, memberID uuid.UUID) error {
	member, err := s.repo.GetMember(ctx, memberID)
	if err != nil {
		return fmt.Errorf("member not found")
	}
	now := time.Now()
	member.Status = "exited"
	member.ExitDate = &now
	if err := s.repo.UpdateMember(ctx, member); err != nil {
		return fmt.Errorf("failed to update member: %w", err)
	}
	s.updateSchemeAggregates(ctx, member.SchemeID)
	return nil
}

func (s *GroupLifeService) AddBeneficiary(ctx context.Context, req AddBeneficiaryRequest) (*models.MemberBeneficiary, error) {
	existing, _ := s.repo.GetBeneficiaries(ctx, req.MemberID)
	totalShare := req.SharePercent
	for _, b := range existing {
		totalShare += b.SharePercent
	}
	if totalShare > 100 {
		return nil, fmt.Errorf("total beneficiary share exceeds 100%%")
	}

	ben := &models.MemberBeneficiary{
		MemberID: req.MemberID, FullName: req.FullName,
		Relationship: req.Relationship, DateOfBirth: req.DateOfBirth,
		Phone: req.Phone, SharePercent: req.SharePercent,
		BankName: req.BankName, AccountNumber: req.AccountNumber,
	}
	if err := s.repo.CreateBeneficiary(ctx, ben); err != nil {
		return nil, fmt.Errorf("failed to add beneficiary: %w", err)
	}
	return ben, nil
}

func (s *GroupLifeService) SubmitClaim(ctx context.Context, req SubmitClaimRequest) (*models.GroupClaim, error) {
	member, err := s.repo.GetMember(ctx, req.MemberID)
	if err != nil {
		return nil, fmt.Errorf("member not found")
	}

	claimAmount := member.SumAssured
	switch req.ClaimType {
	case "death":
		claimAmount = member.SumAssured
	case "permanent_disability":
		claimAmount = member.SumAssured
	case "temporary_disability":
		claimAmount = member.SumAssured * 0.5
	case "critical_illness":
		claimAmount = member.SumAssured * 0.75
	case "funeral":
		claimAmount = math.Min(member.SumAssured*0.1, 500000) // max NGN 500k funeral
	}

	claim := &models.GroupClaim{
		ClaimNumber: fmt.Sprintf("GLC-%d", time.Now().UnixNano()%1000000),
		SchemeID:    member.SchemeID, MemberID: req.MemberID,
		ClaimType: req.ClaimType, EventDate: req.EventDate,
		ReportDate: time.Now(), SumAssured: member.SumAssured,
		ClaimAmount: claimAmount, CauseOfEvent: req.CauseOfEvent,
		MedicalReport: req.MedicalReport, DeathCertRef: req.DeathCertRef,
		Status: "submitted",
	}
	if err := s.repo.CreateClaim(ctx, claim); err != nil {
		return nil, fmt.Errorf("failed to submit claim: %w", err)
	}
	return claim, nil
}

func (s *GroupLifeService) ApproveClaim(ctx context.Context, claimID uuid.UUID, approvedAmount float64) error {
	claim, err := s.repo.GetClaim(ctx, claimID)
	if err != nil {
		return fmt.Errorf("claim not found")
	}
	if claim.Status != "submitted" && claim.Status != "under_review" {
		return fmt.Errorf("claim cannot be approved in current state: %s", claim.Status)
	}
	if approvedAmount > claim.ClaimAmount {
		return fmt.Errorf("approved amount cannot exceed claim amount")
	}
	now := time.Now()
	claim.Status = "approved"
	claim.ApprovedAmount = approvedAmount
	claim.ApprovedAt = &now
	return s.repo.UpdateClaim(ctx, claim)
}

func (s *GroupLifeService) DeclineClaim(ctx context.Context, claimID uuid.UUID, reason string) error {
	claim, err := s.repo.GetClaim(ctx, claimID)
	if err != nil {
		return fmt.Errorf("claim not found")
	}
	claim.Status = "declined"
	claim.DeclineReason = reason
	return s.repo.UpdateClaim(ctx, claim)
}

func (s *GroupLifeService) CalculatePremium(ctx context.Context, schemeID uuid.UUID) (*models.PremiumSchedule, error) {
	scheme, err := s.repo.GetScheme(ctx, schemeID)
	if err != nil {
		return nil, fmt.Errorf("scheme not found")
	}
	members, err := s.repo.GetMembersByScheme(ctx, schemeID)
	if err != nil {
		return nil, fmt.Errorf("failed to get members: %w", err)
	}

	totalPremium := 0.0
	for _, m := range members {
		age := calculateAge(m.DateOfBirth)
		rate := getGroupLifeRate(age, m.Gender, scheme.Industry)
		memberPremium := m.SumAssured * rate / 1000
		totalPremium += memberPremium
	}

	discount := getGroupDiscount(len(members))
	grossPremium := totalPremium
	discountAmount := grossPremium * discount
	tax := (grossPremium - discountAmount) * 0.075 // 7.5% VAT
	netPremium := grossPremium - discountAmount + tax

	period := time.Now().Format("2006-01")
	ps := &models.PremiumSchedule{
		SchemeID: schemeID, Period: period,
		DueDate:      time.Now().AddDate(0, 0, 30),
		GrossPremium: math.Round(grossPremium*100) / 100,
		Discount:     math.Round(discountAmount*100) / 100,
		Tax:          math.Round(tax*100) / 100,
		NetPremium:   math.Round(netPremium*100) / 100,
		Status:       "pending",
	}
	if err := s.repo.CreatePremiumSchedule(ctx, ps); err != nil {
		return nil, fmt.Errorf("failed to create premium schedule: %w", err)
	}
	return ps, nil
}

func (s *GroupLifeService) RecordPayment(ctx context.Context, scheduleID uuid.UUID, amount float64, paymentRef string) error {
	schedules, _ := s.repo.GetPremiumSchedules(ctx, uuid.Nil)
	for _, ps := range schedules {
		if ps.ID == scheduleID {
			now := time.Now()
			ps.PaidAmount = amount
			ps.PaymentDate = &now
			ps.PaymentRef = paymentRef
			if amount >= ps.NetPremium {
				ps.Status = "paid"
			} else {
				ps.Status = "partially_paid"
			}
			return s.repo.UpdatePremiumSchedule(ctx, &ps)
		}
	}
	return fmt.Errorf("premium schedule not found")
}

func (s *GroupLifeService) CreateEndorsement(ctx context.Context, req EndorsementRequest) (*models.SchemeEndorsement, error) {
	endorsement := &models.SchemeEndorsement{
		EndorsementNo: fmt.Sprintf("END-%d", time.Now().UnixNano()%1000000),
		SchemeID:      req.SchemeID, EndorsementType: req.EndorsementType,
		Description: req.Description, EffectiveDate: req.EffectiveDate,
		PremiumImpact: req.PremiumImpact, Status: "pending",
	}
	if err := s.repo.CreateEndorsement(ctx, endorsement); err != nil {
		return nil, fmt.Errorf("failed to create endorsement: %w", err)
	}
	return endorsement, nil
}

func (s *GroupLifeService) CalculateExperienceRating(ctx context.Context, schemeID uuid.UUID, period string) (*models.ExperienceRating, error) {
	earnedPremium, _ := s.repo.GetTotalEarnedPremium(ctx, schemeID)
	incurredClaims, _ := s.repo.GetTotalClaimsByScheme(ctx, schemeID, period)

	lossRatio := 0.0
	if earnedPremium > 0 {
		lossRatio = incurredClaims / earnedPremium
	}
	expenseRatio := 0.25 // 25% standard expense ratio
	combinedRatio := lossRatio + expenseRatio

	renewalRate := 0.0
	if combinedRatio > 1.0 {
		renewalRate = (combinedRatio - 0.85) * 100 // increase if unprofitable
	} else if combinedRatio < 0.6 {
		renewalRate = -10.0 // 10% discount for very profitable schemes
	}

	er := &models.ExperienceRating{
		SchemeID: schemeID, Period: period,
		EarnedPremium: earnedPremium, IncurredClaims: incurredClaims,
		LossRatio:     math.Round(lossRatio*10000) / 10000,
		ExpenseRatio:  expenseRatio,
		CombinedRatio: math.Round(combinedRatio*10000) / 10000,
		RenewalRate:   math.Round(renewalRate*100) / 100,
	}
	if err := s.repo.CreateExperienceRating(ctx, er); err != nil {
		return nil, fmt.Errorf("failed to create experience rating: %w", err)
	}
	return er, nil
}

func (s *GroupLifeService) GetSchemes(ctx context.Context, status string) ([]models.GroupScheme, error) {
	return s.repo.ListSchemes(ctx, status)
}

func (s *GroupLifeService) GetScheme(ctx context.Context, id uuid.UUID) (*models.GroupScheme, error) {
	return s.repo.GetScheme(ctx, id)
}

func (s *GroupLifeService) GetMembers(ctx context.Context, schemeID uuid.UUID) ([]models.SchemeMember, error) {
	return s.repo.GetMembersByScheme(ctx, schemeID)
}

func (s *GroupLifeService) GetBeneficiaries(ctx context.Context, memberID uuid.UUID) ([]models.MemberBeneficiary, error) {
	return s.repo.GetBeneficiaries(ctx, memberID)
}

func (s *GroupLifeService) GetClaims(ctx context.Context, schemeID uuid.UUID) ([]models.GroupClaim, error) {
	return s.repo.GetClaimsByScheme(ctx, schemeID)
}

func (s *GroupLifeService) GetPremiumSchedules(ctx context.Context, schemeID uuid.UUID) ([]models.PremiumSchedule, error) {
	return s.repo.GetPremiumSchedules(ctx, schemeID)
}

func (s *GroupLifeService) GetEndorsements(ctx context.Context, schemeID uuid.UUID) ([]models.SchemeEndorsement, error) {
	return s.repo.GetEndorsements(ctx, schemeID)
}

func (s *GroupLifeService) GetExperienceRatings(ctx context.Context, schemeID uuid.UUID) ([]models.ExperienceRating, error) {
	return s.repo.GetExperienceRatings(ctx, schemeID)
}

func (s *GroupLifeService) updateSchemeAggregates(ctx context.Context, schemeID uuid.UUID) {
	scheme, err := s.repo.GetScheme(ctx, schemeID)
	if err != nil {
		return
	}
	count, _ := s.repo.CountActiveMembers(ctx, schemeID)
	totalSA, _ := s.repo.GetTotalSumAssured(ctx, schemeID)
	scheme.TotalMembers = int(count)
	scheme.TotalSumAssured = totalSA
	_ = s.repo.UpdateScheme(ctx, scheme)
}

func calculateAge(dob time.Time) int {
	now := time.Now()
	age := now.Year() - dob.Year()
	if now.YearDay() < dob.YearDay() {
		age--
	}
	return age
}

func getGroupLifeRate(age int, gender, industry string) float64 {
	var baseRate float64 // per mille
	if age < 30 {
		baseRate = 1.5
	} else if age < 40 {
		baseRate = 2.0
	} else if age < 50 {
		baseRate = 3.0
	} else if age < 60 {
		baseRate = 5.0
	} else {
		baseRate = 8.0
	}

	industryFactor := 1.0
	switch industry {
	case "mining", "oil_gas":
		industryFactor = 2.0
	case "construction":
		industryFactor = 1.7
	case "manufacturing":
		industryFactor = 1.3
	case "transport":
		industryFactor = 1.5
	case "banking", "technology":
		industryFactor = 0.8
	}

	if gender == "F" {
		baseRate *= 0.85 // female mortality adjustment
	}

	return baseRate * industryFactor
}

func getGroupDiscount(memberCount int) float64 {
	if memberCount > 500 {
		return 0.15
	} else if memberCount > 200 {
		return 0.10
	} else if memberCount > 100 {
		return 0.07
	} else if memberCount > 50 {
		return 0.05
	}
	return 0.0
}
