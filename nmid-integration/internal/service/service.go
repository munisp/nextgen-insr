package service

import (
	"context"
	"fmt"
	"github.com/unified-insurance/nmid-integration/internal/models"
	"github.com/unified-insurance/nmid-integration/internal/repository"
	"time"

	"github.com/google/uuid"
)

type NMIDService struct {
	repo *repository.NMIDRepository
}

func NewNMIDService(repo *repository.NMIDRepository) *NMIDService {
	return &NMIDService{repo: repo}
}

func (s *NMIDService) RegisterVehicle(ctx context.Context, req RegisterVehicleRequest) (*models.VehicleRecord, error) {
	if !isValidNigerianPlate(req.RegistrationNo) {
		return nil, fmt.Errorf("invalid Nigerian vehicle registration number format")
	}
	existing, _ := s.repo.GetVehicle(ctx, req.RegistrationNo)
	if existing != nil {
		return nil, fmt.Errorf("vehicle already registered with plate: %s", req.RegistrationNo)
	}
	vehicle := &models.VehicleRecord{
		RegistrationNo: req.RegistrationNo, ChassisNo: req.ChassisNo, EngineNo: req.EngineNo,
		Make: req.Make, Model: req.Model, Year: req.Year, Color: req.Color,
		VehicleType: req.VehicleType, OwnerName: req.OwnerName, OwnerPhone: req.OwnerPhone,
		OwnerAddress: req.OwnerAddress, State: req.State, LGA: req.LGA,
		NMIDVerified: false,
	}
	if err := s.repo.CreateVehicle(ctx, vehicle); err != nil {
		return nil, fmt.Errorf("failed to register vehicle: %w", err)
	}
	return vehicle, nil
}

func (s *NMIDService) VerifyVehicle(ctx context.Context, regNo string) (*models.VehicleRecord, error) {
	vehicle, err := s.repo.GetVehicle(ctx, regNo)
	if err != nil {
		return nil, fmt.Errorf("vehicle not found: %s", regNo)
	}
	now := time.Now()
	vehicle.NMIDVerified = true
	vehicle.LastVerifiedAt = &now
	if err := s.repo.UpdateVehicle(ctx, vehicle); err != nil {
		return nil, fmt.Errorf("failed to update vehicle: %w", err)
	}
	return vehicle, nil
}

func (s *NMIDService) RegisterPolicy(ctx context.Context, req RegisterPolicyRequest) (*models.PolicyRegistration, error) {
	vehicle, err := s.repo.GetVehicle(ctx, req.RegistrationNo)
	if err != nil {
		return nil, fmt.Errorf("vehicle not found: %s - register vehicle first", req.RegistrationNo)
	}
	if !vehicle.NMIDVerified {
		return nil, fmt.Errorf("vehicle not verified with NMID")
	}

	premium := calculateMotorPremium(req.CoverType, req.SumInsured, vehicle.VehicleType, vehicle.Year)
	nmidRef := fmt.Sprintf("NMID-%s-%d", time.Now().Format("20060102"), time.Now().UnixNano()%1000000)
	certNo := fmt.Sprintf("MC-%s-%d", time.Now().Format("2006"), time.Now().UnixNano()%100000)

	policy := &models.PolicyRegistration{
		NMIDPolicyRef: nmidRef, InternalPolicyNo: req.InternalPolicyNo,
		RegistrationNo: req.RegistrationNo, InsuredName: vehicle.OwnerName,
		InsurerCode: req.InsurerCode, InsurerName: req.InsurerName,
		CoverType: req.CoverType, SumInsured: req.SumInsured,
		Premium: premium, InceptionDate: req.InceptionDate, ExpiryDate: req.ExpiryDate,
		CertificateNo: certNo, Status: "active", SyncStatus: "pending",
	}
	if err := s.repo.CreatePolicyRegistration(ctx, policy); err != nil {
		return nil, fmt.Errorf("failed to register policy: %w", err)
	}

	s.createRenewalTracking(ctx, policy)
	return policy, nil
}

func (s *NMIDService) CancelPolicy(ctx context.Context, policyID uuid.UUID, reason string) error {
	policy, err := s.repo.GetPolicyRegistration(ctx, policyID)
	if err != nil {
		return fmt.Errorf("policy not found")
	}
	if policy.Status != "active" {
		return fmt.Errorf("policy is not active")
	}
	now := time.Now()
	policy.Status = "cancelled"
	policy.CancelledAt = &now
	policy.CancellationReason = reason
	return s.repo.UpdatePolicyRegistration(ctx, policy)
}

func (s *NMIDService) VerifyCertificate(ctx context.Context, certNo string, verifiedBy string) (*models.CertificateVerification, error) {
	policy, err := s.repo.GetPoliciesByCertificate(ctx, certNo)
	isValid := err == nil && policy.Status == "active" && policy.ExpiryDate.After(time.Now())

	verification := &models.CertificateVerification{
		CertificateNo:   certNo,
		VerifiedBy:      verifiedBy,
		IsValid:         isValid,
		VerificationRef: fmt.Sprintf("VRF-%d", time.Now().UnixNano()%1000000),
	}
	if policy != nil {
		verification.RegistrationNo = policy.RegistrationNo
		verification.PolicyStatus = policy.Status
		verification.InsurerName = policy.InsurerName
		verification.ExpiryDate = &policy.ExpiryDate
	}
	if err := s.repo.CreateVerification(ctx, verification); err != nil {
		return nil, fmt.Errorf("failed to create verification: %w", err)
	}
	return verification, nil
}

