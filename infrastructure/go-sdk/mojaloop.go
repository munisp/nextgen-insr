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

type MojaloopClient struct {
	baseURL    string
	httpClient *http.Client
	logger     *zap.Logger
	fspID      string
}

type MojaloopTransfer struct {
	TransferID    string `json:"transferId"`
	PayerFSP      string `json:"payerFsp"`
	PayeeFSP      string `json:"payeeFsp"`
	Amount        string `json:"amount"`
	Currency      string `json:"currency"`
	PayerID       string `json:"payerId"`
	PayeeID       string `json:"payeeId"`
	KYCLevel      int    `json:"kycLevel"`
	IdempotencyKey string `json:"idempotencyKey,omitempty"`
}

type MojaloopQuote struct {
	QuoteID       string `json:"quoteId"`
	TransferAmount string `json:"transferAmount"`
	PayeeFee      string `json:"payeeFspFee"`
	Commission    string `json:"payeeFspCommission"`
	Condition     string `json:"condition"`
	Expiration    string `json:"expiration"`
}

// TransferLimits per KYC level (NGN)
var MojaloopKYCLimits = map[int]float64{
	0: 5000,
	1: 50000,
	2: 500000,
	3: 10000000,
}

func NewMojaloopClient(logger *zap.Logger, baseURL string) *MojaloopClient {
	return &MojaloopClient{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 15 * time.Second,
		},
		logger: logger,
		fspID:  "ngapp-insurance",
	}
}

func (c *MojaloopClient) Ping(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, "GET", c.baseURL+"/health", nil)
	if err != nil {
		return err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("mojaloop ping: %w", err)
	}
	defer resp.Body.Close()
	return nil
}

func (c *MojaloopClient) fspiopHeaders() map[string]string {
	return map[string]string{
		"Content-Type":    "application/vnd.interoperability.transfers+json;version=1.1",
		"Accept":          "application/vnd.interoperability.transfers+json;version=1.1",
		"FSPIOP-Source":   c.fspID,
		"Date":            time.Now().UTC().Format(http.TimeFormat),
	}
}

func (c *MojaloopClient) LookupParticipant(ctx context.Context, idType, idValue string) (string, error) {
	url := fmt.Sprintf("%s/participants/%s/%s", c.baseURL, idType, idValue)
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return "", err
	}
	for k, v := range c.fspiopHeaders() {
		req.Header.Set(k, v)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("participant lookup: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var result map[string]interface{}
	json.Unmarshal(body, &result)
	if fsp, ok := result["fspId"].(string); ok {
		return fsp, nil
	}
	return "", fmt.Errorf("participant not found: %s/%s", idType, idValue)
}

func (c *MojaloopClient) RequestQuote(ctx context.Context, transfer MojaloopTransfer) (*MojaloopQuote, error) {
	data, _ := json.Marshal(map[string]interface{}{
		"quoteId":        fmt.Sprintf("q-%d", time.Now().UnixNano()),
		"transactionId":  transfer.TransferID,
		"payee":          map[string]string{"fspId": transfer.PayeeFSP, "partyIdType": "MSISDN", "partyIdentifier": transfer.PayeeID},
		"payer":          map[string]string{"fspId": transfer.PayerFSP, "partyIdType": "MSISDN", "partyIdentifier": transfer.PayerID},
		"amountType":     "SEND",
		"amount":         map[string]string{"amount": transfer.Amount, "currency": transfer.Currency},
		"transactionType": map[string]string{"scenario": "TRANSFER", "initiator": "PAYER", "initiatorType": "CONSUMER"},
	})
	req, err := http.NewRequestWithContext(ctx, "POST", c.baseURL+"/quotes", bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	for k, v := range c.fspiopHeaders() {
		req.Header.Set(k, v)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("quote request: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var quote MojaloopQuote
	json.Unmarshal(body, &quote)
	return &quote, nil
}

func (c *MojaloopClient) ExecuteTransfer(ctx context.Context, transfer MojaloopTransfer) error {
	limit, ok := MojaloopKYCLimits[transfer.KYCLevel]
	if !ok {
		return fmt.Errorf("invalid KYC level: %d", transfer.KYCLevel)
	}
	var amount float64
	fmt.Sscanf(transfer.Amount, "%f", &amount)
	if amount > limit {
		return fmt.Errorf("transfer amount %.2f exceeds KYC level %d limit of %.2f", amount, transfer.KYCLevel, limit)
	}

	data, _ := json.Marshal(map[string]interface{}{
		"transferId":  transfer.TransferID,
		"payerFsp":    transfer.PayerFSP,
		"payeeFsp":    transfer.PayeeFSP,
		"amount":      map[string]string{"amount": transfer.Amount, "currency": transfer.Currency},
		"ilpPacket":   "",
		"condition":   "",
		"expiration":  time.Now().Add(30 * time.Second).UTC().Format(time.RFC3339),
	})
	req, err := http.NewRequestWithContext(ctx, "POST", c.baseURL+"/transfers", bytes.NewReader(data))
	if err != nil {
		return err
	}
	for k, v := range c.fspiopHeaders() {
		req.Header.Set(k, v)
	}
	if transfer.IdempotencyKey != "" {
		req.Header.Set("X-Idempotency-Key", transfer.IdempotencyKey)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("transfer execution: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("transfer failed (%d): %s", resp.StatusCode, string(body))
	}
	return nil
}

// CollectPremiumViaMobileMoney collects premium payment via Mojaloop mobile money.
func (c *MojaloopClient) CollectPremiumViaMobileMoney(ctx context.Context, customerPhone, amount, currency string, kycLevel int, policyID string) error {
	return c.ExecuteTransfer(ctx, MojaloopTransfer{
		TransferID:     fmt.Sprintf("prem-%s-%d", policyID, time.Now().UnixNano()),
		PayerFSP:       "mobile-money-provider",
		PayeeFSP:       c.fspID,
		Amount:         amount,
		Currency:       currency,
		PayerID:        customerPhone,
		PayeeID:        "insurance-reserve",
		KYCLevel:       kycLevel,
		IdempotencyKey: fmt.Sprintf("prem-%s", policyID),
	})
}

// PayoutClaim pays out a claim via Mojaloop.
func (c *MojaloopClient) PayoutClaim(ctx context.Context, customerPhone, amount, currency string, claimID string) error {
	return c.ExecuteTransfer(ctx, MojaloopTransfer{
		TransferID:     fmt.Sprintf("payout-%s-%d", claimID, time.Now().UnixNano()),
		PayerFSP:       c.fspID,
		PayeeFSP:       "mobile-money-provider",
		Amount:         amount,
		Currency:       currency,
		PayerID:        "insurance-reserve",
		PayeeID:        customerPhone,
		KYCLevel:       3,
		IdempotencyKey: fmt.Sprintf("payout-%s", claimID),
	})
}
