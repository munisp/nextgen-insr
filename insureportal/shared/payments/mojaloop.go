package payments

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

type MojalloopClient struct {
	baseURL string
	client  *http.Client
	fspID   string
}

func NewMojalloopClient() *MojalloopClient {
	addr := os.Getenv("MOJALOOP_URL")
	if addr == "" {
		addr = "http://localhost:4001"
	}
	return &MojalloopClient{
		baseURL: addr,
		client:  &http.Client{Timeout: 30 * time.Second},
		fspID:   envOrDefault("MOJALOOP_FSP_ID", "ngapp"),
	}
}

type PartyLookup struct {
	Type string `json:"partyIdType"`
	ID   string `json:"partyIdentifier"`
}

type QuoteRequest struct {
	QuoteID       string      `json:"quoteId"`
	TransactionID string      `json:"transactionId"`
	Payer         PartyInfo   `json:"payer"`
	Payee         PartyInfo   `json:"payee"`
	AmountType    string      `json:"amountType"`
	Amount        MoneyAmount `json:"amount"`
}

type PartyInfo struct {
	PartyIDInfo PartyIDInfo `json:"partyIdInfo"`
}

type PartyIDInfo struct {
	PartyIdType    string `json:"partyIdType"`
	PartyIdentifer string `json:"partyIdentifier"`
	FspID          string `json:"fspId"`
}

type MoneyAmount struct {
	Amount   string `json:"amount"`
	Currency string `json:"currency"`
}

type TransferRequest struct {
	TransferID string      `json:"transferId"`
	PayerFsp   string      `json:"payerFsp"`
	PayeeFsp   string      `json:"payeeFsp"`
	Amount     MoneyAmount `json:"amount"`
	Condition  string      `json:"condition"`
	Expiration string      `json:"expiration"`
}

func (m *MojalloopClient) PartyLookup(ctx context.Context, idType, id string) (map[string]interface{}, error) {
	url := fmt.Sprintf("%s/parties/%s/%s", m.baseURL, idType, id)
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.interoperability.parties+json;version=1.1")
	req.Header.Set("FSPIOP-Source", m.fspID)
	req.Header.Set("Date", time.Now().UTC().Format(http.TimeFormat))

	resp, err := m.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("mojaloop party lookup: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	respBody, _ := io.ReadAll(resp.Body)
	var result map[string]interface{}
	_ = json.Unmarshal(respBody, &result)
	return result, nil
}

func (m *MojalloopClient) RequestQuote(ctx context.Context, quote QuoteRequest) (map[string]interface{}, error) {
	body, _ := json.Marshal(quote)
	url := fmt.Sprintf("%s/quotes", m.baseURL)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/vnd.interoperability.quotes+json;version=1.1")
	req.Header.Set("FSPIOP-Source", m.fspID)
	req.Header.Set("Date", time.Now().UTC().Format(http.TimeFormat))

	resp, err := m.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	respBody, _ := io.ReadAll(resp.Body)
	var result map[string]interface{}
	_ = json.Unmarshal(respBody, &result)
	return result, nil
}

func (m *MojalloopClient) ExecuteTransfer(ctx context.Context, transfer TransferRequest) (map[string]interface{}, error) {
	body, _ := json.Marshal(transfer)
	url := fmt.Sprintf("%s/transfers", m.baseURL)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/vnd.interoperability.transfers+json;version=1.1")
	req.Header.Set("FSPIOP-Source", m.fspID)
	req.Header.Set("Date", time.Now().UTC().Format(http.TimeFormat))

	resp, err := m.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	respBody, _ := io.ReadAll(resp.Body)
	var result map[string]interface{}
	_ = json.Unmarshal(respBody, &result)
	return result, nil
}

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
