package repository

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"insurance-platform/models"
)

// PaymentRepository handles database operations for payments.
type PaymentRepository struct {
	db *sql.DB
}

// NewPaymentRepository creates a new instance of PaymentRepository.
func NewPaymentRepository(db *sql.DB) *PaymentRepository {
	return &PaymentRepository{db: db}
}

// Create inserts a new payment record into the database.
func (r *PaymentRepository) Create(ctx context.Context, payment models.Payment) (int64, error) {
	query := `
		INSERT INTO payments (
			transaction_id, policy_id, customer_id, amount, currency,
			payment_type, payment_method, status, original_payment_id,
			refund_reason, processed_at, created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
		RETURNING id
	`

	var paymentID int64
	err := r.db.QueryRowContext(
		ctx,
		query,
		payment.TransactionID,
		payment.PolicyID,
		payment.CustomerID,
		payment.Amount,
		payment.Currency,
		payment.PaymentType,
		payment.PaymentMethod,
		payment.Status,
		payment.OriginalPaymentID,
		payment.RefundReason,
		payment.ProcessedAt,
		payment.CreatedAt,
		payment.UpdatedAt,
	).Scan(&paymentID)

	if err != nil {
		return 0, fmt.Errorf("failed to create payment: %w", err)
	}

	return paymentID, nil
}

// GetByID retrieves a payment by its ID.
func (r *PaymentRepository) GetByID(ctx context.Context, paymentID int64) (*models.Payment, error) {
	query := `
		SELECT id, transaction_id, policy_id, customer_id, amount, currency,
			   payment_type, payment_method, status, original_payment_id,
			   refund_reason, processed_at, created_at, updated_at
		FROM payments
		WHERE id = $1
	`

	var payment models.Payment
	err := r.db.QueryRowContext(ctx, query, paymentID).Scan(
		&payment.ID,
		&payment.TransactionID,
		&payment.PolicyID,
		&payment.CustomerID,
		&payment.Amount,
		&payment.Currency,
		&payment.PaymentType,
		&payment.PaymentMethod,
		&payment.Status,
		&payment.OriginalPaymentID,
		&payment.RefundReason,
		&payment.ProcessedAt,
		&payment.CreatedAt,
		&payment.UpdatedAt,
	)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("payment not found: %d", paymentID)
		}
		return nil, fmt.Errorf("failed to get payment: %w", err)
	}

	return &payment, nil
}

// GetByTransferID retrieves a payment by its TigerBeetle transfer ID.
func (r *PaymentRepository) GetByTransferID(ctx context.Context, transferID string) (*models.Payment, error) {
	query := `
		SELECT id, transaction_id, policy_id, customer_id, amount, currency,
			   payment_type, payment_method, status, original_payment_id,
			   refund_reason, processed_at, created_at, updated_at
		FROM payments
		WHERE transaction_id = $1
	`

	var payment models.Payment
	err := r.db.QueryRowContext(ctx, query, transferID).Scan(
		&payment.ID,
		&payment.TransactionID,
		&payment.PolicyID,
		&payment.CustomerID,
		&payment.Amount,
		&payment.Currency,
		&payment.PaymentType,
		&payment.PaymentMethod,
		&payment.Status,
		&payment.OriginalPaymentID,
		&payment.RefundReason,
		&payment.ProcessedAt,
		&payment.CreatedAt,
		&payment.UpdatedAt,
	)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("payment not found with transfer ID: %s", transferID)
		}
		return nil, fmt.Errorf("failed to get payment by transfer ID: %w", err)
	}

	return &payment, nil
}