func (s *NMIDService) GetVehiclePolicies(ctx context.Context, regNo string) ([]models.PolicyRegistration, error) {
	return s.repo.GetPoliciesByVehicle(ctx, regNo)
}

func (s *NMIDService) GetClaimHistory(ctx context.Context, regNo string) ([]models.ClaimHistoryRecord, error) {
	return s.repo.GetClaimHistory(ctx, regNo)
}

func (s *NMIDService) RecordClaim(ctx context.Context, req RecordClaimRequest) (*models.ClaimHistoryRecord, error) {
	claim := &models.ClaimHistoryRecord{
		RegistrationNo: req.RegistrationNo,
		ClaimRef:       fmt.Sprintf("CLM-%d", time.Now().UnixNano()%1000000),
		PolicyRef:      req.PolicyRef, ClaimType: req.ClaimType,
		ClaimAmount: req.ClaimAmount, AccidentDate: req.AccidentDate,
		ReportDate: time.Now(), Status: "reported",
		Description: req.Description, Location: req.Location,
		PoliceReportRef: req.PoliceReportRef,
	}
	if err := s.repo.CreateClaimHistory(ctx, claim); err != nil {
		return nil, fmt.Errorf("failed to record claim: %w", err)
	}
	return claim, nil
}

func (s *NMIDService) InitiateBatchRegistration(ctx context.Context, insurerCode string, totalRecords int, fileURL string) (*models.BatchRegistration, error) {
	batch := &models.BatchRegistration{
		BatchRef:     fmt.Sprintf("BATCH-%s-%d", time.Now().Format("20060102"), time.Now().UnixNano()%10000),
		InsurerCode:  insurerCode,
		TotalRecords: totalRecords,
		FileURL:      fileURL,
		Status:       "processing",
	}
	if err := s.repo.CreateBatch(ctx, batch); err != nil {
		return nil, fmt.Errorf("failed to create batch: %w", err)
	}
	return batch, nil
}

func (s *NMIDService) GetBatchStatus(ctx context.Context, batchRef string) (*models.BatchRegistration, error) {
	return s.repo.GetBatch(ctx, batchRef)
}

func (s *NMIDService) ProcessExpiringPolicies(ctx context.Context) ([]models.RenewalTracking, error) {
	thirtyDaysFromNow := time.Now().AddDate(0, 0, 30)
	expiring, err := s.repo.GetExpiringPolicies(ctx, thirtyDaysFromNow)
	if err != nil {
		return nil, fmt.Errorf("failed to get expiring policies: %w", err)
	}
	var renewals []models.RenewalTracking
	for _, p := range expiring {
		now := time.Now()
		rt := &models.RenewalTracking{
			PolicyRegID:    p.ID,
			RegistrationNo: p.RegistrationNo,
			ExpiryDate:     p.ExpiryDate,
			ReminderSentAt: &now,
			Status:         "reminded",
		}
		if err := s.repo.CreateRenewalTracking(ctx, rt); err == nil {
			renewals = append(renewals, *rt)
		}
	}
	return renewals, nil
}

func (s *NMIDService) GetVehicle(ctx context.Context, regNo string) (*models.VehicleRecord, error) {
	return s.repo.GetVehicle(ctx, regNo)
}

func (s *NMIDService) GetPendingRenewals(ctx context.Context) ([]models.RenewalTracking, error) {
	return s.repo.GetPendingRenewals(ctx)
}

func (s *NMIDService) createRenewalTracking(ctx context.Context, policy *models.PolicyRegistration) {
	rt := &models.RenewalTracking{
		PolicyRegID:    policy.ID,
		RegistrationNo: policy.RegistrationNo,
		ExpiryDate:     policy.ExpiryDate,
		Status:         "pending",
	}
	_ = s.repo.CreateRenewalTracking(ctx, rt)
}

func calculateMotorPremium(coverType string, sumInsured float64, vehicleType string, year int) float64 {
	baseRate := 0.0
	switch coverType {
	case "comprehensive":
		baseRate = 0.05 // 5% of sum insured
	case "third_party_fire_theft":
		baseRate = 0.03
	case "third_party":
		return 15000.0 // NAICOM minimum third party rate
	}
	premium := sumInsured * baseRate

	vehicleFactor := 1.0
	switch vehicleType {
	case "commercial":
		vehicleFactor = 1.5
	case "truck":
		vehicleFactor = 2.0
	case "motorcycle":
		vehicleFactor = 0.6
	case "bus":
		vehicleFactor = 1.8
	}
	premium *= vehicleFactor

	age := time.Now().Year() - year
	if age > 10 {
		premium *= 1.3
	} else if age > 5 {
		premium *= 1.15
	}

	if premium < 5000 {
		premium = 5000
	}
	return premium
}

func isValidNigerianPlate(regNo string) bool {
	return len(regNo) >= 6
}
