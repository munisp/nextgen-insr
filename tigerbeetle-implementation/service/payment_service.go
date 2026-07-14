package service

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"time"

	"github.com/tigerbeetle/tigerbeetle-go/pkg/types"
	"insurance-platform/ledger"
	"insurance-platform/models"
	"insurance-platform/repository"
)

// Well-known account IDs for company accounts
const (
	CompanyReceivablesAccountID = 1
	CompanyPayablesAccountID    = 2
	CompanyReservesAccountID    = 3
	CompanyCommissionsAccountID = 4
	SuspenseAccountID           = 2000000
)

// PaymentService handles all payment-related business logic.
type PaymentService struct {
	ledgerClient     *ledger.TigerBeetleClient
	paymentRepo      *repository.PaymentRepository
	kafkaProducer    KafkaProducer
	ledgerID         uint32
}

// KafkaProducer is an interface for publishing events to Kafka.
type KafkaProducer interface {
	PublishPaymentEvent(ctx context.Context, event models.PaymentEvent) error
}

// NewPaymentService creates a new instance of PaymentService.
func NewPaymentService(
	ledgerClient *ledger.TigerBeetleClient,
	paymentRepo *repository.PaymentRepository,
	kafkaProducer KafkaProducer,
) *PaymentService {
	return &PaymentService{
		ledgerClient:  ledgerClient,
		paymentRepo:   paymentRepo,
		kafkaProducer: kafkaProducer,
		ledgerID:      1, // Default ledger ID
	}
}

// ProcessPremiumPayment processes a premium payment from a customer.
// It performs the following steps:
// 1. Validate the payment request
// 2. Create an atomic transfer in TigerBeetle (debit customer, credit company)
// 3. Record the transaction in PostgreSQL
// 4. Publish a payment event to Kafka
func (s *PaymentService) ProcessPremiumPayment(ctx context.Context, req models.PaymentRequest) (*models.PaymentResponse, error) {
	log.Printf("Processing premium payment: PolicyID=%s, Amount=%.2f, Currency=%s",
		req.PolicyID, req.Amount, req.Currency)

	// 1. Validate request
	if err := s.validatePaymentRequest(req); err != nil {
		return nil, fmt.Errorf("invalid payment request: %w", err)
	}

	// 2. Get customer account ID
	customerAccountID, err := s.getCustomerAccountID(ctx, req.CustomerID)
	if err != nil {
		return nil, fmt.Errorf("failed to get customer account: %w", err)
	}

	// 3. Generate unique transfer ID for idempotency
	transferID := ledger.GenerateTransferID(fmt.Sprintf("premium-%s", req.PolicyID), 1)

	// 4. Convert amount to smallest currency unit (kobo for NGN)
	amountInKobo := ledger.AmountToSmallestUnit(req.Amount, 2)

	// 5. Create transfer in TigerBeetle
	transfer := types.Transfer{
		ID:              transferID,
		DebitAccountID:  customerAccountID,
		CreditAccountID: types.ToUint128(uint64(CompanyReceivablesAccountID)),
		Amount:          types.ToUint128(amountInKobo),
		Ledger:          s.ledgerID,
		Code:            uint16(ledger.TransferCodePremiumPayment),
		Timestamp:       uint64(time.Now().UnixNano()),
	}

	err = s.ledgerClient.CreateTransfer(ctx, transfer)
	if err != nil {
		// Check if this is a known error type
		if transferErr, ok := err.(*ledger.TransferError); ok {
			if transferErr.IsInsufficientFunds() {
				return &models.PaymentResponse{
					Status:        models.PaymentStatusFailed,
					FailureReason: "Insufficient funds in customer account",
					TransactionID: transferID.String(),
				}, nil
			}
			if transferErr.IsDuplicate() {
				// This is an idempotency check - the transfer was already processed
				log.Printf("Duplicate transfer detected: %v", transferID)
				// Look up the original payment record
				payment, err := s.paymentRepo.GetByTransferID(ctx, transferID.String())
				if err != nil {
					return nil, fmt.Errorf("failed to retrieve duplicate payment: %w", err)
				}
				return &models.PaymentResponse{
					Status:        payment.Status,
					TransactionID: payment.TransactionID,
					PaymentID:     payment.ID,
				}, nil
			}
		}
		return nil, fmt.Errorf("TigerBeetle transfer failed: %w", err)
	}

	// 6. Record payment in PostgreSQL
	payment := models.Payment{
		TransactionID: transferID.String(),
		PolicyID:      req.PolicyID,
		CustomerID:    req.CustomerID,
		Amount:        req.Amount,
		Currency:      req.Currency,
		PaymentType:   models.PaymentTypePremium,
		PaymentMethod: req.PaymentMethod,
		Status:        models.PaymentStatusCompleted,
		ProcessedAt:   time.Now(),
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
	}

	paymentID, err := s.paymentRepo.Create(ctx, payment)
	if err != nil {
		log.Printf("ERROR: Failed to record payment in database: %v", err)
		// Note: The transfer in TigerBeetle has already succeeded, so we log the error
		// but don't fail the payment. A background job should reconcile this.
		return &models.PaymentResponse{
			Status:        models.PaymentStatusCompleted,
			TransactionID: payment.TransactionID,
			Warning:       "Payment processed but database record failed",
		}, nil
	}

	payment.ID = paymentID

	// 7. Publish payment event to Kafka
	event := models.PaymentEvent{
		EventType:     "payment.completed",
		TransactionID: payment.TransactionID,
		PaymentID:     paymentID,
		PolicyID:      req.PolicyID,
		CustomerID:    req.CustomerID,
		Amount:        req.Amount,
		Currency:      req.Currency,
		PaymentType:   string(models.PaymentTypePremium),
		Timestamp:     time.Now(),
	}

	err = s.kafkaProducer.PublishPaymentEvent(ctx, event)
	if err != nil {
		// Log error but don't fail the payment - event publishing is non-critical
		log.Printf("WARNING: Failed to publish payment event: %v", err)
	}

	log.Printf("Premium payment processed successfully: TransactionID=%s, PaymentID=%d",
		payment.TransactionID, paymentID)

	return &models.PaymentResponse{
		Status:        models.PaymentStatusCompleted,
		TransactionID: payment.TransactionID,
		PaymentID:     paymentID,
	}, nil
}

