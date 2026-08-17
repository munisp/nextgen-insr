package service

import (
	"context"
	"fmt"
	"time"

	"github.com/munisp/NGApp/gdpr-compliance/internal/models"
	"github.com/munisp/NGApp/gdpr-compliance/internal/repository"
)

type GDPRService struct{ repo *repository.GDPRRepository }

func NewGDPRService(repo *repository.GDPRRepository) *GDPRService { return &GDPRService{repo: repo} }

func (s *GDPRService) RegisterSubject(ctx context.Context, req RegisterSubjectRequest) (*models.DataSubject, error) {
	ds := &models.DataSubject{
		SubjectRef: req.SubjectRef, SubjectType: req.SubjectType,
		FirstName: req.FirstName, LastName: req.LastName,
		Email: req.Email, Phone: req.Phone, Country: req.Country,
		ConsentStatus: "pending", DataCategories: req.DataCategories,
	}
	if err := s.repo.CreateSubject(ctx, ds); err != nil {
		return nil, fmt.Errorf("failed to register subject: %w", err)
	}
	return ds, nil
}

func (s *GDPRService) RecordConsent(ctx context.Context, req ConsentRequest) (*models.ConsentRecord, error) {
	now := time.Now()
	cr := &models.ConsentRecord{
		SubjectRef: req.SubjectRef, Purpose: req.Purpose, LegalBasis: req.LegalBasis,
		Granted: req.Granted, IPAddress: req.IPAddress, Channel: req.Channel, Version: req.Version,
	}
	if req.Granted {
		cr.GrantedAt = &now
	} else {
		cr.WithdrawnAt = &now
	}
	if req.ExpiryDays > 0 {
		exp := now.AddDate(0, 0, req.ExpiryDays)
		cr.ExpiresAt = &exp
	}
	if err := s.repo.CreateConsent(ctx, cr); err != nil {
		return nil, fmt.Errorf("failed to record consent: %w", err)
	}
	subject, _ := s.repo.GetSubject(ctx, req.SubjectRef)
	if subject != nil {
		if req.Granted {
			subject.ConsentStatus = "granted"
		} else {
			subject.ConsentStatus = "withdrawn"
		}
		_ = s.repo.UpdateSubject(ctx, subject)
	}
	return cr, nil
}

func (s *GDPRService) SubmitAccessRequest(ctx context.Context, req AccessRequestInput) (*models.DataAccessRequest, error) {
	dar := &models.DataAccessRequest{
		RequestRef: fmt.Sprintf("DAR-%d", time.Now().UnixNano()%1000000),
		SubjectRef: req.SubjectRef, RequestType: req.RequestType,
		Reason: req.Reason, Status: "received",
		DueDate: time.Now().AddDate(0, 0, 30),
	}
	if req.RequestType == "erasure" {
		dar.DueDate = time.Now().AddDate(0, 0, 30)
	}
	if err := s.repo.CreateAccessRequest(ctx, dar); err != nil {
		return nil, fmt.Errorf("failed to submit request: %w", err)
	}
	return dar, nil
}

func (s *GDPRService) ProcessAccessRequest(ctx context.Context, requestRef string, response map[string]interface{}) error {
	dar, err := s.repo.GetAccessRequest(ctx, requestRef)
	if err != nil {
		return fmt.Errorf("request not found")
	}
	now := time.Now()
	dar.Status = "completed"
	dar.CompletedAt = &now
	dar.Response = response
	return s.repo.UpdateAccessRequest(ctx, dar)
}

func (s *GDPRService) RejectAccessRequest(ctx context.Context, requestRef, reason string) error {
	dar, err := s.repo.GetAccessRequest(ctx, requestRef)
	if err != nil {
		return fmt.Errorf("request not found")
	}
	dar.Status = "rejected"
	dar.Response = map[string]interface{}{"rejection_reason": reason}
	return s.repo.UpdateAccessRequest(ctx, dar)
}

func (s *GDPRService) RegisterProcessingActivity(ctx context.Context, req ProcessingActivityRequest) (*models.DataProcessingRecord, error) {
	dpr := &models.DataProcessingRecord{
		ProcessingName: req.ProcessingName, Purpose: req.Purpose,
		LegalBasis: req.LegalBasis, DataCategories: req.DataCategories,
		SubjectCategories: req.SubjectCategories, Recipients: req.Recipients,
		ThirdCountries: req.ThirdCountries, RetentionPeriod: req.RetentionPeriod,
		TechnicalMeasures: req.TechnicalMeasures, DPIARequired: req.DPIARequired,
	}
	if err := s.repo.CreateProcessingRecord(ctx, dpr); err != nil {
		return nil, fmt.Errorf("failed to register processing: %w", err)
	}
	return dpr, nil
}

func (s *GDPRService) ReportBreach(ctx context.Context, req BreachReportRequest) (*models.DataBreach, error) {
	breach := &models.DataBreach{
		BreachRef:   fmt.Sprintf("BRH-%d", time.Now().UnixNano()%1000000),
		Description: req.Description, Severity: req.Severity,
		DataCategories: req.DataCategories, AffectedCount: req.AffectedCount,
		DetectedAt: req.DetectedAt, Measures: req.Measures, Status: "detected",
	}
	if req.Severity == "high" || req.Severity == "critical" || req.AffectedCount > 1000 {
		breach.NotifiedDPA = false
	}
	if err := s.repo.CreateBreach(ctx, breach); err != nil {
		return nil, fmt.Errorf("failed to report breach: %w", err)
	}
	return breach, nil
}

func (s *GDPRService) GetConsents(ctx context.Context, subjectRef string) ([]models.ConsentRecord, error) {
	return s.repo.GetConsents(ctx, subjectRef)
}

func (s *GDPRService) GetAccessRequests(ctx context.Context, status string) ([]models.DataAccessRequest, error) {
	return s.repo.ListAccessRequests(ctx, status)
}

func (s *GDPRService) GetProcessingRecords(ctx context.Context) ([]models.DataProcessingRecord, error) {
	return s.repo.ListProcessingRecords(ctx)
}

func (s *GDPRService) GetBreaches(ctx context.Context) ([]models.DataBreach, error) {
	return s.repo.ListBreaches(ctx)
}

func (s *GDPRService) GetOverdueRequests(ctx context.Context) ([]models.DataAccessRequest, error) {
	return s.repo.GetOverdueRequests(ctx)
}
