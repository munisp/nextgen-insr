package bridge

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"go.uber.org/zap"
)

type MojaloopBridge struct {
	baseURL    string
	httpClient *http.Client
	logger     *zap.Logger
}

type KYCGatedTransfer struct {
	TransferID    string  `json:"transfer_id"`
	PayerFSP      string  `json:"payer_fsp"`
	PayeeFSP      string  `json:"payee_fsp"`
	PayerID       string  `json:"payer_id"`
	PayeeID       string  `json:"payee_id"`
	Amount        float64 `json:"amount"`
	Currency      string  `json:"currency"`
	KYCSessionID  string  `json:"kyc_session_id"`
	KYCLevel      int     `json:"kyc_level"`
	KYCVerified   bool    `json:"kyc_verified"`
	TransferType  string  `json:"transfer_type"`
}

type TransferLimit struct {
	KYCLevel     int     `json:"kyc_level"`
	DailyLimit   float64 `json:"daily_limit"`
	MonthlyLimit float64 `json:"monthly_limit"`
	SingleLimit  float64 `json:"single_limit"`
	Currency     string  `json:"currency"`
}

var KYCTransferLimits = []TransferLimit{
	{KYCLevel: 0, DailyLimit: 0, MonthlyLimit: 0, SingleLimit: 0, Currency: "NGN"},
	{KYCLevel: 1, DailyLimit: 50000, MonthlyLimit: 300000, SingleLimit: 20000, Currency: "NGN"},
	{KYCLevel: 2, DailyLimit: 500000, MonthlyLimit: 5000000, SingleLimit: 200000, Currency: "NGN"},
	{KYCLevel: 3, DailyLimit: 5000000, MonthlyLimit: 50000000, SingleLimit: 2000000, Currency: "NGN"},
}

type TransferResult struct {
	TransferID string `json:"transfer_id"`
	Status     string `json:"status"`
	KYCCheck   struct {
		Passed    bool   `json:"passed"`
		Level     int    `json:"level"`
		Reason    string `json:"reason"`
	} `json:"kyc_check"`
	Timestamp time.Time `json:"timestamp"`
}

func NewMojaloopBridge(logger *zap.Logger, baseURL string) (*MojaloopBridge, error) {
	if baseURL == "" {
		baseURL = "http://localhost:3000"
	}

	return &MojaloopBridge{
		baseURL:    baseURL,
		httpClient: &http.Client{Timeout: 15 * time.Second},
		logger:     logger,
	}, nil
}

func (b *MojaloopBridge) ValidateKYCForTransfer(ctx context.Context, transfer KYCGatedTransfer) (*TransferResult, error) {
	result := &TransferResult{
		TransferID: transfer.TransferID,
		Timestamp:  time.Now(),
	}

	if !transfer.KYCVerified {
		result.Status = "rejected"
		result.KYCCheck.Passed = false
		result.KYCCheck.Level = transfer.KYCLevel
		result.KYCCheck.Reason = "KYC verification required before mobile money transfer"
		b.logger.Warn("transfer_rejected_no_kyc",
			zap.String("transfer_id", transfer.TransferID),
			zap.String("payer_id", transfer.PayerID))
		return result, nil
	}

	limit := b.getLimitForLevel(transfer.KYCLevel)
	if transfer.Amount > limit.SingleLimit {
		result.Status = "rejected"
		result.KYCCheck.Passed = false
		result.KYCCheck.Level = transfer.KYCLevel
		result.KYCCheck.Reason = fmt.Sprintf("Transfer amount %.2f exceeds KYC Level %d single limit of %.2f %s",
			transfer.Amount, transfer.KYCLevel, limit.SingleLimit, limit.Currency)
		return result, nil
	}

	result.Status = "approved"
	result.KYCCheck.Passed = true
	result.KYCCheck.Level = transfer.KYCLevel
	result.KYCCheck.Reason = "KYC validation passed"

	if err := b.submitTransfer(ctx, transfer); err != nil {
		b.logger.Warn("mojaloop_transfer_submit_failed", zap.Error(err))
	}

	return result, nil
}

func (b *MojaloopBridge) submitTransfer(ctx context.Context, transfer KYCGatedTransfer) error {
	payload := map[string]interface{}{
		"transferId": transfer.TransferID,
		"payerFsp":   transfer.PayerFSP,
		"payeeFsp":   transfer.PayeeFSP,
		"amount": map[string]interface{}{
			"amount":   fmt.Sprintf("%.2f", transfer.Amount),
			"currency": transfer.Currency,
		},
		"ilpPacket":  "",
		"condition":  "",
		"expiration": time.Now().Add(30 * time.Second).UTC().Format(time.RFC3339),
		"extensionList": map[string]interface{}{
			"extension": []map[string]string{
				{"key": "kyc_session_id", "value": transfer.KYCSessionID},
				{"key": "kyc_level", "value": fmt.Sprintf("%d", transfer.KYCLevel)},
			},
		},
	}

	body, _ := json.Marshal(payload)
	url := fmt.Sprintf("%s/transfers", b.baseURL)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/vnd.interoperability.transfers+json;version=1.1")
	req.Header.Set("Date", time.Now().UTC().Format(http.TimeFormat))
	req.Header.Set("FSPIOP-Source", transfer.PayerFSP)
	req.Header.Set("FSPIOP-Destination", transfer.PayeeFSP)

	resp, err := b.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	return nil
}

func (b *MojaloopBridge) LookupParticipant(ctx context.Context, partyIDType, partyID string) (map[string]interface{}, error) {
	url := fmt.Sprintf("%s/parties/%s/%s", b.baseURL, partyIDType, partyID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.interoperability.parties+json;version=1.1")
	req.Header.Set("Date", time.Now().UTC().Format(http.TimeFormat))

	resp, err := b.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	return result, nil
}

func (b *MojaloopBridge) GetTransferLimits(kycLevel int) TransferLimit {
	return b.getLimitForLevel(kycLevel)
}

func (b *MojaloopBridge) getLimitForLevel(level int) TransferLimit {
	for _, l := range KYCTransferLimits {
		if l.KYCLevel == level {
			return l
		}
	}
	return KYCTransferLimits[0]
}
