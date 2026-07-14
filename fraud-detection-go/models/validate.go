package models

import (
	"fmt"
	"time"
)

// Validate checks that the transaction input meets minimum requirements.
func (t TransactionInput) Validate() error {
	if t.AccountID == "" {
		return fmt.Errorf("account_id is required")
	}
	if t.Amount <= 0 {
		return fmt.Errorf("amount must be positive")
	}
	if t.Amount > 1e12 {
		return fmt.Errorf("amount exceeds maximum allowed value")
	}
	if t.Amount < 0 {
		return fmt.Errorf("amount cannot be negative")
	}
	return nil
}

// GenerateTransactionID creates a unique transaction ID from the current timestamp.
func (t TransactionInput) GenerateTransactionID() string {
	return "TXN-" + time.Now().Format("20060102150405") + "-" + t.AccountID
}
