package events

import (
	"encoding/json"
	"time"
)

// EventEnvelope is the standard wrapper for all platform events
type EventEnvelope struct {
	EventID     string          `json:"event_id"`
	EventType   string          `json:"event_type"`
	Source      string          `json:"source"`
	Timestamp   time.Time       `json:"timestamp"`
	Version     string          `json:"version"`
	Correlation string          `json:"correlation_id,omitempty"`
	Payload     json.RawMessage `json:"payload"`
}

// NewEvent creates a new event envelope
func NewEvent(eventType, source string, payload interface{}) (*EventEnvelope, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	return &EventEnvelope{
		EventID:   generateID(),
		EventType: eventType,
		Source:    source,
		Timestamp: time.Now().UTC(),
		Version:   "1.0",
		Payload:   data,
	}, nil
}

// === KYC Events ===

type LivenessCheckedEvent struct {
	CheckID         string  `json:"check_id"`
	CustomerID      string  `json:"customer_id"`
	LivenessType    string  `json:"liveness_type"`
	IsLive          bool    `json:"is_live"`
	ConfidenceScore float64 `json:"confidence_score"`
	SpoofingType    string  `json:"spoofing_type,omitempty"`
	DetectionMethod string  `json:"detection_method"`
}

type KYCCompletedEvent struct {
	ApplicationID string   `json:"application_id"`
	CustomerID    string   `json:"customer_id"`
	Status        string   `json:"status"`
	RiskScore     float64  `json:"risk_score"`
	RiskLevel     string   `json:"risk_level"`
	Verifications []string `json:"verifications_passed"`
}

type AMLScreeningEvent struct {
	ScreeningID string `json:"screening_id"`
	CustomerID  string `json:"customer_id"`
	Result      string `json:"result"`
	MatchCount  int    `json:"match_count"`
	RiskLevel   string `json:"risk_level"`
}

// === Policy Events ===

type PolicyCreatedEvent struct {
	PolicyID      string  `json:"policy_id"`
	CustomerID    string  `json:"customer_id"`
	ProductType   string  `json:"product_type"`
	Premium       float64 `json:"premium"`
	Currency      string  `json:"currency"`
	EffectiveDate string  `json:"effective_date"`
	ExpiryDate    string  `json:"expiry_date"`
}

type PolicyRenewedEvent struct {
	PolicyID    string  `json:"policy_id"`
	OldPolicyID string  `json:"old_policy_id"`
	CustomerID  string  `json:"customer_id"`
	NewPremium  float64 `json:"new_premium"`
	RenewalType string  `json:"renewal_type"`
}

type PolicyCancelledEvent struct {
	PolicyID     string  `json:"policy_id"`
	CustomerID   string  `json:"customer_id"`
	Reason       string  `json:"reason"`
	RefundAmount float64 `json:"refund_amount,omitempty"`
}

// === Claims Events ===

type ClaimSubmittedEvent struct {
	ClaimID     string  `json:"claim_id"`
	PolicyID    string  `json:"policy_id"`
	CustomerID  string  `json:"customer_id"`
	ClaimType   string  `json:"claim_type"`
	ClaimAmount float64 `json:"claim_amount"`
	Currency    string  `json:"currency"`
}

type ClaimAdjudicatedEvent struct {
	ClaimID        string  `json:"claim_id"`
	PolicyID       string  `json:"policy_id"`
	Decision       string  `json:"decision"`
	ApprovedAmount float64 `json:"approved_amount,omitempty"`
	Reason         string  `json:"reason,omitempty"`
}

// === Payment Events ===

type PaymentProcessedEvent struct {
	PaymentID  string  `json:"payment_id"`
	PolicyID   string  `json:"policy_id"`
	CustomerID string  `json:"customer_id"`
	Amount     float64 `json:"amount"`
	Currency   string  `json:"currency"`
	Method     string  `json:"method"`
	Status     string  `json:"status"`
	Reference  string  `json:"reference"`
}

// === Commission Events ===

type CommissionEarnedEvent struct {
	CommissionID string  `json:"commission_id"`
	AgentID      string  `json:"agent_id"`
	PolicyID     string  `json:"policy_id"`
	Amount       float64 `json:"amount"`
	Rate         float64 `json:"rate"`
	Tier         string  `json:"tier"`
}

// === Fraud Events ===

type FraudAlertEvent struct {
	AlertID    string   `json:"alert_id"`
	EntityType string   `json:"entity_type"`
	EntityID   string   `json:"entity_id"`
	FraudScore float64  `json:"fraud_score"`
	Indicators []string `json:"indicators"`
	Severity   string   `json:"severity"`
}

// === Compliance Events ===

type DataSubjectRequestEvent struct {
	RequestID   string `json:"request_id"`
	SubjectID   string `json:"subject_id"`
	RequestType string `json:"request_type"`
	Regulation  string `json:"regulation"`
	Status      string `json:"status"`
}

type AuditLogEvent struct {
	AuditID      string `json:"audit_id"`
	UserID       string `json:"user_id"`
	Action       string `json:"action"`
	ResourceType string `json:"resource_type"`
	ResourceID   string `json:"resource_id"`
	Changes      string `json:"changes,omitempty"`
	IPAddress    string `json:"ip_address,omitempty"`
}

// Topic constants for Kafka/Dapr pub-sub
const (
	TopicLivenessChecked    = "kyc.liveness.checked"
	TopicKYCCompleted       = "kyc.application.completed"
	TopicAMLScreening       = "kyc.aml.screened"
	TopicPolicyCreated      = "policy.created"
	TopicPolicyRenewed      = "policy.renewed"
	TopicPolicyCancelled    = "policy.cancelled"
	TopicClaimSubmitted     = "claims.submitted"
	TopicClaimAdjudicated   = "claims.adjudicated"
	TopicPaymentProcessed   = "payment.processed"
	TopicCommissionEarned   = "commission.earned"
	TopicFraudAlert         = "fraud.alert"
	TopicDataSubjectRequest = "compliance.dsr"
	TopicAuditLog           = "audit.log"
)

func generateID() string {
	// In production, use github.com/google/uuid
	return time.Now().Format("20060102150405.000000")
}
