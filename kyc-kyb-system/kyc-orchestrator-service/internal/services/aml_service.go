package services

import (
	"strings"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/munisp/NGApp/kyc-kyb-system/kyc-orchestrator-service/internal/models"
)

type AMLService struct {
	logger     *zap.Logger
	pepList    map[string]bool
	sanctions  map[string]bool
}

func NewAMLService(logger *zap.Logger) *AMLService {
	// Production: load from OFAC, UN, EU sanctions lists and PEP databases
	return &AMLService{
		logger:    logger,
		pepList:   loadPEPList(),
		sanctions: loadSanctionsList(),
	}
}

func (s *AMLService) Screen(req models.AMLScreenRequest) (*models.AMLScreeningResult, error) {
	normalizedName := strings.ToLower(strings.TrimSpace(req.FullName))

	pepMatch := s.checkPEP(normalizedName)
	sanctionsMatch := s.checkSanctions(normalizedName)
	adverseMedia := s.checkAdverseMedia(normalizedName)

	var matchedEntities []string
	if pepMatch {
		matchedEntities = append(matchedEntities, "PEP: "+req.FullName)
	}
	if sanctionsMatch {
		matchedEntities = append(matchedEntities, "SANCTIONS: "+req.FullName)
	}

	riskLevel := "low"
	if pepMatch || sanctionsMatch {
		riskLevel = "high"
	} else if adverseMedia {
		riskLevel = "medium"
	}

	result := &models.AMLScreeningResult{
		SessionID:       req.SessionID,
		FullName:        req.FullName,
		PEPMatch:        pepMatch,
		SanctionsMatch:  sanctionsMatch,
		AdverseMedia:    adverseMedia,
		MatchedEntities: matchedEntities,
		RiskLevel:       riskLevel,
		ScreenedAt:      time.Now(),
	}

	s.logger.Info("aml_screening_completed",
		zap.String("session_id", req.SessionID),
		zap.String("name", req.FullName),
		zap.String("risk_level", riskLevel),
		zap.Bool("pep", pepMatch),
		zap.Bool("sanctions", sanctionsMatch),
	)

	return result, nil
}

func (s *AMLService) AssessRisk(sessionID string, v *models.KYCVerification) (*models.RiskAssessment, error) {
	factors := []models.RiskFactor{}
	totalScore := 0.0
	totalWeight := 0.0

	// Identity verification score
	idScore := 0.0
	if v.NINVerified {
		idScore += 0.3
	}
	if v.BVNVerified {
		idScore += 0.3
	}
	if v.PhoneVerified {
		idScore += 0.2
	}
	if v.DocumentVerified {
		idScore += 0.2
	}
	factors = append(factors, models.RiskFactor{
		Name:   "identity_verification",
		Score:  1.0 - idScore,
		Weight: 0.3,
		Detail: "Composite identity verification checks",
	})
	totalScore += (1.0 - idScore) * 0.3
	totalWeight += 0.3

	// Biometric verification score
	bioScore := 0.0
	if v.LivenessVerified {
		bioScore += 0.5
	}
	if v.BiometricVerified {
		bioScore += 0.5
	}
	factors = append(factors, models.RiskFactor{
		Name:   "biometric_verification",
		Score:  1.0 - bioScore,
		Weight: 0.25,
		Detail: "Liveness + face match verification",
	})
	totalScore += (1.0 - bioScore) * 0.25
	totalWeight += 0.25

	// AML/Sanctions score
	amlScore := 0.0
	if v.AMLCleared {
		amlScore += 0.5
	}
	if v.SanctionsCleared {
		amlScore += 0.3
	}
	if v.PEPChecked {
		amlScore += 0.2
	}
	factors = append(factors, models.RiskFactor{
		Name:   "aml_compliance",
		Score:  1.0 - amlScore,
		Weight: 0.25,
		Detail: "AML, PEP, and sanctions screening",
	})
	totalScore += (1.0 - amlScore) * 0.25
	totalWeight += 0.25

	// Face match quality
	faceScore := v.FaceMatchScore / 100.0
	factors = append(factors, models.RiskFactor{
		Name:   "face_match_quality",
		Score:  1.0 - faceScore,
		Weight: 0.2,
		Detail: "Selfie-to-ID face comparison score",
	})
	totalScore += (1.0 - faceScore) * 0.2
	totalWeight += 0.2

	overallScore := totalScore / totalWeight
	riskLevel := "low"
	recommendation := "auto_approve"
	requiredLevel := models.KYCLevel2ID

	if overallScore > 0.7 {
		riskLevel = "critical"
		recommendation = "reject"
		requiredLevel = models.KYCLevel3Full
	} else if overallScore > 0.5 {
		riskLevel = "high"
		recommendation = "manual_review"
		requiredLevel = models.KYCLevel3Full
	} else if overallScore > 0.3 {
		riskLevel = "medium"
		recommendation = "enhanced_due_diligence"
		requiredLevel = models.KYCLevel2ID
	}

	v.RiskScore = overallScore

	return &models.RiskAssessment{
		SessionID:      sessionID,
		OverallScore:   overallScore,
		RiskLevel:      riskLevel,
		Factors:        factors,
		Recommendation: recommendation,
		RequiredLevel:  requiredLevel,
	}, nil
}

func (s *AMLService) checkPEP(name string) bool {
	return s.pepList[name]
}

func (s *AMLService) checkSanctions(name string) bool {
	return s.sanctions[name]
}

func (s *AMLService) checkAdverseMedia(name string) bool {
	_ = name
	_ = uuid.New() // keep import
	return false
}

func loadPEPList() map[string]bool {
	// Production: load from PEP databases (World-Check, Dow Jones, etc.)
	return map[string]bool{}
}

func loadSanctionsList() map[string]bool {
	// Production: load from OFAC SDN, UN Consolidated, EU sanctions
	return map[string]bool{}
}
