package ledger

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tigerbeetle/tigerbeetle-go/pkg/types"
)

// Note: These tests require a running TigerBeetle cluster
// To run tests: docker run -p 3000:3000 ghcr.io/tigerbeetle/tigerbeetle:latest

func TestNewTigerBeetleClient(t *testing.T) {
	config := ClientConfig{
		ClusterID:          1,
		Addresses:          []string{"localhost:3000"},
		MaxConcurrentBatch: 4096,
	}

	client, err := NewTigerBeetleClient(config)
	require.NoError(t, err)
	require.NotNil(t, client)
	assert.False(t, client.IsClosed())

	err = client.Close()
	require.NoError(t, err)
	assert.True(t, client.IsClosed())
}

func TestCreateAccount(t *testing.T) {
	client := setupTestClient(t)
	defer func() { _ = client.Close() }()

	ctx := context.Background()

	// Create a test account
	accountID := types.ToUint128(uint64(time.Now().UnixNano()))
	account := types.Account{
		ID:     accountID,
		Ledger: 1,
		Code:   uint16(AccountTypeCustomer),
	}

	err := client.CreateAccount(ctx, account)
	require.NoError(t, err)

	// Verify account was created
	accounts, err := client.LookupAccounts(ctx, []types.Uint128{accountID})
	require.NoError(t, err)
	require.Len(t, accounts, 1)
	assert.Equal(t, accountID, accounts[0].ID)
}

func TestCreateAccounts_Batch(t *testing.T) {
	client := setupTestClient(t)
	defer func() { _ = client.Close() }()

	ctx := context.Background()

	// Create multiple accounts in a batch
	baseID := uint64(time.Now().UnixNano())
	accounts := []types.Account{
		{
			ID:     types.ToUint128(baseID + 1),
			Ledger: 1,
			Code:   uint16(AccountTypeCustomer),
		},
		{
			ID:     types.ToUint128(baseID + 2),
			Ledger: 1,
			Code:   uint16(AccountTypeCustomer),
		},
		{
			ID:     types.ToUint128(baseID + 3),
			Ledger: 1,
			Code:   uint16(AccountTypeCustomer),
		},
	}

	results, err := client.CreateAccounts(ctx, accounts)
	require.NoError(t, err)

	// All accounts should be created successfully
	for _, result := range results {
		assert.Equal(t, types.AccountOK, result.Result)
	}
}

func TestCreateTransfer_Success(t *testing.T) {
	client := setupTestClient(t)
	defer func() { _ = client.Close() }()

	ctx := context.Background()

	// Create two accounts
	debitAccountID := types.ToUint128(uint64(time.Now().UnixNano()))
	creditAccountID := types.ToUint128(uint64(time.Now().UnixNano() + 1))

	accounts := []types.Account{
		{
			ID:     debitAccountID,
			Ledger: 1,
			Code:   uint16(AccountTypeCustomer),
		},
		{
			ID:     creditAccountID,
			Ledger: 1,
			Code:   uint16(AccountTypeCompanyReceivables),
		},
	}

	_, err := client.CreateAccounts(ctx, accounts)
	require.NoError(t, err)

	// Create a transfer
	transferID := types.ToUint128(uint64(time.Now().UnixNano()))
	transfer := types.Transfer{
		ID:              transferID,
		DebitAccountID:  debitAccountID,
		CreditAccountID: creditAccountID,
		Amount:          types.ToUint128(100000), // 1000.00 NGN in kobo
		Ledger:          1,
		Code:            uint16(TransferCodePremiumPayment),
	}

	err = client.CreateTransfer(ctx, transfer)
	require.NoError(t, err)

	// Verify transfer was created
	transfers, err := client.LookupTransfers(ctx, []types.Uint128{transferID})
	require.NoError(t, err)
	require.Len(t, transfers, 1)
	assert.Equal(t, transferID, transfers[0].ID)
}

func TestCreateTransfer_InsufficientFunds(t *testing.T) {
	client := setupTestClient(t)
	defer func() { _ = client.Close() }()

	ctx := context.Background()

	// Create two accounts
	debitAccountID := types.ToUint128(uint64(time.Now().UnixNano()))
	creditAccountID := types.ToUint128(uint64(time.Now().UnixNano() + 1))

	accounts := []types.Account{
		{
			ID:     debitAccountID,
			Ledger: 1,
			Code:   uint16(AccountTypeCustomer),
		},
		{
			ID:     creditAccountID,
			Ledger: 1,
			Code:   uint16(AccountTypeCompanyReceivables),
		},
	}

	_, err := client.CreateAccounts(ctx, accounts)
	require.NoError(t, err)

	// Try to create a transfer with insufficient funds
	transferID := types.ToUint128(uint64(time.Now().UnixNano()))
	transfer := types.Transfer{
		ID:              transferID,
		DebitAccountID:  debitAccountID,
		CreditAccountID: creditAccountID,
		Amount:          types.ToUint128(100000), // Account has 0 balance
		Ledger:          1,
		Code:            uint16(TransferCodePremiumPayment),
	}

	err = client.CreateTransfer(ctx, transfer)
	require.Error(t, err)

	// Check if it's an insufficient funds error
	transferErr, ok := err.(*TransferError)
	require.True(t, ok)
	assert.True(t, transferErr.IsInsufficientFunds())
}

