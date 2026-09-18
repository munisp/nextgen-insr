package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/insureportal/nigerian-bank-integrations/config"
)

// nibssClient is a real HTTP adapter for NIBSS NIP operations (NG-7).
// It performs genuine name-enquiry and funds-transfer calls; callers must
// fail CLOSED on any error — a transfer is never marked "success" locally.
type nibssClient struct {
	baseURL string
	apiKey  string
	http    *http.Client
}

func newNIBSSClient(cfg config.BankConfig) *nibssClient {
	return &nibssClient{
		baseURL: cfg.NIBSSBaseURL,
		apiKey:  cfg.NIBSSAPIKey,
		http:    &http.Client{Timeout: cfg.NIBSSTimeout},
	}
}

func (c *nibssClient) configured() bool { return c != nil && c.baseURL != "" }

func (c *nibssClient) do(ctx context.Context, method, path string, body interface{}, out interface{}) error {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, rdr)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("nibss %s %s: %w", method, path, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("nibss %s %s: HTTP %d: %s", method, path, resp.StatusCode, string(b))
	}
	if out != nil {
		return json.NewDecoder(resp.Body).Decode(out)
	}
	return nil
}

// NameEnquiry resolves an account holder name at the destination bank before
// any debit happens.
func (c *nibssClient) NameEnquiry(ctx context.Context, accountNumber, bankCode string) (name, bankName string, err error) {
	var out struct {
		AccountName string `json:"account_name"`
		BankName    string `json:"bank_name"`
	}
	err = c.do(ctx, http.MethodPost, "/api/v1/name-enquiry", map[string]string{
		"account_number": accountNumber,
		"bank_code":      bankCode,
	}, &out)
	if err != nil {
		return "", "", err
	}
	if out.AccountName == "" {
		return "", "", fmt.Errorf("nibss name enquiry returned empty account name")
	}
	return out.AccountName, out.BankName, nil
}

// NIPTransfer submits the real funds transfer. The reference is the
// idempotency key on the NIBSS side.
func (c *nibssClient) NIPTransfer(ctx context.Context, payload map[string]interface{}) (status string, err error) {
	var out struct {
		Status string `json:"status"`
	}
	if err := c.do(ctx, http.MethodPost, "/api/v1/nip/transfer", payload, &out); err != nil {
		return "", err
	}
	if out.Status == "" {
		return "", fmt.Errorf("nibss transfer returned empty status")
	}
	return out.Status, nil
}

// RequeryTransfer re-queries a transfer's status (used after a timeout —
// timeout-ambiguity MUST be resolved before any retry).
func (c *nibssClient) RequeryTransfer(ctx context.Context, reference string) (status string, err error) {
	var out struct {
		Status string `json:"status"`
	}
	if err := c.do(ctx, http.MethodGet, "/api/v1/nip/transfers/"+reference, nil, &out); err != nil {
		return "", err
	}
	return out.Status, nil
}

// generateTransferReference creates a collision-safe, crypto-random reference
// (NG-7: UnixNano()%1e9 was collision-prone).
func generateTransferReference() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return "NIP-" + hex.EncodeToString(b)
}
