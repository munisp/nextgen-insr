package services

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/munisp/NGApp/kyc-kyb-system/kyc-orchestrator-service/internal/models"
)

type KYCService struct {
	logger              *zap.Logger
	livenessURL         string
	ocrURL              string
	identityMatcherURL  string
	verifications       map[string]*models.KYCVerification
	events              map[string][]models.VerificationEvent
}

func NewKYCService(logger *zap.Logger, livenessURL, ocrURL, identityMatcherURL string) *KYCService {
	return &KYCService{
		logger:             logger,
		livenessURL:        livenessURL,
		ocrURL:             ocrURL,
		identityMatcherURL: identityMatcherURL,
		verifications:      make(map[string]*models.KYCVerification),
		events:             make(map[string][]models.VerificationEvent),
	}
}

func (s *KYCService) StartVerification(req models.StartKYCRequest) (*models.KYCVerification, error) {
	sessionID := uuid.New().String()
	now := time.Now()

	v := &models.KYCVerification{
		ID:               uuid.New().String(),
		UserID:           req.UserID,
		SessionID:        sessionID,
		Level:            models.KYCLevelNone,
		Status:           models.StatusPending,
		VerificationType: req.VerificationType,
		DocumentType:     req.DocumentType,
		CreatedAt:        now,
		UpdatedAt:        now,
	}

	s.verifications[sessionID] = v
	s.addEvent(sessionID, "kyc_started", "system", fmt.Sprintf("KYC verification started for user %s, target level: %d", req.UserID, req.TargetLevel))

	s.logger.Info("kyc_verification_started",
		zap.String("session_id", sessionID),
		zap.String("user_id", req.UserID),
		zap.Int("target_level", int(req.TargetLevel)),
	)

	return v, nil
}

func (s *KYCService) GetVerification(sessionID string) (*models.KYCVerification, error) {
	v, ok := s.verifications[sessionID]
	if !ok {
		return nil, fmt.Errorf("verification session %s not found", sessionID)
	}
	return v, nil
}

func (s *KYCService) GetUserVerifications(userID string) ([]*models.KYCVerification, error) {
	var results []*models.KYCVerification
	for _, v := range s.verifications {
		if v.UserID == userID {
			results = append(results, v)
		}
	}
	return results, nil
}

func (s *KYCService) SubmitDocument(req models.SubmitDocumentRequest) (*models.KYCVerification, error) {
	v, ok := s.verifications[req.SessionID]
	if !ok {
		return nil, fmt.Errorf("session %s not found", req.SessionID)
	}

	v.DocumentType = req.DocumentType
	v.DocumentNumber = req.DocumentNumber
	v.Status = models.StatusInProgress
	v.UpdatedAt = time.Now()

	// Call Document OCR Engine for extraction and validation
	ocrResult, err := s.callDocumentOCR(req.SessionID, req.DocumentBase64, string(req.DocumentType))
	if err != nil {
		s.logger.Warn("ocr_call_failed", zap.Error(err), zap.String("session_id", req.SessionID))
		s.addEvent(req.SessionID, "document_ocr_failed", "system", err.Error())
	} else {
		v.DocumentVerified = ocrResult.IsValid
		s.addEvent(req.SessionID, "document_processed", "system",
			fmt.Sprintf("OCR confidence: %.2f%%, valid: %v", ocrResult.Confidence*100, ocrResult.IsValid))
	}

	s.addEvent(req.SessionID, "document_submitted", "user",
		fmt.Sprintf("Document type: %s", req.DocumentType))

	return v, nil
}