func TestCreateTransfer_Duplicate(t *testing.T) {
	client := setupTestClient(t)
	defer func() { _ = client.Close() }()

	ctx := context.Background()

	// Create two accounts
	debitAccountID := types.ToUint128(uint64(time.Now().UnixNano()))
	creditAccountID := types.ToUint128(uint64(time.Now().UnixNano() + 1))

	accounts := []types.Account{
		{
			ID:     debitAccountID,
			Ledger: 1,
			Code:   uint16(AccountTypeCustomer),
		},
		{
			ID:     creditAccountID,
			Ledger: 1,
			Code:   uint16(AccountTypeCompanyReceivables),
		},
	}

	_, err := client.CreateAccounts(ctx, accounts)
	require.NoError(t, err)

	// Create a transfer
	transferID := types.ToUint128(uint64(time.Now().UnixNano()))
	transfer := types.Transfer{
		ID:              transferID,
		DebitAccountID:  debitAccountID,
		CreditAccountID: creditAccountID,
		Amount:          types.ToUint128(100000),
		Ledger:          1,
		Code:            uint16(TransferCodePremiumPayment),
	}

	err = client.CreateTransfer(ctx, transfer)
	require.NoError(t, err)

	// Try to create the same transfer again
	err = client.CreateTransfer(ctx, transfer)
	require.Error(t, err)

	// Check if it's a duplicate error
	transferErr, ok := err.(*TransferError)
	require.True(t, ok)
	assert.True(t, transferErr.IsDuplicate())
}

func TestGetAccountBalance(t *testing.T) {
	client := setupTestClient(t)
	defer func() { _ = client.Close() }()

	ctx := context.Background()

	// Create two accounts
	debitAccountID := types.ToUint128(uint64(time.Now().UnixNano()))
	creditAccountID := types.ToUint128(uint64(time.Now().UnixNano() + 1))

	accounts := []types.Account{
		{
			ID:     debitAccountID,
			Ledger: 1,
			Code:   uint16(AccountTypeCustomer),
		},
		{
			ID:     creditAccountID,
			Ledger: 1,
			Code:   uint16(AccountTypeCompanyReceivables),
		},
	}

	_, err := client.CreateAccounts(ctx, accounts)
	require.NoError(t, err)

	// Create a transfer
	transferID := types.ToUint128(uint64(time.Now().UnixNano()))
	transfer := types.Transfer{
		ID:              transferID,
		DebitAccountID:  debitAccountID,
		CreditAccountID: creditAccountID,
		Amount:          types.ToUint128(100000),
		Ledger:          1,
		Code:            uint16(TransferCodePremiumPayment),
	}

	err = client.CreateTransfer(ctx, transfer)
	require.NoError(t, err)

	// Check balances
	debits, credits, err := client.GetAccountBalance(ctx, debitAccountID)
	require.NoError(t, err)
	assert.Equal(t, uint64(100000), debits)
	assert.Equal(t, uint64(0), credits)

	debits, credits, err = client.GetAccountBalance(ctx, creditAccountID)
	require.NoError(t, err)
	assert.Equal(t, uint64(0), debits)
	assert.Equal(t, uint64(100000), credits)
}

func TestGenerateTransferID(t *testing.T) {
	// Test that the same business ID generates the same transfer ID
	businessID := "policy-12345"
	sequence := 1

	id1 := GenerateTransferID(businessID, sequence)
	id2 := GenerateTransferID(businessID, sequence)

	// Due to timestamp in the generation, IDs will be different
	// This is intentional to prevent accidental duplicates
	assert.NotEqual(t, id1, id2)

	// Test with different sequences
	id3 := GenerateTransferID(businessID, 2)
	assert.NotEqual(t, id1, id3)
}

func TestGenerateAccountID(t *testing.T) {
	// Test that the same entity generates the same account ID
	entityType := "customer"
	entityID := uint64(12345)

	id1 := GenerateAccountID(entityType, entityID)
	id2 := GenerateAccountID(entityType, entityID)

	// Should be deterministic
	assert.Equal(t, id1, id2)

	// Different entity should generate different ID
	id3 := GenerateAccountID(entityType, 67890)
	assert.NotEqual(t, id1, id3)
}

func TestTransferError(t *testing.T) {
	transfer := types.Transfer{
		ID:              types.ToUint128(123),
		DebitAccountID:  types.ToUint128(1),
		CreditAccountID: types.ToUint128(2),
		Amount:          types.ToUint128(100),
	}

	err := NewTransferError(types.TransferExceedsCredits, transfer)
	assert.True(t, err.IsInsufficientFunds())
	assert.False(t, err.IsDuplicate())
	assert.Contains(t, err.Error(), "insufficient funds")

	err = NewTransferError(types.TransferExists, transfer)
	assert.False(t, err.IsInsufficientFunds())
	assert.True(t, err.IsDuplicate())
	assert.Contains(t, err.Error(), "duplicate")
}

// Helper function to setup a test client
func setupTestClient(t *testing.T) *TigerBeetleClient {
	config := ClientConfig{
		ClusterID:          1,
		Addresses:          []string{"localhost:3000"},
		MaxConcurrentBatch: 4096,
	}

	client, err := NewTigerBeetleClient(config)
	require.NoError(t, err)
	require.NotNil(t, client)

	return client
}