// GetByPolicyID retrieves all payments for a given policy.
func (r *PaymentRepository) GetByPolicyID(ctx context.Context, policyID string) ([]models.Payment, error) {
	query := `
		SELECT id, transaction_id, policy_id, customer_id, amount, currency,
			   payment_type, payment_method, status, original_payment_id,
			   refund_reason, processed_at, created_at, updated_at
		FROM payments
		WHERE policy_id = $1
		ORDER BY created_at DESC
	`

	rows, err := r.db.QueryContext(ctx, query, policyID)
	if err != nil {
		return nil, fmt.Errorf("failed to query payments: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var payments []models.Payment
	for rows.Next() {
		var payment models.Payment
		err := rows.Scan(
			&payment.ID,
			&payment.TransactionID,
			&payment.PolicyID,
			&payment.CustomerID,
			&payment.Amount,
			&payment.Currency,
			&payment.PaymentType,
			&payment.PaymentMethod,
			&payment.Status,
			&payment.OriginalPaymentID,
			&payment.RefundReason,
			&payment.ProcessedAt,
			&payment.CreatedAt,
			&payment.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan payment: %w", err)
		}
		payments = append(payments, payment)
	}

	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating payments: %w", err)
	}

	return payments, nil
}

// UpdateStatus updates the status of a payment.
func (r *PaymentRepository) UpdateStatus(ctx context.Context, paymentID int64, status models.PaymentStatus) error {
	query := `
		UPDATE payments
		SET status = $1, updated_at = $2
		WHERE id = $3
	`

	result, err := r.db.ExecContext(ctx, query, status, time.Now(), paymentID)
	if err != nil {
		return fmt.Errorf("failed to update payment status: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}

	if rowsAffected == 0 {
		return fmt.Errorf("payment not found: %d", paymentID)
	}

	return nil
}

// GetPaymentsByCustomer retrieves all payments for a given customer.
func (r *PaymentRepository) GetPaymentsByCustomer(ctx context.Context, customerID string, limit, offset int) ([]models.Payment, error) {
	query := `
		SELECT id, transaction_id, policy_id, customer_id, amount, currency,
			   payment_type, payment_method, status, original_payment_id,
			   refund_reason, processed_at, created_at, updated_at
		FROM payments
		WHERE customer_id = $1
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3
	`

	rows, err := r.db.QueryContext(ctx, query, customerID, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("failed to query customer payments: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var payments []models.Payment
	for rows.Next() {
		var payment models.Payment
		err := rows.Scan(
			&payment.ID,
			&payment.TransactionID,
			&payment.PolicyID,
			&payment.CustomerID,
			&payment.Amount,
			&payment.Currency,
			&payment.PaymentType,
			&payment.PaymentMethod,
			&payment.Status,
			&payment.OriginalPaymentID,
			&payment.RefundReason,
			&payment.ProcessedAt,
			&payment.CreatedAt,
			&payment.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan payment: %w", err)
		}
		payments = append(payments, payment)
	}

	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating payments: %w", err)
	}

	return payments, nil
}

// GetPaymentStats retrieves payment statistics for a given time period.
func (r *PaymentRepository) GetPaymentStats(ctx context.Context, startDate, endDate time.Time) (*PaymentStats, error) {
	query := `
		SELECT 
			COUNT(*) as total_count,
			COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) as completed_count,
			COUNT(CASE WHEN status = 'FAILED' THEN 1 END) as failed_count,
			COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN amount ELSE 0 END), 0) as total_amount,
			COALESCE(AVG(CASE WHEN status = 'COMPLETED' THEN amount END), 0) as average_amount
		FROM payments
		WHERE created_at BETWEEN $1 AND $2
	`

	var stats PaymentStats
	err := r.db.QueryRowContext(ctx, query, startDate, endDate).Scan(
		&stats.TotalCount,
		&stats.CompletedCount,
		&stats.FailedCount,
		&stats.TotalAmount,
		&stats.AverageAmount,
	)

	if err != nil {
		return nil, fmt.Errorf("failed to get payment stats: %w", err)
	}

	if stats.TotalCount > 0 {
		stats.SuccessRate = float64(stats.CompletedCount) / float64(stats.TotalCount) * 100
	}

	return &stats, nil
}

// PaymentStats represents payment statistics.
type PaymentStats struct {
	TotalCount     int64   `json:"total_count"`
	CompletedCount int64   `json:"completed_count"`
	FailedCount    int64   `json:"failed_count"`
	TotalAmount    float64 `json:"total_amount"`
	AverageAmount  float64 `json:"average_amount"`
	SuccessRate    float64 `json:"success_rate"`
}
