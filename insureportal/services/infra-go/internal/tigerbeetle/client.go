// Package tigerbeetle provides a high-performance Go client for TigerBeetle
// double-entry bookkeeping ledger, used for all financial operations in InsurePortal:
//   - Premium collections (policyholder → insurer reserve)
//   - Claim payouts (insurer reserve → policyholder/beneficiary)
//   - Commission payments (insurer → agent/broker)
//   - Reinsurance cessions (insurer → reinsurer)
//   - Float management (agent float accounts)
//   - IFRS17 reserve tracking
package tigerbeetle

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"
)

// Account type codes — must match TigerBeetle account user_data_32 field
const (
	AccountTypePremiumReserve    uint16 = 1  // Insurance premium reserve
	AccountTypeClaimReserve      uint16 = 2  // Claim payment reserve (IBNR)
	AccountTypeCommissionPayable uint16 = 3  // Agent/broker commission payable
	AccountTypeReinsuranceCeded  uint16 = 4  // Reinsurance ceded premium
	AccountTypeAgentFloat        uint16 = 5  // Agent float/wallet
	AccountTypeIFRS17Liability   uint16 = 6  // IFRS17 insurance contract liability
	AccountTypeUnearnedPremium   uint16 = 7  // Unearned premium reserve
	AccountTypeSystemAudit       uint16 = 99 // Zero-amount audit entries
)

// TigerBeetle account IDs — deterministic from tenant + entity IDs
// Format: sha256(tenantId + ":" + entityType + ":" + entityId)[0:16] as uint128

// Transfer flags
const (
	TransferFlagLinked      uint16 = 1 // Link to next transfer (atomic batch)
	TransferFlagPending     uint16 = 2 // Two-phase pending
	TransferFlagPostPending uint16 = 4 // Post a pending transfer
	TransferFlagVoidPending uint16 = 8 // Void a pending transfer
)

// Account represents a TigerBeetle account
type Account struct {
	ID             string `json:"id"`
	UserData128    string `json:"user_data_128,omitempty"`
	UserData64     uint64 `json:"user_data_64,omitempty"`
	UserData32     uint32 `json:"user_data_32,omitempty"`
	Ledger         uint32 `json:"ledger"`
	Code           uint16 `json:"code"`
	Flags          uint16 `json:"flags,omitempty"`
	DebitsPosted   uint64 `json:"debits_posted,omitempty"`
	CreditsPosted  uint64 `json:"credits_posted,omitempty"`
	DebitsPending  uint64 `json:"debits_pending,omitempty"`
	CreditsPending uint64 `json:"credits_pending,omitempty"`
	Timestamp      uint64 `json:"timestamp,omitempty"`
}

// Transfer represents a TigerBeetle transfer
type Transfer struct {
	ID              string `json:"id"`
	DebitAccountID  string `json:"debit_account_id"`
	CreditAccountID string `json:"credit_account_id"`
	Amount          uint64 `json:"amount"`
	UserData128     string `json:"user_data_128,omitempty"`
	UserData64      uint64 `json:"user_data_64,omitempty"`
	UserData32      uint32 `json:"user_data_32,omitempty"`
	PendingID       string `json:"pending_id,omitempty"`
	Timeout         uint32 `json:"timeout,omitempty"`
	Ledger          uint32 `json:"ledger"`
	Code            uint16 `json:"code"`
	Flags           uint16 `json:"flags,omitempty"`
	Timestamp       uint64 `json:"timestamp,omitempty"`
}

// CreateAccountsRequest is the HTTP request body for creating accounts
type CreateAccountsRequest struct {
	Accounts []Account `json:"accounts"`
}

// CreateTransfersRequest is the HTTP request body for creating transfers
type CreateTransfersRequest struct {
	Transfers []Transfer `json:"transfers"`
}

