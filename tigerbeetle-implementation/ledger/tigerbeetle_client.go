package ledger

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"log"
	"math"
	"sync"
	"sync/atomic"
	"time"

	tigerbeetle_go "github.com/tigerbeetle/tigerbeetle-go"
	"github.com/tigerbeetle/tigerbeetle-go/pkg/types"
)

// Atomic counter to prevent same-nanosecond collisions across concurrent goroutines.
var transferIDCounter uint64

// TigerBeetleClient provides a high-level wrapper around the TigerBeetle database client.
type TigerBeetleClient struct {
	client    tigerbeetle_go.Client
	clusterID uint32
	addresses []string
	mu        sync.RWMutex
	closed    bool
}

// ClientConfig holds the configuration for creating a TigerBeetle client.
type ClientConfig struct {
	ClusterID          uint32
	Addresses          []string
	MaxConcurrentBatch uint32
}

// AccountType represents different types of accounts in the system.
type AccountType uint16

const (
	AccountTypeCompanyReceivables AccountType = 1
	AccountTypeCompanyPayables    AccountType = 2
	AccountTypeCompanyReserves    AccountType = 3
	AccountTypeCompanyCommissions AccountType = 4
	AccountTypeCustomer           AccountType = 100
	AccountTypeAgent              AccountType = 200
	AccountTypeSuspense           AccountType = 300
)

// TransferCode represents different types of transfers in the system.
type TransferCode uint16

const (
	TransferCodePremiumPayment    TransferCode = 1
	TransferCodeRefund            TransferCode = 2
	TransferCodeClaimPayment      TransferCode = 3
	TransferCodeCommission        TransferCode = 4
	TransferCodeReserveAllocation TransferCode = 10
	TransferCodeReserveRelease    TransferCode = 11
)

// NewTigerBeetleClient creates a new client for interacting with TigerBeetle.
func NewTigerBeetleClient(config ClientConfig) (*TigerBeetleClient, error) {
	if config.MaxConcurrentBatch == 0 {
		config.MaxConcurrentBatch = 4096
	}

	client, err := tigerbeetle_go.NewClient(
		types.ToUint128(uint64(config.ClusterID)),
		config.Addresses,
		uint(config.MaxConcurrentBatch),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create TigerBeetle client: %w", err)
	}

	return &TigerBeetleClient{
		client:    client,
		clusterID: config.ClusterID,
		addresses: config.Addresses,
		closed:    false,
	}, nil
}

// CreateAccount creates a single account in TigerBeetle.
func (c *TigerBeetleClient) CreateAccount(ctx context.Context, account types.Account) error {
	c.mu.RLock()
	if c.closed {
		c.mu.RUnlock()
		return fmt.Errorf("client is closed")
	}
	c.mu.RUnlock()

	results, err := c.client.CreateAccounts([]types.Account{account})
	if err != nil {
		return fmt.Errorf("failed to create account: %w", err)
	}

	if len(results) > 0 {
		result := results[0]
		if result.Result != types.AccountOK {
			return fmt.Errorf("account creation failed: %s", accountResultToString(result.Result))
		}
	}

	return nil
}

// CreateAccounts creates multiple accounts in a single batch operation.
func (c *TigerBeetleClient) CreateAccounts(ctx context.Context, accounts []types.Account) ([]types.AccountEventResult, error) {
	c.mu.RLock()
	if c.closed {
		c.mu.RUnlock()
		return nil, fmt.Errorf("client is closed")
	}
	c.mu.RUnlock()

	results, err := c.client.CreateAccounts(accounts)
	if err != nil {
		return nil, fmt.Errorf("failed to create accounts: %w", err)
	}

	return results, nil
}

// CreateTransfer creates a single atomic transfer between two accounts.
func (c *TigerBeetleClient) CreateTransfer(ctx context.Context, transfer types.Transfer) error {
	c.mu.RLock()
	if c.closed {
		c.mu.RUnlock()
		return fmt.Errorf("client is closed")
	}
	c.mu.RUnlock()

	results, err := c.client.CreateTransfers([]types.Transfer{transfer})
	if err != nil {
		return fmt.Errorf("failed to create transfer: %w", err)
	}

	if len(results) > 0 {
		result := results[0]
		if result.Result != types.TransferOK {
			return NewTransferError(result.Result, transfer)
		}
	}

	return nil
}

// CreateTransfers creates multiple transfers in a single batch operation.
func (c *TigerBeetleClient) CreateTransfers(ctx context.Context, transfers []types.Transfer) ([]types.TransferEventResult, error) {
	c.mu.RLock()
	if c.closed {
		c.mu.RUnlock()
		return nil, fmt.Errorf("client is closed")
	}
	c.mu.RUnlock()

	results, err := c.client.CreateTransfers(transfers)
	if err != nil {
		return nil, fmt.Errorf("failed to create transfers: %w", err)
	}

	return results, nil
}

// LookupAccounts retrieves account information for the given account IDs.
func (c *TigerBeetleClient) LookupAccounts(ctx context.Context, accountIDs []types.Uint128) ([]types.Account, error) {
	c.mu.RLock()
	if c.closed {
		c.mu.RUnlock()
		return nil, fmt.Errorf("client is closed")
	}
	c.mu.RUnlock()

	accounts, err := c.client.LookupAccounts(accountIDs)
	if err != nil {
		return nil, fmt.Errorf("failed to lookup accounts: %w", err)
	}

	return accounts, nil
}

