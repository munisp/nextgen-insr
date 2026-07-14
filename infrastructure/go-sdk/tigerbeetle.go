package infra

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"go.uber.org/zap"
)

type TigerBeetleClient struct {
	baseURL    string
	httpClient *http.Client
	logger     *zap.Logger
}

type TBAccount struct {
	ID             string `json:"id"`
	DebitsPending  uint64 `json:"debits_pending"`
	DebitsPosted   uint64 `json:"debits_posted"`
	CreditsPending uint64 `json:"credits_pending"`
	CreditsPosted  uint64 `json:"credits_posted"`
	UserData128    string `json:"user_data_128,omitempty"`
	Ledger         uint32 `json:"ledger"`
	Code           uint16 `json:"code"`
	Flags          uint16 `json:"flags"`
}

type TBTransfer struct {
	ID              string `json:"id"`
	DebitAccountID  string `json:"debit_account_id"`
	CreditAccountID string `json:"credit_account_id"`
	Amount          uint64 `json:"amount"`
	Ledger          uint32 `json:"ledger"`
	Code            uint16 `json:"code"`
	UserData128     string `json:"user_data_128,omitempty"`
	Flags           uint16 `json:"flags"`
}

// Ledger codes for different account types
const (
	LedgerPremium    uint32 = 1
	LedgerClaims     uint32 = 2
	LedgerCommission uint32 = 3
	LedgerPayout     uint32 = 4
	LedgerReserve    uint32 = 5
	LedgerMobileMoney uint32 = 6
)

// KYC-level transfer limits (in minor currency units, e.g., kobo)
var KYCTransferLimits = map[int]uint64{
	0: 5000_00,      // Level 0: ₦5,000
	1: 50000_00,     // Level 1: ₦50,000
	2: 500000_00,    // Level 2: ₦500,000
	3: 10000000_00,  // Level 3: ₦10,000,000
}

func NewTigerBeetleClient(logger *zap.Logger, addr string) *TigerBeetleClient {
	return &TigerBeetleClient{
		baseURL: fmt.Sprintf("http://%s", addr),
		httpClient: &http.Client{
			Timeout: 5 * time.Second,
		},
		logger: logger,
	}
}

func (c *TigerBeetleClient) Ping(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, "GET", c.baseURL+"/health", nil)
	if err != nil {
		return err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("tigerbeetle ping: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("tigerbeetle unhealthy: %d", resp.StatusCode)
	}
	return nil
}

func (c *TigerBeetleClient) CreateAccount(ctx context.Context, account TBAccount) error {
	return c.post(ctx, "/accounts/create", account)
}

func (c *TigerBeetleClient) CreateTransfer(ctx context.Context, transfer TBTransfer) error {
	return c.post(ctx, "/transfers/create", transfer)
}

func (c *TigerBeetleClient) CreateBatchTransfers(ctx context.Context, transfers []TBTransfer) error {
	return c.post(ctx, "/transfers/create_batch", transfers)
}

func (c *TigerBeetleClient) GetAccountBalance(ctx context.Context, accountID string) (*TBAccount, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", c.baseURL+"/accounts/"+accountID, nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("get balance: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("get balance failed: %s", string(body))
	}
	var acct TBAccount
	if err := json.Unmarshal(body, &acct); err != nil {
		return nil, err
	}
	return &acct, nil
}

func (c *TigerBeetleClient) ValidateKYCLimit(kycLevel int, amount uint64) error {
	limit, ok := KYCTransferLimits[kycLevel]
	if !ok {
		return fmt.Errorf("unknown KYC level: %d", kycLevel)
	}
	if amount > limit {
		return fmt.Errorf("amount %d exceeds KYC level %d limit of %d", amount, kycLevel, limit)
	}
	return nil
}

// CreatePremiumTransfer creates a premium collection transfer with KYC validation.
func (c *TigerBeetleClient) CreatePremiumTransfer(ctx context.Context, customerAcct, reserveAcct string, amount uint64, kycLevel int, policyID string) error {
	if err := c.ValidateKYCLimit(kycLevel, amount); err != nil {
		return err
	}
	return c.CreateTransfer(ctx, TBTransfer{
		ID:              fmt.Sprintf("prem-%s-%d", policyID, time.Now().UnixNano()),
		DebitAccountID:  customerAcct,
		CreditAccountID: reserveAcct,
		Amount:          amount,
		Ledger:          LedgerPremium,
		Code:            1,
		UserData128:     policyID,
	})
}

// CreateClaimPayout creates a claim settlement transfer.
func (c *TigerBeetleClient) CreateClaimPayout(ctx context.Context, reserveAcct, customerAcct string, amount uint64, claimID string) error {
	return c.CreateTransfer(ctx, TBTransfer{
		ID:              fmt.Sprintf("claim-%s-%d", claimID, time.Now().UnixNano()),
		DebitAccountID:  reserveAcct,
		CreditAccountID: customerAcct,
		Amount:          amount,
		Ledger:          LedgerClaims,
		Code:            2,
		UserData128:     claimID,
	})
}

// CreateCommissionTransfer creates an agent commission transfer.
func (c *TigerBeetleClient) CreateCommissionTransfer(ctx context.Context, companyAcct, agentAcct string, amount uint64, agentID string) error {
	return c.CreateTransfer(ctx, TBTransfer{
		ID:              fmt.Sprintf("comm-%s-%d", agentID, time.Now().UnixNano()),
		DebitAccountID:  companyAcct,
		CreditAccountID: agentAcct,
		Amount:          amount,
		Ledger:          LedgerCommission,
		Code:            3,
		UserData128:     agentID,
	})
}

func (c *TigerBeetleClient) post(ctx context.Context, path string, payload interface{}) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", c.baseURL+path, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("tigerbeetle %s: %w", path, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return fmt.Errorf("tigerbeetle %s failed (%d): %s", path, resp.StatusCode, string(body))
	}
	return nil
}
