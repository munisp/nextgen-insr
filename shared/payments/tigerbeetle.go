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

type TigerBeetleClient struct {
	baseURL string
	client  *http.Client
}

func NewTigerBeetleClient() *TigerBeetleClient {
	addr := os.Getenv("TIGERBEETLE_HTTP_URL")
	if addr == "" {
		addr = "http://localhost:3320"
	}
	return &TigerBeetleClient{
		baseURL: addr,
		client:  &http.Client{Timeout: 10 * time.Second},
	}
}

type Account struct {
	ID             uint64 `json:"id"`
	Ledger         uint32 `json:"ledger"`
	Code           uint16 `json:"code"`
	Flags          uint16 `json:"flags"`
	DebitsPending  uint64 `json:"debits_pending"`
	DebitsPosted   uint64 `json:"debits_posted"`
	CreditsPending uint64 `json:"credits_pending"`
	CreditsPosted  uint64 `json:"credits_posted"`
}

type Transfer struct {
	ID              uint64 `json:"id"`
	DebitAccountID  uint64 `json:"debit_account_id"`
	CreditAccountID uint64 `json:"credit_account_id"`
	Amount          uint64 `json:"amount"`
	Ledger          uint32 `json:"ledger"`
	Code            uint16 `json:"code"`
	Flags           uint16 `json:"flags"`
	PendingID       uint64 `json:"pending_id,omitempty"`
}

func (t *TigerBeetleClient) CreateAccounts(ctx context.Context, accounts []Account) error {
	body, _ := json.Marshal(accounts)
	url := fmt.Sprintf("%s/accounts/create", t.baseURL)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := t.client.Do(req)
	if err != nil {
		return fmt.Errorf("tigerbeetle create accounts: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	_, _ = io.ReadAll(resp.Body)
	return nil
}

func (t *TigerBeetleClient) CreateTransfers(ctx context.Context, transfers []Transfer) error {
	body, _ := json.Marshal(transfers)
	url := fmt.Sprintf("%s/transfers/create", t.baseURL)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := t.client.Do(req)
	if err != nil {
		return fmt.Errorf("tigerbeetle create transfers: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	_, _ = io.ReadAll(resp.Body)
	return nil
}

func (t *TigerBeetleClient) LookupAccounts(ctx context.Context, ids []uint64) ([]Account, error) {
	body, _ := json.Marshal(ids)
	url := fmt.Sprintf("%s/accounts/lookup", t.baseURL)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := t.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	respBody, _ := io.ReadAll(resp.Body)
	var accounts []Account
	_ = json.Unmarshal(respBody, &accounts)
	return accounts, nil
}
