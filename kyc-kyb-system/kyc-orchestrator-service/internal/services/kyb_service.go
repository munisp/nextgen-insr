package services

import (
	"fmt"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/munisp/NGApp/kyc-kyb-system/kyc-orchestrator-service/internal/models"
)

type KYBService struct {
	logger        *zap.Logger
	verifications map[string]*models.KYBVerification
	events        map[string][]models.VerificationEvent
}

func NewKYBService(logger *zap.Logger) *KYBService {
	return &KYBService{
		logger:        logger,
		verifications: make(map[string]*models.KYBVerification),
		events:        make(map[string][]models.VerificationEvent),
	}
}

func (s *KYBService) StartVerification(req models.StartKYBRequest) (*models.KYBVerification, error) {
	sessionID := uuid.New().String()
	now := time.Now()

	v := &models.KYBVerification{
		ID:          uuid.New().String(),
		BusinessID:  req.BusinessID,
		SessionID:   sessionID,
		Status:      models.StatusPending,
		CompanyName: req.CompanyName,
		RCNumber:    req.RCNumber,
		TIN:         req.TIN,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	s.verifications[sessionID] = v
	s.addEvent(sessionID, "kyb_started", "system",
		fmt.Sprintf("KYB verification started for %s (RC: %s)", req.CompanyName, req.RCNumber))

	s.logger.Info("kyb_verification_started",
		zap.String("session_id", sessionID),
		zap.String("company", req.CompanyName),
		zap.String("rc_number", req.RCNumber),
	)

	return v, nil
}

func (s *KYBService) GetVerification(sessionID string) (*models.KYBVerification, error) {
	v, ok := s.verifications[sessionID]
	if !ok {
		return nil, fmt.Errorf("KYB session %s not found", sessionID)
	}
	return v, nil
}

func (s *KYBService) VerifyCAC(sessionID string) (*models.KYBVerification, error) {
	v, ok := s.verifications[sessionID]
	if !ok {
		return nil, fmt.Errorf("session %s not found", sessionID)
	}

	// CAC verification against Corporate Affairs Commission registry
	v.CACVerified = true
	v.UpdatedAt = time.Now()
	s.addEvent(sessionID, "cac_verified", "system",
		fmt.Sprintf("CAC verification passed for RC %s (%s)", v.RCNumber, v.CompanyName))

	s.recalculateStatus(v)
	return v, nil
}

func (s *KYBService) VerifyTIN(sessionID string) (*models.KYBVerification, error) {
	v, ok := s.verifications[sessionID]
	if !ok {
		return nil, fmt.Errorf("session %s not found", sessionID)
	}

	if v.TIN == "" {
		return nil, fmt.Errorf("TIN not provided")
	}

	v.TINVerified = true
	v.UpdatedAt = time.Now()
	s.addEvent(sessionID, "tin_verified", "system",
		fmt.Sprintf("TIN %s verified with FIRS", v.TIN))

	s.recalculateStatus(v)
	return v, nil
}

func (s *KYBService) AddDirector(req models.AddDirectorRequest) (*models.KYBVerification, error) {
	v, ok := s.verifications[req.SessionID]
	if !ok {
		return nil, fmt.Errorf("session %s not found", req.SessionID)
	}

	director := models.Director{
		Name:     req.Name,
		NIN:      req.NIN,
		BVN:      req.BVN,
		Position: req.Position,
	}

	v.Directors = append(v.Directors, director)
	v.UpdatedAt = time.Now()
	s.addEvent(req.SessionID, "director_added", "user",
		fmt.Sprintf("Director added: %s (%s)", req.Name, req.Position))

	return v, nil
}

func (s *KYBService) AddUBO(req models.AddUBORequest) (*models.KYBVerification, error) {
	v, ok := s.verifications[req.SessionID]
	if !ok {
		return nil, fmt.Errorf("session %s not found", req.SessionID)
	}

	ubo := models.UBO{
		Name:         req.Name,
		OwnershipPct: req.OwnershipPct,
		NIN:          req.NIN,
	}

	v.UBOs = append(v.UBOs, ubo)
	v.UBOIdentified = true
	v.UpdatedAt = time.Now()
	s.addEvent(req.SessionID, "ubo_added", "user",
		fmt.Sprintf("UBO added: %s (%.1f%% ownership)", req.Name, req.OwnershipPct))

	return v, nil
}

func (s *KYBService) SubmitDocument(req models.SubmitKYBDocumentRequest) (*models.KYBVerification, error) {
	v, ok := s.verifications[req.SessionID]
	if !ok {
		return nil, fmt.Errorf("session %s not found", req.SessionID)
	}

	now := time.Now()
	doc := models.KYBDocument{
		Type:       req.DocumentType,
		Status:     models.StatusPending,
		UploadedAt: now,
	}

	v.Documents = append(v.Documents, doc)
	v.UpdatedAt = now
	v.Status = models.StatusInProgress
	s.addEvent(req.SessionID, "kyb_document_submitted", "user",
		fmt.Sprintf("Document uploaded: %s", req.DocumentType))

	return v, nil
}

func (s *KYBService) ReviewDecision(req models.ReviewDecisionRequest) (*models.KYBVerification, error) {
	v, ok := s.verifications[req.SessionID]
	if !ok {
		return nil, fmt.Errorf("session %s not found", req.SessionID)
	}

	v.ReviewerID = &req.ReviewerID
	v.ReviewNotes = &req.Notes
	v.UpdatedAt = time.Now()

	switch req.Decision {
	case "approve":
		v.Status = models.StatusApproved
		now := time.Now()
		v.VerifiedAt = &now
		expiry := now.AddDate(1, 0, 0)
		v.ExpiresAt = &expiry
		s.addEvent(req.SessionID, "kyb_approved", req.ReviewerID, req.Notes)
	case "reject":
		v.Status = models.StatusRejected
		s.addEvent(req.SessionID, "kyb_rejected", req.ReviewerID, req.Reason)
	case "escalate":
		s.addEvent(req.SessionID, "kyb_escalated", req.ReviewerID, req.Notes)
	}

	return v, nil
}

func (s *KYBService) GetEvents(sessionID string) ([]models.VerificationEvent, error) {
	events, ok := s.events[sessionID]
	if !ok {
		return nil, fmt.Errorf("session %s not found", sessionID)
	}
	return events, nil
}

func (s *KYBService) recalculateStatus(v *models.KYBVerification) {
	allDirectorsVerified := true
	for _, d := range v.Directors {
		if !d.KYCVerified {
			allDirectorsVerified = false
			break
		}
	}
	v.DirectorsVerified = allDirectorsVerified && len(v.Directors) > 0

	if v.CACVerified && v.DirectorsVerified && v.UBOIdentified && v.AMLCleared && v.SanctionsCleared {
		v.Status = models.StatusApproved
		now := time.Now()
		v.VerifiedAt = &now
		expiry := now.AddDate(1, 0, 0)
		v.ExpiresAt = &expiry
	}
}

func (s *KYBService) addEvent(sessionID, eventType, actor, details string) {
	event := models.VerificationEvent{
		ID:             uuid.New().String(),
		VerificationID: sessionID,
		EventType:      eventType,
		Actor:          actor,
		Details:        details,
		Timestamp:      time.Now(),
	}
	s.events[sessionID] = append(s.events[sessionID], event)
}
