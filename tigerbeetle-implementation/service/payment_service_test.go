package service

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"github.com/tigerbeetle/tigerbeetle-go/pkg/types"

	"insurance-platform/ledger"
	"insurance-platform/models"
)

// MockTigerBeetleClient is a mock implementation of TigerBeetle client for testing
type MockTigerBeetleClient struct {
	mock.Mock
}

func (m *MockTigerBeetleClient) CreateAccount(ctx context.Context, account types.Account) error {
	args := m.Called(ctx, account)
	return args.Error(0)
}

func (m *MockTigerBeetleClient) CreateAccounts(ctx context.Context, accounts []types.Account) ([]types.AccountEventResult, error) {
	args := m.Called(ctx, accounts)
	return args.Get(0).([]types.AccountEventResult), args.Error(1)
}

func (m *MockTigerBeetleClient) CreateTransfer(ctx context.Context, transfer types.Transfer) error {
	args := m.Called(ctx, transfer)
	return args.Error(0)
}

func (m *MockTigerBeetleClient) CreateTransfers(ctx context.Context, transfers []types.Transfer) ([]types.TransferEventResult, error) {
	args := m.Called(ctx, transfers)
	return args.Get(0).([]types.TransferEventResult), args.Error(1)
}

func (m *MockTigerBeetleClient) LookupAccounts(ctx context.Context, accountIDs []types.Uint128) ([]types.Account, error) {
	args := m.Called(ctx, accountIDs)
	return args.Get(0).([]types.Account), args.Error(1)
}

func (m *MockTigerBeetleClient) LookupTransfers(ctx context.Context, transferIDs []types.Uint128) ([]types.Transfer, error) {
	args := m.Called(ctx, transferIDs)
	return args.Get(0).([]types.Transfer), args.Error(1)
}

func (m *MockTigerBeetleClient) GetAccountBalance(ctx context.Context, accountID types.Uint128) (uint64, uint64, error) {
	args := m.Called(ctx, accountID)
	return args.Get(0).(uint64), args.Get(1).(uint64), args.Error(2)
}

func (m *MockTigerBeetleClient) Close() error {
	args := m.Called()
	return args.Error(0)
}

func (m *MockTigerBeetleClient) IsClosed() bool {
	args := m.Called()
	return args.Bool(0)
}

// MockPaymentRepository is a mock implementation of payment repository
type MockPaymentRepository struct {
	mock.Mock
}

func (m *MockPaymentRepository) Create(ctx context.Context, payment models.Payment) (int64, error) {
	args := m.Called(ctx, payment)
	return args.Get(0).(int64), args.Error(1)
}

func (m *MockPaymentRepository) GetByID(ctx context.Context, paymentID int64) (*models.Payment, error) {
	args := m.Called(ctx, paymentID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*models.Payment), args.Error(1)
}

func (m *MockPaymentRepository) GetByTransferID(ctx context.Context, transferID string) (*models.Payment, error) {
	args := m.Called(ctx, transferID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*models.Payment), args.Error(1)
}

func (m *MockPaymentRepository) GetByPolicyID(ctx context.Context, policyID string) ([]models.Payment, error) {
	args := m.Called(ctx, policyID)
	return args.Get(0).([]models.Payment), args.Error(1)
}

// MockKafkaProducer is a mock implementation of Kafka producer
type MockKafkaProducer struct {
	mock.Mock
}

func (m *MockKafkaProducer) PublishPaymentEvent(ctx context.Context, event models.PaymentEvent) error {
	args := m.Called(ctx, event)
	return args.Error(0)
}

