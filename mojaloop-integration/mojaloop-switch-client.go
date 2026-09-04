package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/google/uuid"
)

type MojaloopClient struct {
	baseURL    string
	httpClient *http.Client
	fspiID     string
	apiKey     string
}

type Party struct {
	PartyIdType      string `json:"partyIdType"`
	PartyIdentifier  string `json:"partyIdentifier"`
	PartySubIdOrType string `json:"partySubIdOrType,omitempty"`
	FspId            string `json:"fspId,omitempty"`
}

type Money struct {
	Currency string `json:"currency"`
	Amount   string `json:"amount"`
}

type TransferRequest struct {
	TransferID string    `json:"transferId"`
	PayerFSP   string    `json:"payerFsp"`
	PayeeFSP   string    `json:"payeeFsp"`
	Amount     Money     `json:"amount"`
	ILPPacket  string    `json:"ilpPacket"`
	Condition  string    `json:"condition"`
	Expiration time.Time `json:"expiration"`
}

type TransferResponse struct {
	TransferID         string    `json:"transferId"`
	TransferState      string    `json:"transferState"`
	CompletedTimestamp time.Time `json:"completedTimestamp,omitempty"`
	Fulfilment         string    `json:"fulfilment,omitempty"`
}

type QuoteRequest struct {
	QuoteID         string          `json:"quoteId"`
	TransactionID   string          `json:"transactionId"`
	Payer           Party           `json:"payer"`
	Payee           Party           `json:"payee"`
	AmountType      string          `json:"amountType"`
	Amount          Money           `json:"amount"`
	TransactionType TransactionType `json:"transactionType"`
	Note            string          `json:"note,omitempty"`
	Expiration      time.Time       `json:"expiration"`
}

type QuoteResponse struct {
	QuoteID            string    `json:"quoteId"`
	TransferAmount     Money     `json:"transferAmount"`
	PayeeReceiveAmount Money     `json:"payeeReceiveAmount,omitempty"`
	PayeeFspFee        Money     `json:"payeeFspFee,omitempty"`
	PayeeFspCommission Money     `json:"payeeFspCommission,omitempty"`
	Expiration         time.Time `json:"expiration"`
	ILPPacket          string    `json:"ilpPacket"`
	Condition          string    `json:"condition"`
}

type TransactionType struct {
	Scenario      string      `json:"scenario"`
	SubScenario   string      `json:"subScenario,omitempty"`
	Initiator     string      `json:"initiator"`
	InitiatorType string      `json:"initiatorType"`
	RefundInfo    *RefundInfo `json:"refundInfo,omitempty"`
}

type RefundInfo struct {
	OriginalTransactionId string `json:"originalTransactionId"`
	RefundReason          string `json:"refundReason,omitempty"`
}

type PartyLookupRequest struct {
	PartyIdType      string `json:"partyIdType"`
	PartyIdentifier  string `json:"partyIdentifier"`
	PartySubIdOrType string `json:"partySubIdOrType,omitempty"`
}

type PartyLookupResponse struct {
	Party Party `json:"party"`
}

type ErrorInformation struct {
	ErrorCode        string `json:"errorCode"`
	ErrorDescription string `json:"errorDescription"`
}

func NewMojaloopClient(baseURL, fspiID, apiKey string) *MojaloopClient {
	return &MojaloopClient{
		baseURL: baseURL,
		fspiID:  fspiID,
		apiKey:  apiKey,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{
					MinVersion: tls.VersionTLS12,
				},
				MaxIdleConns:        100,
				MaxIdleConnsPerHost: 10,
				IdleConnTimeout:     90 * time.Second,
			},
		},
	}
}

