package models

import "time"

// Bank represents a Nigerian bank supported by the integration
type Bank struct {
	Code       string    `json:"code"`
	Name       string    `json:"name"`
	NIPEnabled bool      `json:"nip_enabled"`
	NUBAN      string    `json:"nuban_format"`
	BranchCount int      `json:"branch_count"`
	Status     string    `json:"status"`
}

// AccountStatus represents the result of NUBAN validation
type AccountStatus string

const (
	AccountActive    AccountStatus = "active"
	AccountInactive  AccountStatus = "inactive"
	AccountClosed    AccountStatus = "closed"
	AccountFrozen    AccountStatus = "frozen"
	AccountSuspended AccountStatus = "suspended"
	AccountNotFound  AccountStatus = "not_found"
)

// AccountVerification represents a bank account verification result
type AccountVerification struct {
	ID            string        `json:"id"`
	AccountNumber string        `json:"account_number"`
	BankCode      string        `json:"bank_code"`
	BankName      string        `json:"bank_name"`
	AccountName   string        `json:"account_name"`
	Status        AccountStatus `json:"status"`
	AccountType   string        `json:"account_type"`
	Branch        string        `json:"branch"`
	VerifiedAt    time.Time     `json:"verified_at"`
	ExpiryAt      time.Time     `json:"expiry_at"`
}

// TransferStatus represents the status of a transfer
type TransferStatus string

const (
	TransferPending    TransferStatus = "pending"
	TransferProcessing TransferStatus = "processing"
	TransferSuccess    TransferStatus = "success"
	TransferFailed     TransferStatus = "failed"
	TransferReversed   TransferStatus = "reversed"
	TransferQueued     TransferStatus = "queued"
	TransferTimedOut   TransferStatus = "timed_out"
)

// TransferChannel represents the transfer channel
type TransferChannel string

const (
	TransferNIP    TransferChannel = "NIP"
	TransferNIPBulk TransferChannel = "NIP_BULK"
	TransferNIPDDA TransferChannel = "NIP_DDA"
	TransferNIPDDAI TransferChannel = "NIP_DDAI"
)

// Transfer represents a NIP transfer transaction
type Transfer struct {
	ID                string          `json:"id"`
	Reference         string          `json:"reference"`
	SourceAccount     string          `json:"source_account"`
	SourceBankCode    string          `json:"source_bank_code"`
	DestinationAccount string         `json:"destination_account"`
	DestinationBankCode string         `json:"destination_bank_code"`
	DestinationBank   string          `json:"destination_bank"`
	DestinationName   string          `json:"destination_name"`
	Amount            float64         `json:"amount"`
	Currency          string          `json:"currency"`
	Fee               float64         `json:"fee"`
	Description       string          `json:"description"`
	Channel           TransferChannel `json:"channel"`
	Status            TransferStatus  `json:"status"`
	ApprovedBy        string          `json:"approved_by,omitempty"`
	TxnDate           time.Time       `json:"txn_date"`
	SettlementDate    *time.Time      `json:"settlement_date,omitempty"`
	FailedReason      string          `json:"failed_reason,omitempty"`
	CallbackURL       string          `json:"callback_url,omitempty"`
	Metadata          map[string]any  `json:"metadata,omitempty"`
	CreatedAt         time.Time       `json:"created_at"`
	UpdatedAt         time.Time       `json:"updated_at"`
}

// SettlementReport represents end-of-day settlement data
type SettlementReport struct {
	ID              string          `json:"id"`
	Date            time.Time       `json:"date"`
	TotalTxnCount   int64           `json:"total_txn_count"`
	TotalTxnValue   float64         `json:"total_txn_value"`
	SuccessCount    int64           `json:"success_count"`
	FailedCount     int64           `json:"failed_count"`
	TotalFees       float64         `json:"total_fees"`
	NetAmount       float64         `json:"net_amount"`
	ChannelBreakdown []ChannelStats `json:"channel_breakdown"`
	Status          string          `json:"status"`
	CreatedAt       time.Time       `json:"created_at"`
}

// ChannelStats breaks down transfer stats by channel
type ChannelStats struct {
	Channel    string `json:"channel"`
	TxnCount   int64  `json:"txn_count"`
	TxnValue   float64 `json:"txn_value"`
	SuccessCount int64 `json:"success_count"`
	FailedCount  int64   `json:"failed_count"`
	TotalFees  float64 `json:"total_fees"`
}

// CallbackEvent represents a webhook/callback event from a bank
type CallbackEvent struct {
	ID          string    `json:"id"`
	EventType   string    `json:"event_type"`
	Reference   string    `json:"reference"`
	TxnID       string    `json:"txn_id"`
	Amount      float64   `json:"amount"`
	Status      string    `json:"status"`
	BankCode    string    `json:"bank_code"`
	BankRef     string    `json:"bank_reference"`
	Timestamp   time.Time `json:"timestamp"`
	Payload     []byte    `json:"payload,omitempty"`
	Processed   bool      `json:"processed"`
	ProcessedAt *time.Time `json:"processed_at,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}

// WebhookSubscription represents a webhook endpoint subscription
type WebhookSubscription struct {
	ID            string    `json:"id"`
	EndpointURL   string    `json:"endpoint_url"`
	Events        []string  `json:"events"`
	Secret        string    `json:"secret"`
	Active        bool      `json:"active"`
	Retries       int       `json:"retries"`
	LastTriggered *time.Time `json:"last_triggered,omitempty"`
	LastError     string    `json:"last_error,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
}

// BankVerificationRequest is the request payload for NUBAN validation
type BankVerificationRequest struct {
	AccountNumber string `json:"account_number"`
	BankCode      string `json:"bank_code"`
}

// BankVerificationResponse is the response payload for NUBAN validation
type BankVerificationResponse struct {
	Success       bool   `json:"success"`
	AccountNumber string `json:"account_number"`
	BankCode      string `json:"bank_code"`
	BankName      string `json:"bank_name"`
	AccountName   string `json:"account_name"`
	AccountStatus string `json:"account_status"`
	AccountType   string `json:"account_type"`
	Message       string `json:"message"`
}

// TransferRequest is the request payload for NIP transfer
type TransferRequest struct {
	SourceAccount      string          `json:"source_account"`
	SourceBankCode     string          `json:"source_bank_code"`
	DestinationAccount string          `json:"destination_account"`
	DestinationBankCode string         `json:"destination_bank_code"`
	Amount             float64         `json:"amount"`
	Currency           string          `json:"currency"`
	Description        string          `json:"description"`
	Reference          string          `json:"reference"`
	Channel            TransferChannel `json:"channel"`
}

// TransferResponse is the response payload for NIP transfer
type TransferResponse struct {
	Success            bool              `json:"success"`
	Reference          string            `json:"reference"`
	Status             TransferStatus    `json:"status"`
	DestinationBank    string            `json:"destination_bank"`
	DestinationName    string            `json:"destination_name"`
	Amount             float64           `json:"amount"`
	Fee                float64           `json:"fee"`
	Settlement         string            `json:"settlement"`
	Timestamp          time.Time         `json:"timestamp"`
	Message            string            `json:"message"`
}

// ReconciliationRecord holds daily reconciliation data
type ReconciliationRecord struct {
	ID              string    `json:"id"`
	Date            time.Time `json:"date"`
	SystemTotal     float64   `json:"system_total"`
	SystemCount     int64     `json:"system_count"`
	BankTotal       float64   `json:"bank_total"`
	BankCount       int64     `json:"bank_count"`
	Difference      float64   `json:"difference"`
	Status          string    `json:"status"`
	CreatedAt       time.Time `json:"created_at"`
}