// ProcessRefund processes a refund to a customer.
func (s *PaymentService) ProcessRefund(ctx context.Context, req models.RefundRequest) (*models.PaymentResponse, error) {
	log.Printf("Processing refund: PaymentID=%d, Amount=%.2f", req.PaymentID, req.Amount)

	// 1. Get original payment
	originalPayment, err := s.paymentRepo.GetByID(ctx, req.PaymentID)
	if err != nil {
		return nil, fmt.Errorf("failed to get original payment: %w", err)
	}

	if originalPayment.Status != models.PaymentStatusCompleted {
		return nil, fmt.Errorf("cannot refund payment with status: %s", originalPayment.Status)
	}

	// 2. Validate refund amount
	if req.Amount > originalPayment.Amount {
		return nil, fmt.Errorf("refund amount (%.2f) exceeds original payment amount (%.2f)",
			req.Amount, originalPayment.Amount)
	}

	// 3. Get customer account ID
	customerAccountID, err := s.getCustomerAccountID(ctx, originalPayment.CustomerID)
	if err != nil {
		return nil, fmt.Errorf("failed to get customer account: %w", err)
	}

	// 4. Generate unique transfer ID
	transferID := ledger.GenerateTransferID(fmt.Sprintf("refund-%d", req.PaymentID), 1)

	// 5. Convert amount to smallest currency unit
	amountInKobo := ledger.AmountToSmallestUnit(req.Amount, 2)

	// 6. Create refund transfer (reverse of original: debit company, credit customer)
	transfer := types.Transfer{
		ID:              transferID,
		DebitAccountID:  types.ToUint128(uint64(CompanyReceivablesAccountID)),
		CreditAccountID: customerAccountID,
		Amount:          types.ToUint128(amountInKobo),
		Ledger:          s.ledgerID,
		Code:            uint16(ledger.TransferCodeRefund),
		Timestamp:       uint64(time.Now().UnixNano()),
	}

	err = s.ledgerClient.CreateTransfer(ctx, transfer)
	if err != nil {
		if transferErr, ok := err.(*ledger.TransferError); ok {
			if transferErr.IsDuplicate() {
				// Idempotency check
				payment, err := s.paymentRepo.GetByTransferID(ctx, transferID.String())
				if err != nil {
					return nil, fmt.Errorf("failed to retrieve duplicate refund: %w", err)
				}
				return &models.PaymentResponse{
					Status:        payment.Status,
					TransactionID: payment.TransactionID,
					PaymentID:     payment.ID,
				}, nil
			}
		}
		return nil, fmt.Errorf("TigerBeetle refund transfer failed: %w", err)
	}

	// 7. Record refund in PostgreSQL
	refund := models.Payment{
		TransactionID:      transferID.String(),
		PolicyID:           originalPayment.PolicyID,
		CustomerID:         originalPayment.CustomerID,
		Amount:             req.Amount,
		Currency:           originalPayment.Currency,
		PaymentType:        models.PaymentTypeRefund,
		PaymentMethod:      originalPayment.PaymentMethod,
		Status:             models.PaymentStatusCompleted,
		OriginalPaymentID:  sql.NullInt64{Int64: req.PaymentID, Valid: true},
		RefundReason:       sql.NullString{String: req.Reason, Valid: true},
		ProcessedAt:        time.Now(),
		CreatedAt:          time.Now(),
		UpdatedAt:          time.Now(),
	}

	refundID, err := s.paymentRepo.Create(ctx, refund)
	if err != nil {
		log.Printf("ERROR: Failed to record refund in database: %v", err)
		return &models.PaymentResponse{
			Status:        models.PaymentStatusCompleted,
			TransactionID: refund.TransactionID,
			Warning:       "Refund processed but database record failed",
		}, nil
	}

	// 8. Publish refund event
	event := models.PaymentEvent{
		EventType:     "payment.refunded",
		TransactionID: refund.TransactionID,
		PaymentID:     refundID,
		PolicyID:      originalPayment.PolicyID,
		CustomerID:    originalPayment.CustomerID,
		Amount:        req.Amount,
		Currency:      originalPayment.Currency,
		PaymentType:   string(models.PaymentTypeRefund),
		Timestamp:     time.Now(),
	}

	err = s.kafkaProducer.PublishPaymentEvent(ctx, event)
	if err != nil {
		log.Printf("WARNING: Failed to publish refund event: %v", err)
	}

	log.Printf("Refund processed successfully: TransactionID=%s, RefundID=%d",
		refund.TransactionID, refundID)

	return &models.PaymentResponse{
		Status:        models.PaymentStatusCompleted,
		TransactionID: refund.TransactionID,
		PaymentID:     refundID,
	}, nil
}