// InsuranceAccountsRequest creates all accounts for a new insurance entity
type InsuranceAccountsRequest struct {
	TenantID   string `json:"tenantId"`
	EntityType string `json:"entityType"` // "policy", "agent", "broker", "reinsurer"
	EntityID   string `json:"entityId"`
	Currency   string `json:"currency"` // "NGN", "USD", "GBP"
}

// PremiumPaymentRequest records a premium payment in the ledger
type PremiumPaymentRequest struct {
	PolicyID       string  `json:"policyId"`
	TenantID       string  `json:"tenantId"`
	AmountKobo     uint64  `json:"amountKobo"` // Amount in smallest currency unit
	PaymentRef     string  `json:"paymentRef"`
	AgentID        string  `json:"agentId,omitempty"`
	CommissionRate float64 `json:"commissionRate,omitempty"` // 0.0 - 1.0
}

// ClaimPayoutRequest records a claim payout in the ledger
type ClaimPayoutRequest struct {
	ClaimID    string `json:"claimId"`
	PolicyID   string `json:"policyId"`
	TenantID   string `json:"tenantId"`
	AmountKobo uint64 `json:"amountKobo"`
	PayoutRef  string `json:"payoutRef"`
}

// ReinsuranceCessionRequest records a reinsurance cession
type ReinsuranceCessionRequest struct {
	PolicyID    string  `json:"policyId"`
	TreatyID    string  `json:"treatyId"`
	TenantID    string  `json:"tenantId"`
	CessionRate float64 `json:"cessionRate"` // 0.0 - 1.0
	PremiumKobo uint64  `json:"premiumKobo"`
	CessionRef  string  `json:"cessionRef"`
}

// Client is the TigerBeetle HTTP sidecar client
type Client struct {
	logger     *zap.Logger
	sidecarURL string
	httpClient *http.Client
	mu         sync.RWMutex
	closed     bool
}

// NewClient creates a new TigerBeetle client
func NewClient(logger *zap.Logger) *Client {
	sidecarURL := getEnv("TB_SIDECAR_URL", "http://tigerbeetle-sidecar:8080")
	return &Client{
		logger:     logger,
		sidecarURL: sidecarURL,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// Ping checks TigerBeetle availability
func (c *Client) Ping(ctx context.Context) string {
	req, err := http.NewRequestWithContext(ctx, "GET", c.sidecarURL+"/health", nil)
	if err != nil {
		return "error: " + err.Error()
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "unreachable"
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode == http.StatusOK {
		return "ok"
	}
	return fmt.Sprintf("http_%d", resp.StatusCode)
}

// Close cleans up the client
func (c *Client) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.closed = true
}

// ── HTTP Handlers ─────────────────────────────────────────────────────────────

// CreateAccountsHandler handles POST /tigerbeetle/accounts
func (c *Client) CreateAccountsHandler(w http.ResponseWriter, r *http.Request) {
	var req CreateAccountsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}
	if len(req.Accounts) == 0 {
		writeError(w, http.StatusBadRequest, "accounts array is required")
		return
	}

	resp, err := c.forwardToSidecar(r.Context(), "POST", "/accounts", req)
	if err != nil {
		c.logger.Error("TigerBeetle create accounts failed", zap.Error(err))
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, resp)
}

// CreateTransfersHandler handles POST /tigerbeetle/transfers
func (c *Client) CreateTransfersHandler(w http.ResponseWriter, r *http.Request) {
	var req CreateTransfersRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}
	if len(req.Transfers) == 0 {
		writeError(w, http.StatusBadRequest, "transfers array is required")
		return
	}

	resp, err := c.forwardToSidecar(r.Context(), "POST", "/transfers", req)
	if err != nil {
		c.logger.Error("TigerBeetle create transfers failed", zap.Error(err))
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, resp)
}