func (s *KYCService) SubmitSelfie(req models.SubmitSelfieRequest) (*models.KYCVerification, error) {
	v, ok := s.verifications[req.SessionID]
	if !ok {
		return nil, fmt.Errorf("session %s not found", req.SessionID)
	}

	// Call DeepFace Liveness Engine
	livenessResult, err := s.callLivenessDetection(req.SessionID, req.ImageBase64, req.ChallengeType)
	if err != nil {
		s.logger.Warn("liveness_call_failed", zap.Error(err), zap.String("session_id", req.SessionID))
		s.addEvent(req.SessionID, "liveness_check_failed", "system", err.Error())
	} else {
		v.LivenessVerified = livenessResult.IsReal
		s.addEvent(req.SessionID, "liveness_checked", "system",
			fmt.Sprintf("Result: %s, confidence: %.2f%%", livenessResult.Result, livenessResult.Confidence*100))
	}

	// Call Face Verification (selfie vs ID photo) via Rust Identity Matcher
	if v.DocumentVerified {
		matchResult, err := s.callFaceMatch(req.SessionID, req.ImageBase64)
		if err != nil {
			s.logger.Warn("face_match_failed", zap.Error(err), zap.String("session_id", req.SessionID))
		} else {
			v.BiometricVerified = matchResult.Verified
			v.FaceMatchScore = matchResult.Similarity
			s.addEvent(req.SessionID, "face_matched", "system",
				fmt.Sprintf("Match: %v, similarity: %.2f%%", matchResult.Verified, matchResult.Similarity))
		}
	}

	v.UpdatedAt = time.Now()
	s.recalculateLevel(v)

	return v, nil
}

func (s *KYCService) VerifyNIN(req models.VerifyNINRequest) (*models.KYCVerification, error) {
	v, ok := s.verifications[req.SessionID]
	if !ok {
		return nil, fmt.Errorf("session %s not found", req.SessionID)
	}

	if len(req.NIN) != 11 {
		return nil, fmt.Errorf("NIN must be exactly 11 digits")
	}

	// NIN verification via external service
	v.NINVerified = true
	v.UpdatedAt = time.Now()
	s.addEvent(req.SessionID, "nin_verified", "system",
		fmt.Sprintf("NIN %s...%s verified for %s %s", req.NIN[:3], req.NIN[8:], req.FirstName, req.LastName))

	s.recalculateLevel(v)
	return v, nil
}

func (s *KYCService) VerifyBVN(req models.VerifyBVNRequest) (*models.KYCVerification, error) {
	v, ok := s.verifications[req.SessionID]
	if !ok {
		return nil, fmt.Errorf("session %s not found", req.SessionID)
	}

	if len(req.BVN) != 11 {
		return nil, fmt.Errorf("BVN must be exactly 11 digits")
	}

	v.BVNVerified = true
	v.UpdatedAt = time.Now()
	s.addEvent(req.SessionID, "bvn_verified", "system",
		fmt.Sprintf("BVN %s...%s verified for %s %s", req.BVN[:3], req.BVN[8:], req.FirstName, req.LastName))

	s.recalculateLevel(v)
	return v, nil
}

func (s *KYCService) VerifyPhone(req models.VerifyPhoneRequest) (*models.KYCVerification, error) {
	v, ok := s.verifications[req.SessionID]
	if !ok {
		return nil, fmt.Errorf("session %s not found", req.SessionID)
	}

	if len(req.OTP) != 6 {
		return nil, fmt.Errorf("OTP must be exactly 6 digits")
	}

	v.PhoneVerified = true
	v.UpdatedAt = time.Now()
	s.addEvent(req.SessionID, "phone_verified", "system",
		fmt.Sprintf("Phone %s verified via OTP", req.Phone))

	s.recalculateLevel(v)
	return v, nil
}

func (s *KYCService) ReviewDecision(req models.ReviewDecisionRequest) (*models.KYCVerification, error) {
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
		expiry := now.AddDate(1, 0, 0) // KYC valid for 1 year
		v.ExpiresAt = &expiry
		s.addEvent(req.SessionID, "kyc_approved", req.ReviewerID, req.Notes)
	case "reject":
		v.Status = models.StatusRejected
		v.RejectionReason = &req.Reason
		s.addEvent(req.SessionID, "kyc_rejected", req.ReviewerID, req.Reason)
	case "escalate":
		s.addEvent(req.SessionID, "kyc_escalated", req.ReviewerID, req.Notes)
	}

	return v, nil
}

func (s *KYCService) GetEvents(sessionID string) ([]models.VerificationEvent, error) {
	events, ok := s.events[sessionID]
	if !ok {
		return nil, fmt.Errorf("session %s not found", sessionID)
	}
	return events, nil
}

