package models

import (
	"time"
)

// FraudScore represents the result of scoring a single transaction.
type FraudScore struct {
	TransactionID string  `json:"transaction_id"`
	Score         float64 `json:"score"`
	Decision      string  `json:"decision"`
	Rules         []Rule  `json:"rules_triggered"`
	AccountID     string  `json:"account_id,omitempty"`
	Amount        float64 `json:"amount,omitempty"`
	Details       string  `json:"details,omitempty"`
}

// Rule defines a single fraud detection rule that may be triggered.
type Rule struct {
	Name      string  `json:"name"`
	Threshold *string `json:"threshold,omitempty"`
	Impact    float64 `json:"impact"`
	Detail    string  `json:"detail"`
}

// FraudCase represents a case opened for manual investigation.
type FraudCase struct {
	CaseID        string    `json:"case_id"`
	TransactionID string    `json:"transaction_id"`
	AccountID     string    `json:"account_id"`
	Score         float64   `json:"score"`
	Decision      string    `json:"decision"`
	Status        string    `json:"status"`
	Evidence      string    `json:"evidence"`
	AssignedTo    string    `json:"assigned_to,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// FraudStats holds real-time fraud detection metrics.
type FraudStats struct {
	TransactionsScored24H int     `json:"transactions_scored_24h"`
	Blocked               int     `json:"blocked"`
	Reviewed              int     `json:"reviewed"`
	Allowed               int     `json:"allowed"`
	FalsePositiveRate     float64 `json:"false_positive_rate"`
	AvgScore              float64 `json:"avg_score"`
	STRFiled              int     `json:"str_filed"`
}

// TransactionInput is the payload accepted by the scoring endpoint.
type TransactionInput struct {
	Amount    float64 `json:"amount"`
	AccountID string  `json:"account_id"`
	Merchant  string  `json:"merchant"`
	Location  string  `json:"location"`
	DeviceID  string  `json:"device_id"`
	HourOfDay *int    `json:"hour_of_day,omitempty"`
	Currency  string  `json:"currency"`
	IP        string  `json:"ip"`
}

// TransactionRecord is a persisted transaction history entry.
type TransactionRecord struct {
	ID             int64     `db:"id" json:"id"`
	TransactionID  string    `db:"transaction_id" json:"transaction_id"`
	AccountID      string    `db:"account_id" json:"account_id"`
	Amount         float64   `db:"amount" json:"amount"`
	Merchant       string    `db:"merchant" json:"merchant"`
	Location       string    `db:"location" json:"location"`
	DeviceID       string    `db:"device_id" json:"device_id"`
	HourOfDay      int       `db:"hour_of_day" json:"hour_of_day"`
	FraudScore     float64   `db:"fraud_score" json:"fraud_score"`
	Decision       string    `db:"decision" json:"decision"`
	RulesTriggered string    `db:"rules_triggered" json:"rules_triggered"`
	CreatedAt      time.Time `db:"created_at" json:"created_at"`
}

// APIResponse is the standard envelope for JSON API responses.
type APIResponse struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
}

// ErrorJSON is the standard envelope for error responses.
type ErrorJSON struct {
	Success bool   `json:"success"`
	Error   string `json:"error"`
}

// HealthResponse represents the /health endpoint output.
type HealthResponse struct {
	Status  string            `json:"status"`
	Service string            `json:"service"`
	Checks  map[string]string `json:"checks,omitempty"`
}

// ReadyResponse represents the /ready endpoint output.
type ReadyResponse struct {
	Status  string `json:"status"`
	Service string `json:"service"`
}

// RulesResponse represents the /api/v1/rules output.
type RulesResponse struct {
	Rules []RuleResponse `json:"rules"`
}

// RuleResponse is a simplified rule definition for the public API.
type RuleResponse struct {
	Name      string  `json:"name"`
	Threshold *string `json:"threshold,omitempty"`
	Impact    float64 `json:"impact"`
}

// StatsResponse wraps FraudStats for the /api/v1/stats endpoint.
type StatsResponse struct {
	FraudStats FraudStats `json:"stats"`
}

// BlockAccountRequest is the payload for /api/v1/accounts/{id}/block.
type BlockAccountRequest struct {
	Reason   string  `json:"reason"`
	Duration *string `json:"duration,omitempty"`
}

// BlockAccountResponse is the output of /api/v1/accounts/{id}/block.
type BlockAccountResponse struct {
	AccountID string `json:"account_id"`
	Blocked   bool   `json:"blocked"`
	Reason    string `json:"reason"`
}
