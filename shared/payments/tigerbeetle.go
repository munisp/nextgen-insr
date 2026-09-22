package payments

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
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
	return parseBatchResponse(resp, "create accounts", len(accounts))
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
	return parseBatchResponse(resp, "create transfers", len(transfers))
}

// batchItemError is one failed item in a TigerBeetle create-batch response.
// TigerBeetle returns ONLY the failed items: an empty array means the whole
// batch committed. `result` is the error enum (name string or numeric code,
// depending on the gateway) — 0/"ok"/"" is treated as success defensively.
type batchItemError struct {
	Index  int             `json:"index"`
	Result json.RawMessage `json:"result"`
}

func (r batchItemError) resultString() string {
	var s string
	if err := json.Unmarshal(r.Result, &s); err == nil {
		return s
	}
	var n int
	if err := json.Unmarshal(r.Result, &n); err == nil {
		return fmt.Sprintf("code=%d", n)
	}
	return string(r.Result)
}

func (r batchItemError) isSuccess() bool {
	var s string
	if err := json.Unmarshal(r.Result, &s); err == nil {
		return s == "" || s == "ok" || s == "Ok"
	}
	var n int
	if err := json.Unmarshal(r.Result, &n); err == nil {
		return n == 0
	}
	return false
}

// parseBatchResponse enforces FAIL-CLOSED batch semantics (P-wave perf/correctness
// fix, 2026-09-19): previously the HTTP status and response body were DISCARDED
// (`_, _ = io.ReadAll(resp.Body); return nil`), silently dropping partial batch
// errors and causing ledger divergence. Now a non-2xx status or ANY per-item
// error is surfaced to the caller with the failing indices and results.
func parseBatchResponse(resp *http.Response, op string, submitted int) error {
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("tigerbeetle %s: read response: %w", op, err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		excerpt := string(body)
		if len(excerpt) > 300 {
			excerpt = excerpt[:300]
		}
		return fmt.Errorf("tigerbeetle %s: HTTP %d: %s", op, resp.StatusCode, excerpt)
	}
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) == 0 {
		return nil // no error array returned: batch committed
	}
	var itemErrors []batchItemError
	if err := json.Unmarshal(trimmed, &itemErrors); err != nil {
		// Body is not the per-item error array — fail LOUD rather than guess.
		excerpt := string(trimmed)
		if len(excerpt) > 300 {
			excerpt = excerpt[:300]
		}
		return fmt.Errorf("tigerbeetle %s: unparseable response body: %s", op, excerpt)
	}
	var failures []string
	for _, ie := range itemErrors {
		if ie.isSuccess() {
			continue
		}
		failures = append(failures, fmt.Sprintf("index %d: %s", ie.Index, ie.resultString()))
	}
	if len(failures) > 0 {
		return fmt.Errorf("tigerbeetle %s: %d of %d items rejected: %s",
			op, len(failures), submitted, strings.Join(failures, "; "))
	}
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