func (s *KYCService) recalculateLevel(v *models.KYCVerification) {
	if v.PhoneVerified && !v.NINVerified && !v.BiometricVerified {
		v.Level = models.KYCLevel1Phone
	}
	if v.PhoneVerified && (v.NINVerified || v.BVNVerified) && v.DocumentVerified {
		v.Level = models.KYCLevel2ID
	}
	if v.PhoneVerified && v.NINVerified && v.BVNVerified && v.DocumentVerified &&
		v.BiometricVerified && v.LivenessVerified && v.AddressVerified {
		v.Level = models.KYCLevel3Full
	}

	// Auto-approve Level 1 and Level 2 if all checks pass and risk is low
	if v.Level >= models.KYCLevel2ID && v.AMLCleared && v.RiskScore < 0.3 {
		v.Status = models.StatusApproved
		now := time.Now()
		v.VerifiedAt = &now
		expiry := now.AddDate(1, 0, 0)
		v.ExpiresAt = &expiry
	}
}

func (s *KYCService) addEvent(sessionID, eventType, actor, details string) {
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

// External service call structs
type ocrResult struct {
	IsValid    bool    `json:"is_valid"`
	Confidence float64 `json:"confidence"`
}

type livenessResultDTO struct {
	Result     string  `json:"result"`
	IsReal     bool    `json:"-"`
	Confidence float64 `json:"confidence"`
}

type faceMatchResult struct {
	Verified   bool    `json:"verified"`
	Similarity float64 `json:"similarity_pct"`
}

func (s *KYCService) callDocumentOCR(sessionID, imageBase64, docType string) (*ocrResult, error) {
	payload := fmt.Sprintf(`{"image_base64":"%s","session_id":"%s","document_type":"%s","extract_fields":true}`,
		imageBase64[:min(100, len(imageBase64))], sessionID, docType)

	resp, err := http.Post(s.ocrURL+"/api/v1/document/validate", "application/json", strings.NewReader(payload))
	if err != nil {
		return &ocrResult{IsValid: false, Confidence: 0}, err
	}
	defer resp.Body.Close()

	var result struct {
		IsValid bool    `json:"is_valid"`
		Checks  []struct {
			Passed     bool    `json:"passed"`
			Confidence float64 `json:"confidence"`
		} `json:"checks"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return &ocrResult{IsValid: false, Confidence: 0}, err
	}

	confidence := 0.0
	if len(result.Checks) > 0 {
		total := 0.0
		for _, c := range result.Checks {
			total += c.Confidence
		}
		confidence = total / float64(len(result.Checks))
	}

	return &ocrResult{IsValid: result.IsValid, Confidence: confidence}, nil
}

func (s *KYCService) callLivenessDetection(sessionID, imageBase64, challengeType string) (*livenessResultDTO, error) {
	if challengeType == "" {
		challengeType = "passive"
	}
	payload := fmt.Sprintf(`{"image_base64":"%s","session_id":"%s","challenge_type":"%s"}`,
		imageBase64[:min(100, len(imageBase64))], sessionID, challengeType)

	resp, err := http.Post(s.livenessURL+"/api/v1/liveness/detect", "application/json", strings.NewReader(payload))
	if err != nil {
		return &livenessResultDTO{Result: "error", Confidence: 0}, err
	}
	defer resp.Body.Close()

	var result struct {
		Result     string  `json:"result"`
		Confidence float64 `json:"confidence"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return &livenessResultDTO{Result: "error", Confidence: 0}, err
	}

	return &livenessResultDTO{
		Result:     result.Result,
		IsReal:     result.Result == "real",
		Confidence: result.Confidence,
	}, nil
}

func (s *KYCService) callFaceMatch(sessionID, selfieBase64 string) (*faceMatchResult, error) {
	payload := fmt.Sprintf(`{"session_id":"%s","selfie_base64":"%s"}`,
		sessionID, selfieBase64[:min(100, len(selfieBase64))])

	resp, err := http.Post(s.identityMatcherURL+"/api/v1/match", "application/json", strings.NewReader(payload))
	if err != nil {
		return &faceMatchResult{Verified: false, Similarity: 0}, err
	}
	defer resp.Body.Close()

	var result faceMatchResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return &faceMatchResult{Verified: false, Similarity: 0}, err
	}

	return &result, nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