func TestProcessPremiumPayment_Success(t *testing.T) {
	// Setup mocks
	mockLedger := new(MockTigerBeetleClient)
	mockRepo := new(MockPaymentRepository)
	mockKafka := new(MockKafkaProducer)

	service := NewPaymentService(mockLedger, mockRepo, mockKafka)

	ctx := context.Background()
	req := models.PaymentRequest{
		PolicyID:      "policy-123",
		CustomerID:    "12345",
		Amount:        50000.00,
		Currency:      "NGN",
		PaymentMethod: models.PaymentMethodCard,
	}

	// Mock expectations
	customerAccountID := ledger.GenerateAccountID("customer", 12345)

	// Mock account lookup - account exists
	mockLedger.On("LookupAccounts", ctx, []types.Uint128{customerAccountID}).
		Return([]types.Account{{ID: customerAccountID}}, nil)

	// Mock successful transfer
	mockLedger.On("CreateTransfer", ctx, mock.AnythingOfType("types.Transfer")).
		Return(nil)

	// Mock successful database insert
	mockRepo.On("Create", ctx, mock.AnythingOfType("models.Payment")).
		Return(int64(1), nil)

	// Mock successful Kafka publish
	mockKafka.On("PublishPaymentEvent", ctx, mock.AnythingOfType("models.PaymentEvent")).
		Return(nil)

	// Execute
	response, err := service.ProcessPremiumPayment(ctx, req)

	// Assert
	require.NoError(t, err)
	require.NotNil(t, response)
	assert.Equal(t, models.PaymentStatusCompleted, response.Status)
	assert.NotEmpty(t, response.TransactionID)
	assert.Equal(t, int64(1), response.PaymentID)

	mockLedger.AssertExpectations(t)
	mockRepo.AssertExpectations(t)
	mockKafka.AssertExpectations(t)
}

func TestProcessPremiumPayment_InsufficientFunds(t *testing.T) {
	mockLedger := new(MockTigerBeetleClient)
	mockRepo := new(MockPaymentRepository)
	mockKafka := new(MockKafkaProducer)

	service := NewPaymentService(mockLedger, mockRepo, mockKafka)

	ctx := context.Background()
	req := models.PaymentRequest{
		PolicyID:      "policy-123",
		CustomerID:    "12345",
		Amount:        50000.00,
		Currency:      "NGN",
		PaymentMethod: models.PaymentMethodCard,
	}

	customerAccountID := ledger.GenerateAccountID("customer", 12345)

	// Mock account lookup
	mockLedger.On("LookupAccounts", ctx, []types.Uint128{customerAccountID}).
		Return([]types.Account{{ID: customerAccountID}}, nil)

	// Mock insufficient funds error
	transfer := types.Transfer{ID: types.ToUint128(1)}
	insufficientFundsErr := ledger.NewTransferError(types.TransferExceedsCredits, transfer)
	mockLedger.On("CreateTransfer", ctx, mock.AnythingOfType("types.Transfer")).
		Return(insufficientFundsErr)

	// Execute
	response, err := service.ProcessPremiumPayment(ctx, req)

	// Assert
	require.NoError(t, err) // Service returns nil error but failed status
	require.NotNil(t, response)
	assert.Equal(t, models.PaymentStatusFailed, response.Status)
	assert.Contains(t, response.FailureReason, "Insufficient funds")

	mockLedger.AssertExpectations(t)
}

func TestProcessPremiumPayment_DuplicateTransfer(t *testing.T) {
	mockLedger := new(MockTigerBeetleClient)
	mockRepo := new(MockPaymentRepository)
	mockKafka := new(MockKafkaProducer)

	service := NewPaymentService(mockLedger, mockRepo, mockKafka)

	ctx := context.Background()
	req := models.PaymentRequest{
		PolicyID:      "policy-123",
		CustomerID:    "12345",
		Amount:        50000.00,
		Currency:      "NGN",
		PaymentMethod: models.PaymentMethodCard,
	}

	customerAccountID := ledger.GenerateAccountID("customer", 12345)

	// Mock account lookup
	mockLedger.On("LookupAccounts", ctx, []types.Uint128{customerAccountID}).
		Return([]types.Account{{ID: customerAccountID}}, nil)

	// Mock duplicate transfer error
	transfer := types.Transfer{ID: types.ToUint128(1)}
	duplicateErr := ledger.NewTransferError(types.TransferExists, transfer)
	mockLedger.On("CreateTransfer", ctx, mock.AnythingOfType("types.Transfer")).
		Return(duplicateErr)

	// Mock repository lookup for duplicate
	existingPayment := &models.Payment{
		ID:            1,
		TransactionID: "txn-123",
		Status:        models.PaymentStatusCompleted,
	}
	mockRepo.On("GetByTransferID", ctx, mock.AnythingOfType("string")).
		Return(existingPayment, nil)

	// Execute
	response, err := service.ProcessPremiumPayment(ctx, req)

	// Assert
	require.NoError(t, err)
	require.NotNil(t, response)
	assert.Equal(t, models.PaymentStatusCompleted, response.Status)
	assert.Equal(t, "txn-123", response.TransactionID)
	assert.Equal(t, int64(1), response.PaymentID)

	mockLedger.AssertExpectations(t)
	mockRepo.AssertExpectations(t)
}