// LookupTransfers retrieves transfer information for the given transfer IDs.
func (c *TigerBeetleClient) LookupTransfers(ctx context.Context, transferIDs []types.Uint128) ([]types.Transfer, error) {
	c.mu.RLock()
	if c.closed {
		c.mu.RUnlock()
		return nil, fmt.Errorf("client is closed")
	}
	c.mu.RUnlock()

	transfers, err := c.client.LookupTransfers(transferIDs)
	if err != nil {
		return nil, fmt.Errorf("failed to lookup transfers: %w", err)
	}

	return transfers, nil
}

// GetAccountBalance retrieves the current balance of an account.
func (c *TigerBeetleClient) GetAccountBalance(ctx context.Context, accountID types.Uint128) (uint64, uint64, error) {
	accounts, err := c.LookupAccounts(ctx, []types.Uint128{accountID})
	if err != nil {
		return 0, 0, err
	}

	if len(accounts) == 0 {
		return 0, 0, fmt.Errorf("account not found: %v", accountID)
	}

	account := accounts[0]
	debits := account.DebitsPosted.BigInt()
	credits := account.CreditsPosted.BigInt()

	return debits.Uint64(), credits.Uint64(), nil
}

// Close closes the connection to the TigerBeetle cluster.
func (c *TigerBeetleClient) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.closed {
		return fmt.Errorf("client already closed")
	}

	c.client.Close()
	c.closed = true
	log.Printf("TigerBeetle client closed")

	return nil
}

// IsClosed returns true if the client has been closed.
func (c *TigerBeetleClient) IsClosed() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.closed
}

// GenerateTransferID generates a deterministic transfer ID based on a unique business identifier.
// Uses nanosecond timestamp + atomic counter to prevent collisions for concurrent requests.
func GenerateTransferID(businessID string, sequence int) types.Uint128 {
	counter := atomic.AddUint64(&transferIDCounter, 1)
	data := fmt.Sprintf("%s-%d-%d-%d", businessID, sequence, time.Now().UnixNano(), counter)
	hash := sha256.Sum256([]byte(data))
	var bytes [16]byte
	copy(bytes[:], hash[0:16])
	return types.BytesToUint128(bytes)
}

// AmountToSmallestUnit safely converts a float64 amount to the smallest currency unit
// (e.g. kobo for NGN, cents for USD) without floating-point truncation.
func AmountToSmallestUnit(amount float64, decimals int) uint64 {
	multiplier := math.Pow(10, float64(decimals))
	return uint64(math.Round(amount * multiplier))
}

// GenerateAccountID generates a deterministic account ID based on entity type and ID.
func GenerateAccountID(entityType string, entityID uint64) types.Uint128 {
	data := fmt.Sprintf("%s-%d", entityType, entityID)
	hash := sha256.Sum256([]byte(data))
	var bytes [16]byte
	copy(bytes[:], hash[0:16])
	return types.BytesToUint128(bytes)
}

// Uint128FromUint64 creates a Uint128 from a uint64 value.
func Uint128FromUint64(v uint64) types.Uint128 {
	var b [16]byte
	binary.LittleEndian.PutUint64(b[0:8], v)
	return types.BytesToUint128(b)
}

// TransferError represents an error that occurred during a transfer operation.
type TransferError struct {
	Code     types.CreateTransferResult
	Transfer types.Transfer
	Message  string
}

func (e *TransferError) Error() string {
	return fmt.Sprintf("transfer failed: %s (code: %d, transfer_id: %v)",
		e.Message, e.Code, e.Transfer.ID)
}

// NewTransferError creates a new TransferError from a result code and transfer.
func NewTransferError(code types.CreateTransferResult, transfer types.Transfer) *TransferError {
	return &TransferError{
		Code:     code,
		Transfer: transfer,
		Message:  transferResultToString(code),
	}
}

// IsInsufficientFunds returns true if the error is due to insufficient funds.
func (e *TransferError) IsInsufficientFunds() bool {
	return e.Code == types.TransferExceedsCredits
}

// IsDuplicate returns true if the error is due to a duplicate transfer ID.
func (e *TransferError) IsDuplicate() bool {
	return e.Code == types.TransferExists
}

func accountResultToString(result types.CreateAccountResult) string {
	switch result {
	case types.AccountOK:
		return "success"
	case types.AccountExists:
		return "account already exists"
	default:
		return fmt.Sprintf("unknown error code: %d", result)
	}
}

func transferResultToString(result types.CreateTransferResult) string {
	switch result {
	case types.TransferOK:
		return "success"
	case types.TransferExists:
		return "transfer already exists (duplicate ID)"
	case types.TransferExceedsCredits:
		return "insufficient funds in debit account"
	case types.TransferExceedsDebits:
		return "exceeds debits limit"
	case types.TransferDebitAccountNotFound:
		return "debit account not found"
	case types.TransferCreditAccountNotFound:
		return "credit account not found"
	case types.TransferAccountsMustBeDifferent:
		return "debit and credit accounts must be different"
	default:
		return fmt.Sprintf("unknown transfer result: %d", result)
	}
}