// GetPaymentStatus retrieves the status of a payment.
func (s *PaymentService) GetPaymentStatus(ctx context.Context, paymentID int64) (*models.Payment, error) {
	payment, err := s.paymentRepo.GetByID(ctx, paymentID)
	if err != nil {
		return nil, fmt.Errorf("failed to get payment: %w", err)
	}
	return payment, nil
}

// GetPaymentsByPolicy retrieves all payments for a given policy.
func (s *PaymentService) GetPaymentsByPolicy(ctx context.Context, policyID string) ([]models.Payment, error) {
	payments, err := s.paymentRepo.GetByPolicyID(ctx, policyID)
	if err != nil {
		return nil, fmt.Errorf("failed to get payments for policy: %w", err)
	}
	return payments, nil
}

// validatePaymentRequest validates a payment request.
func (s *PaymentService) validatePaymentRequest(req models.PaymentRequest) error {
	if req.PolicyID == "" {
		return fmt.Errorf("policy ID is required")
	}
	if req.CustomerID == "" {
		return fmt.Errorf("customer ID is required")
	}
	if req.Amount <= 0 {
		return fmt.Errorf("amount must be positive")
	}
	if req.Currency == "" {
		return fmt.Errorf("currency is required")
	}
	if req.Currency != "NGN" {
		return fmt.Errorf("only NGN currency is supported")
	}
	return nil
}