func TestProcessPremiumPayment_InvalidRequest(t *testing.T) {
	mockLedger := new(MockTigerBeetleClient)
	mockRepo := new(MockPaymentRepository)
	mockKafka := new(MockKafkaProducer)

	service := NewPaymentService(mockLedger, mockRepo, mockKafka)

	ctx := context.Background()

	testCases := []struct {
		name    string
		request models.PaymentRequest
		errMsg  string
	}{
		{
			name: "Missing PolicyID",
			request: models.PaymentRequest{
				CustomerID: "12345",
				Amount:     50000.00,
				Currency:   "NGN",
			},
			errMsg: "policy ID is required",
		},
		{
			name: "Missing CustomerID",
			request: models.PaymentRequest{
				PolicyID: "policy-123",
				Amount:   50000.00,
				Currency: "NGN",
			},
			errMsg: "customer ID is required",
		},
		{
			name: "Invalid Amount",
			request: models.PaymentRequest{
				PolicyID:   "policy-123",
				CustomerID: "12345",
				Amount:     -100.00,
				Currency:   "NGN",
			},
			errMsg: "amount must be positive",
		},
		{
			name: "Invalid Currency",
			request: models.PaymentRequest{
				PolicyID:   "policy-123",
				CustomerID: "12345",
				Amount:     50000.00,
				Currency:   "USD",
			},
			errMsg: "only NGN currency is supported",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			response, err := service.ProcessPremiumPayment(ctx, tc.request)
			require.Error(t, err)
			assert.Nil(t, response)
			assert.Contains(t, err.Error(), tc.errMsg)
		})
	}
}

func TestProcessRefund_Success(t *testing.T) {
	mockLedger := new(MockTigerBeetleClient)
	mockRepo := new(MockPaymentRepository)
	mockKafka := new(MockKafkaProducer)

	service := NewPaymentService(mockLedger, mockRepo, mockKafka)

	ctx := context.Background()
	req := models.RefundRequest{
		PaymentID: 1,
		Amount:    25000.00,
		Reason:    "Customer requested refund",
	}

	// Mock original payment lookup
	originalPayment := &models.Payment{
		ID:         1,
		PolicyID:   "policy-123",
		CustomerID: "12345",
		Amount:     50000.00,
		Currency:   "NGN",
		Status:     models.PaymentStatusCompleted,
	}
	mockRepo.On("GetByID", ctx, int64(1)).Return(originalPayment, nil)

	customerAccountID := ledger.GenerateAccountID("customer", 12345)

	// Mock account lookup
	mockLedger.On("LookupAccounts", ctx, []types.Uint128{customerAccountID}).
		Return([]types.Account{{ID: customerAccountID}}, nil)

	// Mock successful refund transfer
	mockLedger.On("CreateTransfer", ctx, mock.AnythingOfType("types.Transfer")).
		Return(nil)

	// Mock successful database insert
	mockRepo.On("Create", ctx, mock.AnythingOfType("models.Payment")).
		Return(int64(2), nil)

	// Mock successful Kafka publish
	mockKafka.On("PublishPaymentEvent", ctx, mock.AnythingOfType("models.PaymentEvent")).
		Return(nil)

	// Execute
	response, err := service.ProcessRefund(ctx, req)

	// Assert
	require.NoError(t, err)
	require.NotNil(t, response)
	assert.Equal(t, models.PaymentStatusCompleted, response.Status)
	assert.NotEmpty(t, response.TransactionID)
	assert.Equal(t, int64(2), response.PaymentID)

	mockLedger.AssertExpectations(t)
	mockRepo.AssertExpectations(t)
	mockKafka.AssertExpectations(t)
}