func (c *MojaloopClient) LookupParty(ctx context.Context, req PartyLookupRequest) (*PartyLookupResponse, error) {
	url := fmt.Sprintf("%s/parties/%s/%s", c.baseURL, req.PartyIdType, req.PartyIdentifier)
	if req.PartySubIdOrType != "" {
		url = fmt.Sprintf("%s/%s", url, req.PartySubIdOrType)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	c.setHeaders(httpReq)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("failed to execute request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return nil, c.handleErrorResponse(resp)
	}

	var partyResp PartyLookupResponse
	if err := json.NewDecoder(resp.Body).Decode(&partyResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &partyResp, nil
}

func (c *MojaloopClient) RequestQuote(ctx context.Context, req QuoteRequest) (*QuoteResponse, error) {
	url := fmt.Sprintf("%s/quotes", c.baseURL)

	reqBody, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(reqBody))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	c.setHeaders(httpReq)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("failed to execute request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusAccepted && resp.StatusCode != http.StatusOK {
		return nil, c.handleErrorResponse(resp)
	}

	var quoteResp QuoteResponse
	if err := json.NewDecoder(resp.Body).Decode(&quoteResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &quoteResp, nil
}

func (c *MojaloopClient) PrepareTransfer(ctx context.Context, req TransferRequest) (*TransferResponse, error) {
	url := fmt.Sprintf("%s/transfers", c.baseURL)

	reqBody, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(reqBody))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	c.setHeaders(httpReq)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("failed to execute request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusAccepted && resp.StatusCode != http.StatusOK {
		return nil, c.handleErrorResponse(resp)
	}

	var transferResp TransferResponse
	if err := json.NewDecoder(resp.Body).Decode(&transferResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &transferResp, nil
}

// FulfillTransfer sends PUT /transfers/{id} with transferState COMMITTED.
// This is a PAYEE-DFSP-side operation: the fulfilment must be the real ILP
// preimage revealed by the payee. The payer-side payment flow in this
// module deliberately does NOT call it (it awaits the switch's commit
// notification and validates the revealed fulfilment instead). Callers must
// never pass a locally invented fulfilment.
func (c *MojaloopClient) FulfillTransfer(ctx context.Context, transferID, fulfilment string) error {
	url := fmt.Sprintf("%s/transfers/%s", c.baseURL, transferID)

	reqBody := map[string]string{
		"fulfilment":         fulfilment,
		"transferState":      "COMMITTED",
		"completedTimestamp": time.Now().UTC().Format(time.RFC3339),
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return fmt.Errorf("failed to marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPut, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	c.setHeaders(httpReq)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return fmt.Errorf("failed to execute request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return c.handleErrorResponse(resp)
	}

	return nil
}

func (c *MojaloopClient) GetTransferStatus(ctx context.Context, transferID string) (*TransferResponse, error) {
	url := fmt.Sprintf("%s/transfers/%s", c.baseURL, transferID)

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	c.setHeaders(httpReq)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("failed to execute request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return nil, c.handleErrorResponse(resp)
	}

	var transferResp TransferResponse
	if err := json.NewDecoder(resp.Body).Decode(&transferResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &transferResp, nil
}

func (c *MojaloopClient) setHeaders(req *http.Request) {
	req.Header.Set("Content-Type", "application/vnd.interoperability.transfers+json;version=1.1")
	req.Header.Set("Accept", "application/vnd.interoperability.transfers+json;version=1.1")
	req.Header.Set("Date", time.Now().UTC().Format(time.RFC1123))
	req.Header.Set("FSPIOP-Source", c.fspiID)
	req.Header.Set("FSPIOP-Destination", "")
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", c.apiKey))
	req.Header.Set("X-Request-ID", uuid.New().String())
}

func (c *MojaloopClient) handleErrorResponse(resp *http.Response) error {
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("request failed with status %d: %s", resp.StatusCode, err)
	}

	var errorInfo ErrorInformation
	if err := json.Unmarshal(body, &errorInfo); err != nil {
		return fmt.Errorf("request failed with status %d: %s", resp.StatusCode, string(body))
	}

	return fmt.Errorf("mojaloop error %s: %s", errorInfo.ErrorCode, errorInfo.ErrorDescription)
}

// Settlement tracking types and methods
type SettlementWindow struct {
	ID        int64     `json:"id"`
	State     string    `json:"state"`
	CreatedAt time.Time `json:"createdDate"`
	ChangedAt time.Time `json:"changedDate,omitempty"`
}

type Settlement struct {
	ID                int64                   `json:"id"`
	State             string                  `json:"state"`
	SettlementWindows []SettlementWindow      `json:"settlementWindows"`
	Participants      []SettlementParticipant `json:"participants"`
	CreatedAt         time.Time               `json:"createdDate"`
	ChangedAt         time.Time               `json:"changedDate,omitempty"`
}

type SettlementParticipant struct {
	ID       int64               `json:"id"`
	Accounts []SettlementAccount `json:"accounts"`
}

type SettlementAccount struct {
	ID            int64  `json:"id"`
	Reason        string `json:"reason,omitempty"`
	State         string `json:"state"`
	NetSettlement Money  `json:"netSettlementAmount"`
}

func (c *MojaloopClient) GetSettlementWindows(ctx context.Context, state string) ([]SettlementWindow, error) {
	url := fmt.Sprintf("%s/settlementWindows", c.baseURL)
	if state != "" {
		url = fmt.Sprintf("%s?state=%s", url, state)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	c.setHeaders(httpReq)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("settlement windows request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return nil, c.handleErrorResponse(resp)
	}

	var windows []SettlementWindow
	if err := json.NewDecoder(resp.Body).Decode(&windows); err != nil {
		return nil, fmt.Errorf("failed to decode settlement windows: %w", err)
	}
	return windows, nil
}

func (c *MojaloopClient) CloseSettlementWindow(ctx context.Context, windowID int64, reason string) (*SettlementWindow, error) {
	payload := map[string]interface{}{
		"state":  "CLOSED",
		"reason": reason,
	}
	body, _ := json.Marshal(payload)
	url := fmt.Sprintf("%s/settlementWindows/%d", c.baseURL, windowID)

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	c.setHeaders(httpReq)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("close settlement window failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return nil, c.handleErrorResponse(resp)
	}

	var window SettlementWindow
	if err := json.NewDecoder(resp.Body).Decode(&window); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}
	return &window, nil
}

func (c *MojaloopClient) CreateSettlement(ctx context.Context, windowIDs []int64, reason string) (*Settlement, error) {
	windows := make([]map[string]interface{}, len(windowIDs))
	for i, wid := range windowIDs {
		windows[i] = map[string]interface{}{"id": wid}
	}
	payload := map[string]interface{}{
		"reason":            reason,
		"settlementWindows": windows,
	}
	body, _ := json.Marshal(payload)
	url := fmt.Sprintf("%s/settlements", c.baseURL)

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	c.setHeaders(httpReq)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("create settlement failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return nil, c.handleErrorResponse(resp)
	}

	var settlement Settlement
	if err := json.NewDecoder(resp.Body).Decode(&settlement); err != nil {
		return nil, fmt.Errorf("failed to decode settlement: %w", err)
	}
	return &settlement, nil
}

func (c *MojaloopClient) GetSettlement(ctx context.Context, settlementID int64) (*Settlement, error) {
	url := fmt.Sprintf("%s/settlements/%d", c.baseURL, settlementID)

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	c.setHeaders(httpReq)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("get settlement failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return nil, c.handleErrorResponse(resp)
	}

	var settlement Settlement
	if err := json.NewDecoder(resp.Body).Decode(&settlement); err != nil {
		return nil, fmt.Errorf("failed to decode settlement: %w", err)
	}
	return &settlement, nil
}

// ── ILP fulfilment validation ────────────────────────────────────────────────
//
// HONESTY (DD-TB remediation): the previous implementation FABRICATED ILP
// packets, conditions and fulfilments as string concatenations
// ("fulfilment_<condition>"). Those helpers are removed. In the Mojaloop
// FSPIOP protocol:
//   - the ILP packet and condition are produced by the PAYEE DFSP and arrive
//     in the quote response (quoteResp.ILPPacket / quoteResp.Condition);
//   - the fulfilment is the cryptographic preimage of the condition, known
//     only to the payee DFSP, and is revealed via the switch's transfer
//     commit notification (GET /transfers/{id} → TransferResponse.Fulfilment).
// A payer DFSP can NEVER generate a fulfilment — it can only validate one.

// ValidateFulfilment cryptographically verifies an ILP fulfilment against a
// condition: base64url-decode both and check SHA-256(fulfilment) == condition.
// Returns nil only when the proof holds. Any deviation (bad encoding, wrong
// length, hash mismatch) is an error — callers must treat it as "transfer
// NOT validly fulfilled".
func ValidateFulfilment(fulfilmentB64, conditionB64 string) error {
	fulfilment, err := decodeILPBase64(fulfilmentB64)
	if err != nil {
		return fmt.Errorf("invalid fulfilment encoding: %w", err)
	}
	condition, err := decodeILPBase64(conditionB64)
	if err != nil {
		return fmt.Errorf("invalid condition encoding: %w", err)
	}
	if len(fulfilment) != 32 {
		return fmt.Errorf("invalid fulfilment length %d (ILP requires 32 bytes)", len(fulfilment))
	}
	if len(condition) != 32 {
		return fmt.Errorf("invalid condition length %d (ILP requires 32 bytes)", len(condition))
	}
	digest := sha256.Sum256(fulfilment)
	if !bytes.Equal(digest[:], condition) {
		return fmt.Errorf("fulfilment does not satisfy condition (SHA-256 preimage mismatch)")
	}
	return nil
}

// decodeILPBase64 decodes ILP base64url, tolerating padded/unpadded and
// standard-alphabet variants seen across DFSP implementations.
func decodeILPBase64(s string) ([]byte, error) {
	if b, err := base64.RawURLEncoding.DecodeString(s); err == nil {
		return b, nil
	}
	if b, err := base64.URLEncoding.DecodeString(s); err == nil {
		return b, nil
	}
	return base64.StdEncoding.DecodeString(s)
}