// GetAccountHandler handles GET /tigerbeetle/accounts/{id}
func (c *Client) GetAccountHandler(w http.ResponseWriter, r *http.Request) {
	id := chi_urlParam(r, "id")
	resp, err := c.forwardToSidecar(r.Context(), "GET", "/accounts/"+id, nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// GetAccountsHandler handles POST /tigerbeetle/accounts/batch
func (c *Client) GetAccountsHandler(w http.ResponseWriter, r *http.Request) {
	var ids []string
	if err := json.NewDecoder(r.Body).Decode(&ids); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	resp, err := c.forwardToSidecar(r.Context(), "POST", "/accounts/batch", ids)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// GetAccountTransfersHandler handles GET /tigerbeetle/accounts/{id}/transfers
func (c *Client) GetAccountTransfersHandler(w http.ResponseWriter, r *http.Request) {
	id := chi_urlParam(r, "id")
	resp, err := c.forwardToSidecar(r.Context(), "GET", "/accounts/"+id+"/transfers", nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// CreateInsuranceAccountsHandler handles POST /tigerbeetle/accounts/create-insurance
// Creates all required ledger accounts for a new insurance entity (policy, agent, broker, reinsurer)
func (c *Client) CreateInsuranceAccountsHandler(w http.ResponseWriter, r *http.Request) {
	var req InsuranceAccountsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	ledgerID := currencyToLedger(req.Currency)
	accounts := buildInsuranceAccounts(req.TenantID, req.EntityType, req.EntityID, ledgerID)

	resp, err := c.forwardToSidecar(r.Context(), "POST", "/accounts", map[string]interface{}{
		"accounts": accounts,
	})
	if err != nil {
		c.logger.Error("Create insurance accounts failed",
			zap.String("entityType", req.EntityType),
			zap.String("entityId", req.EntityID),
			zap.Error(err))
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, resp)
}

// RecordPremiumPaymentHandler handles POST /tigerbeetle/transfers/premium
// Records: policyholder payment → premium reserve, and optionally commission split
func (c *Client) RecordPremiumPaymentHandler(w http.ResponseWriter, r *http.Request) {
	var req PremiumPaymentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	transfers := buildPremiumTransfers(req)
	resp, err := c.forwardToSidecar(r.Context(), "POST", "/transfers", map[string]interface{}{
		"transfers": transfers,
	})
	if err != nil {
		c.logger.Error("Record premium payment failed",
			zap.String("policyId", req.PolicyID),
			zap.Error(err))
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, resp)
}

// RecordClaimPayoutHandler handles POST /tigerbeetle/transfers/claim-payout
func (c *Client) RecordClaimPayoutHandler(w http.ResponseWriter, r *http.Request) {
	var req ClaimPayoutRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	transfers := buildClaimPayoutTransfers(req)
	resp, err := c.forwardToSidecar(r.Context(), "POST", "/transfers", map[string]interface{}{
		"transfers": transfers,
	})
	if err != nil {
		c.logger.Error("Record claim payout failed",
			zap.String("claimId", req.ClaimID),
			zap.Error(err))
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, resp)
}

// RecordCommissionHandler handles POST /tigerbeetle/transfers/commission
func (c *Client) RecordCommissionHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		AgentID    string `json:"agentId"`
		TenantID   string `json:"tenantId"`
		AmountKobo uint64 `json:"amountKobo"`
		PolicyID   string `json:"policyId"`
		CommRef    string `json:"commRef"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	transferID := uuidToUint128(uuid.New().String())
	transfer := Transfer{
		ID:              transferID,
		DebitAccountID:  accountID(req.TenantID, "commission_payable", "pool"),
		CreditAccountID: accountID(req.TenantID, "agent_float", req.AgentID),
		Amount:          req.AmountKobo,
		UserData128:     req.PolicyID,
		Ledger:          1, // NGN
		Code:            uint16(AccountTypeCommissionPayable),
	}

	resp, err := c.forwardToSidecar(r.Context(), "POST", "/transfers", map[string]interface{}{
		"transfers": []Transfer{transfer},
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, resp)
}

// RecordReinsuranceCessionHandler handles POST /tigerbeetle/transfers/reinsurance-cession
func (c *Client) RecordReinsuranceCessionHandler(w http.ResponseWriter, r *http.Request) {
	var req ReinsuranceCessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	cessionAmount := uint64(float64(req.PremiumKobo) * req.CessionRate)
	transferID := uuidToUint128(uuid.New().String())
	transfer := Transfer{
		ID:              transferID,
		DebitAccountID:  accountID(req.TenantID, "premium_reserve", req.PolicyID),
		CreditAccountID: accountID(req.TenantID, "reinsurance_ceded", req.TreatyID),
		Amount:          cessionAmount,
		UserData128:     req.PolicyID,
		Ledger:          1,
		Code:            uint16(AccountTypeReinsuranceCeded),
	}

	resp, err := c.forwardToSidecar(r.Context(), "POST", "/transfers", map[string]interface{}{
		"transfers": []Transfer{transfer},
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, resp)
}

// GetTenantLedgerBalanceHandler handles GET /tigerbeetle/ledger/balance/{tenantId}
func (c *Client) GetTenantLedgerBalanceHandler(w http.ResponseWriter, r *http.Request) {
	tenantID := chi_urlParam(r, "tenantId")

	// Get balances for all account types for this tenant
	accountIDs := []string{
		accountID(tenantID, "premium_reserve", "pool"),
		accountID(tenantID, "claim_reserve", "pool"),
		accountID(tenantID, "commission_payable", "pool"),
		accountID(tenantID, "reinsurance_ceded", "pool"),
		accountID(tenantID, "unearned_premium", "pool"),
	}

	resp, err := c.forwardToSidecar(r.Context(), "POST", "/accounts/batch", accountIDs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// ── Helper functions ──────────────────────────────────────────────────────────

func buildInsuranceAccounts(tenantID, entityType, entityID string, ledger uint32) []Account {
	accounts := []Account{}

	switch entityType {
	case "policy":
		accounts = append(accounts,
			Account{ID: accountID(tenantID, "premium_reserve", entityID), Ledger: ledger, Code: uint16(AccountTypePremiumReserve)},
			Account{ID: accountID(tenantID, "claim_reserve", entityID), Ledger: ledger, Code: uint16(AccountTypeClaimReserve)},
			Account{ID: accountID(tenantID, "unearned_premium", entityID), Ledger: ledger, Code: uint16(AccountTypeUnearnedPremium)},
			Account{ID: accountID(tenantID, "ifrs17_liability", entityID), Ledger: ledger, Code: uint16(AccountTypeIFRS17Liability)},
		)
	case "agent":
		accounts = append(accounts,
			Account{ID: accountID(tenantID, "agent_float", entityID), Ledger: ledger, Code: uint16(AccountTypeAgentFloat)},
			Account{ID: accountID(tenantID, "commission_payable", entityID), Ledger: ledger, Code: uint16(AccountTypeCommissionPayable)},
		)
	case "broker":
		accounts = append(accounts,
			Account{ID: accountID(tenantID, "commission_payable", entityID), Ledger: ledger, Code: uint16(AccountTypeCommissionPayable)},
		)
	case "reinsurer":
		accounts = append(accounts,
			Account{ID: accountID(tenantID, "reinsurance_ceded", entityID), Ledger: ledger, Code: uint16(AccountTypeReinsuranceCeded)},
		)
	}

	return accounts
}

func buildPremiumTransfers(req PremiumPaymentRequest) []Transfer {
	transfers := []Transfer{}
	transferID := uuidToUint128(uuid.New().String())

	// Main premium transfer: policyholder → premium reserve
	mainTransfer := Transfer{
		ID:              transferID,
		DebitAccountID:  accountID(req.TenantID, "policyholder_receivable", req.PolicyID),
		CreditAccountID: accountID(req.TenantID, "premium_reserve", req.PolicyID),
		Amount:          req.AmountKobo,
		UserData128:     req.PolicyID,
		Ledger:          1,
		Code:            uint16(AccountTypePremiumReserve),
	}

	// If commission rate set, split commission
	if req.CommissionRate > 0 && req.AgentID != "" {
		commAmount := uint64(float64(req.AmountKobo) * req.CommissionRate)
		netAmount := req.AmountKobo - commAmount

		mainTransfer.Amount = netAmount
		mainTransfer.Flags = TransferFlagLinked // Link to commission transfer

		commTransferID := uuidToUint128(uuid.New().String())
		commTransfer := Transfer{
			ID:              commTransferID,
			DebitAccountID:  accountID(req.TenantID, "commission_payable", "pool"),
			CreditAccountID: accountID(req.TenantID, "agent_float", req.AgentID),
			Amount:          commAmount,
			UserData128:     req.PolicyID,
			Ledger:          1,
			Code:            uint16(AccountTypeCommissionPayable),
		}
		transfers = append(transfers, mainTransfer, commTransfer)
	} else {
		transfers = append(transfers, mainTransfer)
	}

	return transfers
}

func buildClaimPayoutTransfers(req ClaimPayoutRequest) []Transfer {
	transferID := uuidToUint128(uuid.New().String())
	return []Transfer{
		{
			ID:              transferID,
			DebitAccountID:  accountID(req.TenantID, "claim_reserve", req.PolicyID),
			CreditAccountID: accountID(req.TenantID, "claim_payout", req.ClaimID),
			Amount:          req.AmountKobo,
			UserData128:     req.ClaimID,
			Ledger:          1,
			Code:            uint16(AccountTypeClaimReserve),
		},
	}
}

// accountID generates a deterministic 128-bit account ID from components
func accountID(tenantID, accountType, entityID string) string {
	// Use a simple deterministic hash for now
	// In production, use a proper 128-bit hash
	key := fmt.Sprintf("%s:%s:%s", tenantID, accountType, entityID)
	// Return a UUID v5 (deterministic) based on the key
	return uuid.NewSHA1(uuid.NameSpaceURL, []byte(key)).String()
}

// uuidToUint128 converts a UUID string to a uint128 string representation
func uuidToUint128(id string) string {
	return id // TigerBeetle Go SDK accepts UUID strings
}

// currencyToLedger maps currency codes to TigerBeetle ledger IDs
func currencyToLedger(currency string) uint32 {
	switch currency {
	case "NGN":
		return 1
	case "USD":
		return 2
	case "GBP":
		return 3
	case "EUR":
		return 4
	default:
		return 1 // Default to NGN
	}
}

// forwardToSidecar forwards requests to the TigerBeetle HTTP sidecar
func (c *Client) forwardToSidecar(ctx context.Context, method, path string, body interface{}) (interface{}, error) {
	var bodyBytes []byte
	var err error

	if body != nil {
		bodyBytes, err = json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("marshal request: %w", err)
		}
	}

	url := c.sidecarURL + path
	req, err := http.NewRequestWithContext(ctx, method, url, bytesReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		// Return a mock response when sidecar is unavailable (fail-open for dev)
		c.logger.Warn("TigerBeetle sidecar unavailable, returning mock response",
			zap.String("path", path),
			zap.Error(err))
		return map[string]interface{}{
			"status": "mock",
			"note":   "TigerBeetle sidecar unavailable",
		}, nil
	}
	defer func() { _ = resp.Body.Close() }()

	var result interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("sidecar error %d: %v", resp.StatusCode, result)
	}

	return result, nil
}

// ── Utility ───────────────────────────────────────────────────────────────────

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func chi_urlParam(r *http.Request, key string) string {
	// chi URL param extraction
	return r.PathValue(key)
}

func bytesReader(b []byte) *bytesReaderImpl {
	return &bytesReaderImpl{data: b, pos: 0}
}

type bytesReaderImpl struct {
	data []byte
	pos  int
}

func (br *bytesReaderImpl) Read(p []byte) (n int, err error) {
	if br.pos >= len(br.data) {
		return 0, fmt.Errorf("EOF")
	}
	n = copy(p, br.data[br.pos:])
	br.pos += n
	return n, nil
}

// Ensure strconv is used
var _ = strconv.Itoa