// getCustomerAccountID retrieves or creates a TigerBeetle account for a customer.
func (s *PaymentService) getCustomerAccountID(ctx context.Context, customerID string) (types.Uint128, error) {
	// In a real implementation, this would look up the customer's account ID from a database
	// or create a new account if one doesn't exist.
	// For now, we generate a deterministic account ID based on the customer ID.
	
	// Parse customer ID to uint64 (assuming it's numeric)
	var customerIDNum uint64
	_, err := fmt.Sscanf(customerID, "%d", &customerIDNum)
	if err != nil {
		return types.Uint128{}, fmt.Errorf("invalid customer ID format: %w", err)
	}

	accountID := ledger.GenerateAccountID("customer", customerIDNum)

	// Check if account exists
	accounts, err := s.ledgerClient.LookupAccounts(ctx, []types.Uint128{accountID})
	if err != nil {
		return types.Uint128{}, fmt.Errorf("failed to lookup customer account: %w", err)
	}

	// If account doesn't exist, create it
	if len(accounts) == 0 {
		account := types.Account{
			ID:     accountID,
			Ledger: s.ledgerID,
			Code:   uint16(ledger.AccountTypeCustomer),
		}
		err = s.ledgerClient.CreateAccount(ctx, account)
		if err != nil {
			return types.Uint128{}, fmt.Errorf("failed to create customer account: %w", err)
		}
		log.Printf("Created new TigerBeetle account for customer %s: %v", customerID, accountID)
	}

	return accountID, nil
}

// ProcessCommissionPayment processes a commission payment to an agent.
func (s *PaymentService) ProcessCommissionPayment(ctx context.Context, req models.CommissionPaymentRequest) (*models.PaymentResponse, error) {
	log.Printf("Processing commission payment: AgentID=%s, Amount=%.2f", req.AgentID, req.Amount)

	// 1. Get agent account ID
	agentAccountID := ledger.GenerateAccountID("agent", req.AgentID)

	// 2. Generate unique transfer ID
	transferID := ledger.GenerateTransferID(fmt.Sprintf("commission-%s-%s", req.PolicyID, req.AgentID), 1)

	// 3. Convert amount to smallest currency unit
	amountInKobo := ledger.AmountToSmallestUnit(req.Amount, 2)

	// 4. Create transfer (debit company commissions account, credit agent account)
	transfer := types.Transfer{
		ID:              transferID,
		DebitAccountID:  types.ToUint128(uint64(CompanyCommissionsAccountID)),
		CreditAccountID: agentAccountID,
		Amount:          types.ToUint128(amountInKobo),
		Ledger:          s.ledgerID,
		Code:            uint16(ledger.TransferCodeCommission),
		Timestamp:       uint64(time.Now().UnixNano()),
	}

	err := s.ledgerClient.CreateTransfer(ctx, transfer)
	if err != nil {
		return nil, fmt.Errorf("commission transfer failed: %w", err)
	}

	// 5. Record in database
	payment := models.Payment{
		TransactionID: transferID.String(),
		PolicyID:      req.PolicyID,
		CustomerID:    fmt.Sprintf("agent-%d", req.AgentID),
		Amount:        req.Amount,
		Currency:      "NGN",
		PaymentType:   models.PaymentTypeCommission,
		Status:        models.PaymentStatusCompleted,
		ProcessedAt:   time.Now(),
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
	}

	paymentID, err := s.paymentRepo.Create(ctx, payment)
	if err != nil {
		log.Printf("ERROR: Failed to record commission in database: %v", err)
	}

	log.Printf("Commission payment processed: TransactionID=%s", payment.TransactionID)

	return &models.PaymentResponse{
		Status:        models.PaymentStatusCompleted,
		TransactionID: payment.TransactionID,
		PaymentID:     paymentID,
	}, nil
}