func TestProcessRefund_ExceedsOriginalAmount(t *testing.T) {
	mockLedger := new(MockTigerBeetleClient)
	mockRepo := new(MockPaymentRepository)
	mockKafka := new(MockKafkaProducer)

	service := NewPaymentService(mockLedger, mockRepo, mockKafka)

	ctx := context.Background()
	req := models.RefundRequest{
		PaymentID: 1,
		Amount:    75000.00, // More than original
		Reason:    "Customer requested refund",
	}

	// Mock original payment lookup
	originalPayment := &models.Payment{
		ID:         1,
		PolicyID:   "policy-123",
		CustomerID: "12345",
		Amount:     50000.00,
		Currency:   "NGN",
		Status:     models.PaymentStatusCompleted,
	}
	mockRepo.On("GetByID", ctx, int64(1)).Return(originalPayment, nil)

	// Execute
	response, err := service.ProcessRefund(ctx, req)

	// Assert
	require.Error(t, err)
	assert.Nil(t, response)
	assert.Contains(t, err.Error(), "exceeds original payment amount")

	mockRepo.AssertExpectations(t)
}

func TestGetPaymentStatus(t *testing.T) {
	mockLedger := new(MockTigerBeetleClient)
	mockRepo := new(MockPaymentRepository)
	mockKafka := new(MockKafkaProducer)

	service := NewPaymentService(mockLedger, mockRepo, mockKafka)

	ctx := context.Background()
	paymentID := int64(1)

	expectedPayment := &models.Payment{
		ID:            1,
		TransactionID: "txn-123",
		PolicyID:      "policy-123",
		Amount:        50000.00,
		Status:        models.PaymentStatusCompleted,
	}

	mockRepo.On("GetByID", ctx, paymentID).Return(expectedPayment, nil)

	// Execute
	payment, err := service.GetPaymentStatus(ctx, paymentID)

	// Assert
	require.NoError(t, err)
	require.NotNil(t, payment)
	assert.Equal(t, expectedPayment.ID, payment.ID)
	assert.Equal(t, expectedPayment.TransactionID, payment.TransactionID)
	assert.Equal(t, expectedPayment.Status, payment.Status)

	mockRepo.AssertExpectations(t)
}

func TestGetPaymentsByPolicy(t *testing.T) {
	mockLedger := new(MockTigerBeetleClient)
	mockRepo := new(MockPaymentRepository)
	mockKafka := new(MockKafkaProducer)

	service := NewPaymentService(mockLedger, mockRepo, mockKafka)

	ctx := context.Background()
	policyID := "policy-123"

	expectedPayments := []models.Payment{
		{
			ID:            1,
			TransactionID: "txn-123",
			PolicyID:      policyID,
			Amount:        50000.00,
			Status:        models.PaymentStatusCompleted,
		},
		{
			ID:            2,
			TransactionID: "txn-456",
			PolicyID:      policyID,
			Amount:        50000.00,
			Status:        models.PaymentStatusCompleted,
		},
	}

	mockRepo.On("GetByPolicyID", ctx, policyID).Return(expectedPayments, nil)

	// Execute
	payments, err := service.GetPaymentsByPolicy(ctx, policyID)

	// Assert
	require.NoError(t, err)
	require.Len(t, payments, 2)
	assert.Equal(t, expectedPayments[0].ID, payments[0].ID)
	assert.Equal(t, expectedPayments[1].ID, payments[1].ID)

	mockRepo.AssertExpectations(t)
}
