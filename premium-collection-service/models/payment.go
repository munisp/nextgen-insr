package models

import "time"

// PaymentMethod represents supported Nigerian payment channels
type PaymentMethod string

const (
	PaymentMethodBankTransfer PaymentMethod = "bank_transfer"
	PaymentMethodCard         PaymentMethod = "card"
	PaymentMethodMobileMoney  PaymentMethod = "mobile_money"
	PaymentMethodAgentCash    PaymentMethod = "agent_cash"
	PaymentMethodUSSD         PaymentMethod = "ussd"
)

// PaymentStatus tracks where a payment is in its lifecycle
type PaymentStatus string

const (
	PaymentStatusPending    PaymentStatus = "pending"
	PaymentStatusProcessing PaymentStatus = "processing"
	PaymentStatusConfirmed  PaymentStatus = "confirmed"
	PaymentStatusSettled    PaymentStatus = "settled"
	PaymentStatusFailed     PaymentStatus = "failed"
	PaymentStatusRefunded   PaymentStatus = "refunded"
	PaymentStatusReconciled PaymentStatus = "reconciled"
	PaymentStatusDisputed   PaymentStatus = "disputed"
)

// Payment represents a premium collection record
type Payment struct {
	ID           string         `json:"id"`
	PolicyID     string         `json:"policy_id"`
	CustomerID   string         `json:"customer_id"`
	Amount       float64        `json:"amount"`
	Currency     string         `json:"currency"`
	Method       PaymentMethod  `json:"method"`
	Status       PaymentStatus  `json:"status"`
	Fee          float64        `json:"fee"`
	FeeRate      float64        `json:"fee_rate"`
	NetAmount    float64        `json:"net_amount"`
	ReceiptID    string         `json:"receipt_id"`
	ReferenceID  string         `json:"reference_id"`
	SettledAt    *time.Time     `json:"settled_at,omitempty"`
	FailedAt     *time.Time     `json:"failed_at,omitempty"`
	FailedReason string         `json:"failed_reason,omitempty"`
	Metadata     map[string]any `json:"metadata,omitempty"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
}

// InstallmentPlan represents an installment payment schedule
type InstallmentPlan struct {
	ID             string            `json:"id"`
	PolicyID       string            `json:"policy_id"`
	CustomerID     string            `json:"customer_id"`
	TotalAmount    float64           `json:"total_amount"`
	Remaining      float64           `json:"remaining"`
	Installments   int               `json:"installments"`
	InstallmentAmt float64           `json:"installment_amount"`
	Status         InstallmentStatus `json:"status"`
	Metadata       map[string]any    `json:"metadata,omitempty"`
	CreatedAt      time.Time         `json:"created_at"`
	UpdatedAt      time.Time         `json:"updated_at"`
}

// InstallmentScheduleEntry is a single payment installment
type InstallmentScheduleEntry struct {
	ID            string            `json:"id"`
	PlanID        string            `json:"plan_id"`
	InstallmentNo int               `json:"installment_number"`
	DueDate       time.Time         `json:"due_date"`
	Amount        float64           `json:"amount"`
	Status        InstallmentStatus `json:"status"`
	PaidAt        *time.Time        `json:"paid_at,omitempty"`
	PaymentID     *string           `json:"payment_id,omitempty"`
	CreatedAt     time.Time         `json:"created_at"`
	UpdatedAt     time.Time         `json:"updated_at"`
}

// InstallmentStatus represents the status of an installment
type InstallmentStatus string

const (
	InstallmentPending   InstallmentStatus = "pending"
	InstallmentDue       InstallmentStatus = "due"
	InstallmentPaid      InstallmentStatus = "paid"
	InstallmentOverdue   InstallmentStatus = "overdue"
	InstallmentWaived    InstallmentStatus = "waived"
	InstallmentDefaulted InstallmentStatus = "defaulted"
)

// PaymentReceipt is generated after a successful collection
type PaymentReceipt struct {
	ID           string    `json:"id"`
	PaymentID    string    `json:"payment_id"`
	PolicyID     string    `json:"policy_id"`
	CustomerName string    `json:"customer_name"`
	Amount       float64   `json:"amount"`
	Fee          float64   `json:"fee"`
	NetAmount    float64   `json:"net_amount"`
	Method       string    `json:"method"`
	ReferenceID  string    `json:"reference_id"`
	IssuedAt     time.Time `json:"issued_at"`
	ValidUntil   time.Time `json:"valid_until"`
}

// DunningRecord tracks failed payment attempts for reminder/dunning management
type DunningRecord struct {
	ID           string              `json:"id"`
	PolicyID     string              `json:"policy_id"`
	CustomerID   string              `json:"customer_id"`
	Amount       float64             `json:"amount"`
	Attempt      int                 `json:"attempt"`
	Status       DunningStatus       `json:"status"`
	ReminderType DunningReminderType `json:"reminder_type"`
	SentAt       *time.Time          `json:"sent_at,omitempty"`
	NextAttempt  time.Time           `json:"next_attempt"`
	Metadata     map[string]any      `json:"metadata,omitempty"`
	CreatedAt    time.Time           `json:"created_at"`
	UpdatedAt    time.Time           `json:"updated_at"`
}

// DunningStatus tracks dunning progress
type DunningStatus string

const (
	DunningPending   DunningStatus = "pending"
	DunningSent      DunningStatus = "sent"
	DunningSucceeded DunningStatus = "succeeded"
	DunningFailed    DunningStatus = "failed"
	DunningCancelled DunningStatus = "cancelled"
	DunningEscalated DunningStatus = "escalated"
)

// DunningReminderType specifies how the reminder was sent
type DunningReminderType string

const (
	DunningSMS      DunningReminderType = "sms"
	DunningEmail    DunningReminderType = "email"
	DunningWhatsApp DunningReminderType = "whatsapp"
	DunningCall     DunningReminderType = "call"
	DunningPush     DunningReminderType = "push"
)

// AutoDebitConfig holds auto-debit / standing order configuration
type AutoDebitConfig struct {
	ID            string          `json:"id"`
	PolicyID      string          `json:"policy_id"`
	CustomerID    string          `json:"customer_id"`
	BankName      string          `json:"bank_name"`
	AccountNumber string          `json:"account_number"`
	AccountName   string          `json:"account_name"`
	Status        AutoDebitStatus `json:"status"`
	NextDebitDate *time.Time      `json:"next_debit_date,omitempty"`
	Metadata      map[string]any  `json:"metadata,omitempty"`
	CreatedAt     time.Time       `json:"created_at"`
	UpdatedAt     time.Time       `json:"updated_at"`
}

// AutoDebitStatus represents the state of auto-debit
type AutoDebitStatus string

const (
	AutoDebitPending   AutoDebitStatus = "pending"
	AutoDebitActive    AutoDebitStatus = "active"
	AutoDebitSuspended AutoDebitStatus = "suspended"
	AutoDebitCancelled AutoDebitStatus = "cancelled"
	AutoDebitFailed    AutoDebitStatus = "failed"
)

// ReconciliationRecord is used for end-of-day reconciliation
type ReconciliationRecord struct {
	ID               string              `json:"id"`
	Date             time.Time           `json:"date"`
	TotalCollected   float64             `json:"total_collected"`
	TotalReconciled  float64             `json:"total_reconciled"`
	TotalPending     float64             `json:"total_pending"`
	TotalDiscrepancy float64             `json:"total_discrepancy"`
	DiscrepancyCount int                 `json:"discrepancy_count"`
	ChannelBreakdown []ChannelSettlement `json:"channel_breakdown"`
	Status           string              `json:"status"`
	CreatedAt        time.Time           `json:"created_at"`
}

// ChannelSettlement breaks down collected amounts by payment channel
type ChannelSettlement struct {
	Channel        string     `json:"channel"`
	Collected      float64    `json:"collected"`
	Settled        float64    `json:"settled"`
	Pending        float64    `json:"pending"`
	SettlementDate *time.Time `json:"settlement_date,omitempty"`
}
