// pos-ledger-sync — Go sidecar for 54Link POS Shell
//
// Provides:
// 1. Durable double-entry ledger persisted to PostgreSQL
// 2. Health aggregator (checks all sidecars + main app)
// 3. Transaction lifecycle tracking (in-memory, ephemeral orchestration state)
// 4. Settlement batch creation (status pending_settlement — batches are only
//    marked "settled" after an external settlement rail confirms; this
//    service performs no rail calls and never claims a settlement that did
//    not happen)
// 5. Float balance tracking (derived from the persisted ledger)
// 6. Reconciliation (account_balances vs. recomputation from ledger_entries)
//
// DURABILITY POSTURE (DD-TB remediation):
// Every money record is written to PostgreSQL inside a transaction before a
// "committed" response is returned. If the database is not connected, all
// money-path endpoints fail LOUD with 503 — nothing is reported committed
// from volatile memory. Only stats counters and lifecycle tracking remain
// in-memory (ephemeral, non-money state).
//
// Listens on port 9200 (configurable via GO_LEDGER_PORT).

package main

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	_ "github.com/lib/pq"
)

// ── Data Structures ──────────────────────────────────────────────────────────

type LedgerEntry struct {
	ID              string                 `json:"id"`
	DebitAccountID  string                 `json:"debit_account_id"`
	CreditAccountID string                 `json:"credit_account_id"`
	Amount          int64                  `json:"amount"`
	Currency        string                 `json:"currency"`
	LedgerCode      int                    `json:"ledger_code"`
	TransferCode    int                    `json:"transfer_code"`
	Pending         bool                   `json:"pending"`
	Timestamp       int64                  `json:"timestamp"`
	Metadata        map[string]interface{} `json:"metadata"`
}

type AccountBalance struct {
	AccountID      string `json:"account_id"`
	DebitsPosted   int64  `json:"debits_posted"`
	CreditsPosted  int64  `json:"credits_posted"`
	DebitsPending  int64  `json:"debits_pending"`
	CreditsPending int64  `json:"credits_pending"`
	Balance        int64  `json:"balance"`
	Currency       string `json:"currency"`
	LastUpdated    int64  `json:"last_updated"`
}

type SettlementBatch struct {
	ID            string   `json:"id"`
	Status        string   `json:"status"` // "pending_settlement" until a rail confirms
	TotalAmount   int64    `json:"total_amount"`
	TransferCount int      `json:"transfer_count"`
	TransferIDs   []string `json:"transfer_ids"`
	CreatedAt     int64    `json:"created_at"`
	SettledAt     int64    `json:"settled_at,omitempty"`
}

type HealthCheck struct {
	Service   string `json:"service"`
	Status    string `json:"status"`
	Latency   int64  `json:"latency_ms"`
	Timestamp int64  `json:"timestamp"`
}

type AggregatedHealth struct {
	Overall   string        `json:"overall"`
	Services  []HealthCheck `json:"services"`
	Timestamp int64         `json:"timestamp"`
	UptimeSec int64         `json:"uptime_seconds"`
}

type ReconciliationResult struct {
	ID             string `json:"id"`
	Status         string `json:"status"`
	MatchedCount   int    `json:"matched_count"`
	UnmatchedCount int    `json:"unmatched_count"`
	DiscrepancyAmt int64  `json:"discrepancy_amount"`
	Timestamp      int64  `json:"timestamp"`
}

type TransactionLifecycle struct {
	TransactionID string            `json:"transaction_id"`
	CurrentState  string            `json:"current_state"`
	PreviousState string            `json:"previous_state"`
	Transitions   []StateTransition `json:"transitions"`
}

type StateTransition struct {
	From      string `json:"from"`
	To        string `json:"to"`
	Timestamp int64  `json:"timestamp"`
	Reason    string `json:"reason"`
}

type StatsResponse struct {
	TransfersProcessed int64 `json:"transfers_processed"`
	AccountsTracked    int   `json:"accounts_tracked"`
	SettlementBatches  int   `json:"settlement_batches"`
	ReconciliationsRun int64 `json:"reconciliations_run"`
	HealthChecksRun    int64 `json:"health_checks_run"`
	TotalLedgerVolume  int64 `json:"total_ledger_volume"`
	PendingTransfers   int   `json:"pending_transfers"`
	UptimeSeconds      int64 `json:"uptime_seconds"`
}

// ── Application State ────────────────────────────────────────────────────────
// Only ephemeral, non-money state lives here: lifecycle tracking and
// operational counters. Money records live exclusively in PostgreSQL.

type AppState struct {
	mu               sync.RWMutex
	lifecycles       map[string]*TransactionLifecycle
	transferCount    atomic.Int64
	reconcileCount   atomic.Int64
	healthCheckCount atomic.Int64
	totalVolume      atomic.Int64
	startTime        time.Time
}

func NewAppState() *AppState {
	return &AppState{
		lifecycles: make(map[string]*TransactionLifecycle),
		startTime:  time.Now(),
	}
}

var state *AppState

// ── Persistence ──────────────────────────────────────────────────────────────

var db *sql.DB

// dbRequired fails loud when persistence is unavailable. Returns false after
// writing a 503 — the handler must return immediately.
func dbRequired(w http.ResponseWriter) bool {
	if db == nil {
		jsonError(w, "ledger persistence unavailable (PostgreSQL not connected) — money operation REFUSED, nothing was recorded", http.StatusServiceUnavailable)
		return false
	}
	return true
}

// newTxnID generates a collision-resistant transaction ID from crypto/rand.
func newTxnID(prefix string) string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		// crypto/rand failure is fatal for ID generation — do not fall back
		// to clock-derived IDs.
		panic(fmt.Sprintf("crypto/rand unavailable: %v", err))
	}
	return fmt.Sprintf("%s_%s", prefix, hex.EncodeToString(b[:]))
}

// applyEntryTx inserts a ledger entry and updates both account balances
// inside tx. Idempotent on entry ID: returns false when the ID already
// exists (no state mutated).
func applyEntryTx(tx *sql.Tx, e *LedgerEntry) (bool, error) {
	meta, err := json.Marshal(e.Metadata)
	if err != nil {
		return false, fmt.Errorf("marshal metadata: %w", err)
	}
	res, err := tx.Exec(`INSERT INTO ledger_entries
		(id, debit_account_id, credit_account_id, amount, currency, ledger_code, transfer_code, pending, ts, metadata)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		ON CONFLICT (id) DO NOTHING`,
		e.ID, e.DebitAccountID, e.CreditAccountID, e.Amount, e.Currency,
		e.LedgerCode, e.TransferCode, e.Pending, e.Timestamp, string(meta))
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, err
	}
	if n == 0 {
		return false, nil // duplicate ID — idempotent no-op
	}
	if err := upsertBalanceTx(tx, e.DebitAccountID, e.Currency, -e.Amount, e.Pending); err != nil {
		return false, err
	}
	if err := upsertBalanceTx(tx, e.CreditAccountID, e.Currency, e.Amount, e.Pending); err != nil {
		return false, err
	}
	return true, nil
}

// upsertBalanceTx applies a signed amount to an account balance inside tx.
func upsertBalanceTx(tx *sql.Tx, accountID, currency string, amount int64, pending bool) error {
	var d, c int64
	if amount > 0 {
		c = amount
	} else {
		d = -amount
	}
	if pending {
		_, err := tx.Exec(`INSERT INTO account_balances (account_id, currency, debits_pending, credits_pending, updated_at)
			VALUES ($1,$2,$3,$4,NOW())
			ON CONFLICT (account_id, currency) DO UPDATE SET
			  debits_pending  = account_balances.debits_pending  + EXCLUDED.debits_pending,
			  credits_pending = account_balances.credits_pending + EXCLUDED.credits_pending,
			  updated_at = NOW()`, accountID, currency, d, c)
		return err
	}
	_, err := tx.Exec(`INSERT INTO account_balances (account_id, currency, debits_posted, credits_posted, updated_at)
		VALUES ($1,$2,$3,$4,NOW())
		ON CONFLICT (account_id, currency) DO UPDATE SET
		  debits_posted  = account_balances.debits_posted  + EXCLUDED.debits_posted,
		  credits_posted = account_balances.credits_posted + EXCLUDED.credits_posted,
		  updated_at = NOW()`, accountID, currency, d, c)
	return err
}

func validateEntry(e *LedgerEntry) error {
	if e.DebitAccountID == "" || e.CreditAccountID == "" {
		return fmt.Errorf("debit_account_id and credit_account_id are required")
	}
	if e.DebitAccountID == e.CreditAccountID {
		return fmt.Errorf("debit and credit accounts must differ")
	}
	if e.Amount <= 0 {
		return fmt.Errorf("amount must be positive")
	}
	return nil
}

func normalizeEntry(e *LedgerEntry) {
	if e.ID == "" {
		e.ID = newTxnID("txn")
	}
	if e.Timestamp == 0 {
		e.Timestamp = time.Now().UnixMilli()
	}
	if e.Currency == "" {
		e.Currency = "NGN"
	}
	if e.Metadata == nil {
		e.Metadata = map[string]interface{}{}
	}
}

// ── Handlers ─────────────────────────────────────────────────────────────────

func transferHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !dbRequired(w) {
		return
	}
	var entry LedgerEntry
	if err := json.NewDecoder(r.Body).Decode(&entry); err != nil {
		jsonError(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	normalizeEntry(&entry)
	if err := validateEntry(&entry); err != nil {
		jsonError(w, err.Error(), http.StatusBadRequest)
		return
	}

	tx, err := db.BeginTx(r.Context(), nil)
	if err != nil {
		jsonError(w, "failed to begin ledger transaction: "+err.Error(), http.StatusServiceUnavailable)
		return
	}
	inserted, err := applyEntryTx(tx, &entry)
	if err != nil {
		_ = tx.Rollback()
		jsonError(w, "ledger write FAILED — nothing committed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if err := tx.Commit(); err != nil {
		jsonError(w, "ledger commit FAILED — nothing committed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if !inserted {
		jsonResponse(w, map[string]interface{}{
			"status": "duplicate",
			"id":     entry.ID,
			"amount": entry.Amount,
			"detail": "an entry with this ID is already committed; no state changed",
		})
		return
	}

	state.transferCount.Add(1)
	state.totalVolume.Add(entry.Amount)

	jsonResponse(w, map[string]interface{}{
		"status": "committed", // durable: row + balance updates committed to PostgreSQL
		"id":     entry.ID,
		"amount": entry.Amount,
	})
}

func batchTransferHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !dbRequired(w) {
		return
	}
	var entries []LedgerEntry
	if err := json.NewDecoder(r.Body).Decode(&entries); err != nil {
		jsonError(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if len(entries) == 0 {
		jsonError(w, "empty batch", http.StatusBadRequest)
		return
	}
	for i := range entries {
		normalizeEntry(&entries[i])
		if err := validateEntry(&entries[i]); err != nil {
			jsonError(w, fmt.Sprintf("entry %d: %v", i, err), http.StatusBadRequest)
			return
		}
	}

	tx, err := db.BeginTx(r.Context(), nil)
	if err != nil {
		jsonError(w, "failed to begin ledger transaction: "+err.Error(), http.StatusServiceUnavailable)
		return
	}
	inserted := 0
	duplicates := 0
	for i := range entries {
		ok, err := applyEntryTx(tx, &entries[i])
		if err != nil {
			_ = tx.Rollback()
			jsonError(w, fmt.Sprintf("batch ledger write FAILED at entry %d — entire batch rolled back, nothing committed: %v", i, err), http.StatusInternalServerError)
			return
		}
		if ok {
			inserted++
		} else {
			duplicates++
		}
	}
	if err := tx.Commit(); err != nil {
		jsonError(w, "batch ledger commit FAILED — nothing committed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	state.transferCount.Add(int64(inserted))
	for i := range entries {
		state.totalVolume.Add(entries[i].Amount)
	}

	jsonResponse(w, map[string]interface{}{
		"status":     "batch_committed", // durable: all rows committed to PostgreSQL atomically
		"count":      len(entries),
		"inserted":   inserted,
		"duplicates": duplicates,
	})
}

func balanceHandler(w http.ResponseWriter, r *http.Request) {
	if !dbRequired(w) {
		return
	}
	accountID := r.URL.Query().Get("account_id")
	if accountID == "" {
		jsonError(w, "account_id required", http.StatusBadRequest)
		return
	}
	row := db.QueryRowContext(r.Context(), `SELECT account_id, currency, debits_posted, credits_posted, debits_pending, credits_pending,
		EXTRACT(EPOCH FROM updated_at)*1000
		FROM account_balances WHERE account_id = $1 ORDER BY updated_at DESC LIMIT 1`, accountID)
	var acc AccountBalance
	var lastUpdated float64
	err := row.Scan(&acc.AccountID, &acc.Currency, &acc.DebitsPosted, &acc.CreditsPosted, &acc.DebitsPending, &acc.CreditsPending, &lastUpdated)
	if err == sql.ErrNoRows {
		jsonResponse(w, map[string]interface{}{
			"account_id": accountID,
			"balance":    0,
			"exists":     false,
		})
		return
	}
	if err != nil {
		jsonError(w, "balance query failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	acc.Balance = acc.CreditsPosted - acc.DebitsPosted
	acc.LastUpdated = int64(lastUpdated)
	jsonResponse(w, acc)
}

func allBalancesHandler(w http.ResponseWriter, r *http.Request) {
	if !dbRequired(w) {
		return
	}
	rows, err := db.QueryContext(r.Context(), `SELECT account_id, currency, debits_posted, credits_posted, debits_pending, credits_pending,
		EXTRACT(EPOCH FROM updated_at)*1000 FROM account_balances ORDER BY account_id`)
	if err != nil {
		jsonError(w, "balances query failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer func() { _ = rows.Close() }()
	balances := make([]*AccountBalance, 0)
	for rows.Next() {
		var acc AccountBalance
		var lastUpdated float64
		if err := rows.Scan(&acc.AccountID, &acc.Currency, &acc.DebitsPosted, &acc.CreditsPosted, &acc.DebitsPending, &acc.CreditsPending, &lastUpdated); err != nil {
			jsonError(w, "balances scan failed: "+err.Error(), http.StatusInternalServerError)
			return
		}
		acc.Balance = acc.CreditsPosted - acc.DebitsPosted
		acc.LastUpdated = int64(lastUpdated)
		balances = append(balances, &acc)
	}
	jsonResponse(w, map[string]interface{}{
		"accounts": balances,
		"count":    len(balances),
	})
}

// settlementHandler creates a settlement batch over pending entries.
// HONESTY: no settlement rail is called here, so the batch is created with
// status "pending_settlement" and entries REMAIN pending. A batch may only
// transition to "settled" via an external rail confirmation (not implemented
// in this service). This endpoint never reports a settlement that did not
// happen.
func settlementHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !dbRequired(w) {
		return
	}

	rows, err := db.QueryContext(r.Context(), `SELECT id, amount FROM ledger_entries WHERE pending = TRUE ORDER BY ts`)
	if err != nil {
		jsonError(w, "pending query failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	ids := make([]string, 0)
	var totalAmt int64
	for rows.Next() {
		var id string
		var amt int64
		if err := rows.Scan(&id, &amt); err != nil {
			_ = rows.Close()
			jsonError(w, "pending scan failed: "+err.Error(), http.StatusInternalServerError)
			return
		}
		ids = append(ids, id)
		totalAmt += amt
	}
	_ = rows.Close()

	batch := SettlementBatch{
		ID:            newTxnID("stl"),
		Status:        "pending_settlement", // NOT settled — no rail call was made
		TotalAmount:   totalAmt,
		TransferCount: len(ids),
		TransferIDs:   ids,
		CreatedAt:     time.Now().UnixMilli(),
	}

	idsJSON, _ := json.Marshal(ids)
	_, err = db.ExecContext(r.Context(), `INSERT INTO settlement_batches (id, status, total_amount, transfer_count, transfer_ids)
		VALUES ($1,$2,$3,$4,$5)`, batch.ID, batch.Status, batch.TotalAmount, batch.TransferCount, string(idsJSON))
	if err != nil {
		jsonError(w, "settlement batch insert FAILED — nothing recorded: "+err.Error(), http.StatusInternalServerError)
		return
	}

	jsonResponse(w, batch)
}

// reconcileHandler recomputes posted balances from ledger_entries and
// compares them against account_balances. The result is persisted.
func reconcileHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !dbRequired(w) {
		return
	}
	ctx := r.Context()

	recomputed := make(map[string][2]int64) // account|currency -> [debits, credits]
	rows, err := db.QueryContext(ctx, `SELECT debit_account_id, credit_account_id, amount, currency FROM ledger_entries WHERE pending = FALSE`)
	if err != nil {
		jsonError(w, "reconcile query failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	for rows.Next() {
		var debit, credit, currency string
		var amt int64
		if err := rows.Scan(&debit, &credit, &amt, &currency); err != nil {
			_ = rows.Close()
			jsonError(w, "reconcile scan failed: "+err.Error(), http.StatusInternalServerError)
			return
		}
		dk := debit + "|" + currency
		ck := credit + "|" + currency
		d := recomputed[dk]
		d[0] += amt
		recomputed[dk] = d
		c := recomputed[ck]
		c[1] += amt
		recomputed[ck] = c
	}
	_ = rows.Close()

	stored := make(map[string][2]int64)
	srows, err := db.QueryContext(ctx, `SELECT account_id, currency, debits_posted, credits_posted FROM account_balances`)
	if err != nil {
		jsonError(w, "reconcile balances query failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	for srows.Next() {
		var id, currency string
		var d, c int64
		if err := srows.Scan(&id, &currency, &d, &c); err != nil {
			_ = srows.Close()
			jsonError(w, "reconcile balances scan failed: "+err.Error(), http.StatusInternalServerError)
			return
		}
		stored[id+"|"+currency] = [2]int64{d, c}
	}
	_ = srows.Close()

	matched := 0
	unmatched := 0
	var discrepancy int64
	seen := make(map[string]bool)
	for k, want := range recomputed {
		seen[k] = true
		if got, ok := stored[k]; ok && got == want {
			matched++
		} else {
			unmatched++
			discrepancy += abs64(want[0] - stored[k][0]) + abs64(want[1] - stored[k][1])
		}
	}
	for k := range stored {
		if !seen[k] {
			unmatched++
			discrepancy += abs64(stored[k][0]) + abs64(stored[k][1])
		}
	}

	status := "balanced"
	if unmatched > 0 {
		status = "discrepancy"
	}
	result := ReconciliationResult{
		ID:             newTxnID("rec"),
		Status:         status,
		MatchedCount:   matched,
		UnmatchedCount: unmatched,
		DiscrepancyAmt: discrepancy,
		Timestamp:      time.Now().UnixMilli(),
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO reconciliations (id, status, matched_count, unmatched_count, discrepancy_amount, ts)
		VALUES ($1,$2,$3,$4,$5,$6)`, result.ID, result.Status, result.MatchedCount, result.UnmatchedCount, result.DiscrepancyAmt, result.Timestamp); err != nil {
		jsonError(w, "reconciliation insert FAILED: "+err.Error(), http.StatusInternalServerError)
		return
	}

	state.reconcileCount.Add(1)
	jsonResponse(w, result)
}

func abs64(v int64) int64 {
	if v < 0 {
		return -v
	}
	return v
}

// lifecycleHandler tracks transaction state transitions. This is ephemeral
// orchestration state (not a money record) and is intentionally in-memory.
func lifecycleHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		var req struct {
			TransactionID string `json:"transaction_id"`
			NewState      string `json:"new_state"`
			Reason        string `json:"reason"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			jsonError(w, "Invalid body", http.StatusBadRequest)
			return
		}
		state.mu.Lock()
		lc, exists := state.lifecycles[req.TransactionID]
		if !exists {
			lc = &TransactionLifecycle{
				TransactionID: req.TransactionID,
				CurrentState:  "initiated",
				Transitions:   make([]StateTransition, 0),
			}
			state.lifecycles[req.TransactionID] = lc
		}
		prev := lc.CurrentState
		lc.PreviousState = prev
		lc.CurrentState = req.NewState
		lc.Transitions = append(lc.Transitions, StateTransition{
			From: prev, To: req.NewState,
			Timestamp: time.Now().UnixMilli(),
			Reason:    req.Reason,
		})
		state.mu.Unlock()
		jsonResponse(w, lc)

	case http.MethodGet:
		txnID := r.URL.Query().Get("transaction_id")
		if txnID == "" {
			jsonError(w, "transaction_id required", http.StatusBadRequest)
			return
		}
		state.mu.RLock()
		lc, exists := state.lifecycles[txnID]
		state.mu.RUnlock()
		if !exists {
			jsonError(w, "Transaction not found", http.StatusNotFound)
			return
		}
		jsonResponse(w, lc)
	}
}

func healthAggregatorHandler(w http.ResponseWriter, r *http.Request) {
	state.healthCheckCount.Add(1)
	services := []struct {
		name string
		url  string
	}{
		{"node-main", "http://localhost:3000/api/trpc/system.getStats"},
		{"rust-bridge", "http://localhost:9100/health"},
		{"go-ledger", "http://localhost:9200/health"},
	}

	checks := make([]HealthCheck, 0, len(services))
	overall := "healthy"

	for _, svc := range services {
		start := time.Now()
		status := "healthy"
		client := &http.Client{Timeout: 3 * time.Second}
		resp, err := client.Get(svc.url)
		latency := time.Since(start).Milliseconds()
		if err != nil || (resp != nil && resp.StatusCode >= 500) {
			status = "unhealthy"
			overall = "degraded"
		}
		if resp != nil {
			_ = resp.Body.Close()
		}
		checks = append(checks, HealthCheck{
			Service:   svc.name,
			Status:    status,
			Latency:   latency,
			Timestamp: time.Now().UnixMilli(),
		})
	}

	jsonResponse(w, AggregatedHealth{
		Overall:   overall,
		Services:  checks,
		Timestamp: time.Now().UnixMilli(),
		UptimeSec: int64(time.Since(state.startTime).Seconds()),
	})
}

func signatureVerifyHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Payload   string `json:"payload"`
		Signature string `json:"signature"`
		Secret    string `json:"secret"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "Invalid body", http.StatusBadRequest)
		return
	}
	mac := hmac.New(sha256.New, []byte(req.Secret))
	mac.Write([]byte(req.Payload))
	expected := hex.EncodeToString(mac.Sum(nil))
	jsonResponse(w, map[string]interface{}{
		"valid":    expected == req.Signature,
		"expected": expected,
	})
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, map[string]interface{}{
		"status": "healthy", "database": fmt.Sprintf("%v", db != nil),
		"service":        "pos-ledger-sync",
		"version":        "1.1.0",
		"uptime_seconds": int64(time.Since(state.startTime).Seconds()),
		"transfers":      state.transferCount.Load(),
		"timestamp":      time.Now().UnixMilli(),
	})
}

func statsHandler(w http.ResponseWriter, r *http.Request) {
	accounts := 0
	batches := 0
	pending := 0
	if db != nil {
		_ = db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM account_balances`).Scan(&accounts)
		_ = db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM settlement_batches`).Scan(&batches)
		_ = db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM ledger_entries WHERE pending = TRUE`).Scan(&pending)
	}
	jsonResponse(w, StatsResponse{
		TransfersProcessed: state.transferCount.Load(),
		AccountsTracked:    accounts,
		SettlementBatches:  batches,
		ReconciliationsRun: state.reconcileCount.Load(),
		HealthChecksRun:    state.healthCheckCount.Load(),
		TotalLedgerVolume:  state.totalVolume.Load(),
		PendingTransfers:   pending,
		UptimeSeconds:      int64(time.Since(state.startTime).Seconds()),
	})
}

func ledgerQueryHandler(w http.ResponseWriter, r *http.Request) {
	if !dbRequired(w) {
		return
	}
	rows, err := db.QueryContext(r.Context(), `SELECT id, debit_account_id, credit_account_id, amount, currency, ledger_code, transfer_code, pending, ts, metadata
		FROM ledger_entries ORDER BY ts DESC LIMIT 100`)
	if err != nil {
		jsonError(w, "ledger query failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer func() { _ = rows.Close() }()
	entries := make([]LedgerEntry, 0)
	for rows.Next() {
		var e LedgerEntry
		var meta string
		if err := rows.Scan(&e.ID, &e.DebitAccountID, &e.CreditAccountID, &e.Amount, &e.Currency, &e.LedgerCode, &e.TransferCode, &e.Pending, &e.Timestamp, &meta); err != nil {
			jsonError(w, "ledger scan failed: "+err.Error(), http.StatusInternalServerError)
			return
		}
		_ = json.Unmarshal([]byte(meta), &e.Metadata)
		entries = append(entries, e)
	}
	var total int
	_ = db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM ledger_entries`).Scan(&total)
	jsonResponse(w, map[string]interface{}{
		"entries":  entries,
		"total":    total,
		"returned": len(entries),
	})
}

// ── Helpers ──────────────────────────────────────────────────────────────────

func jsonResponse(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(data)
}

func jsonError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// ── Main ─────────────────────────────────────────────────────────────────────

func initDB() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgresql://ngapp:ngapp@localhost:5432/ngapp?sslmode=disable"
	}
	var err error
	db, err = sql.Open("postgres", dsn)
	if err != nil {
		log.Printf("ERROR: database connection failed: %v — money endpoints will return 503", err)
		db = nil
		return
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	if err = db.Ping(); err != nil {
		log.Printf("ERROR: database ping failed: %v — money endpoints will return 503", err)
		db = nil
		return
	}
	log.Printf("Connected to PostgreSQL for go_ledger_sync")

	// Durable ledger schema (additive, idempotent).
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS ledger_entries (
			id TEXT PRIMARY KEY,
			debit_account_id TEXT NOT NULL,
			credit_account_id TEXT NOT NULL,
			amount BIGINT NOT NULL CHECK (amount > 0),
			currency TEXT NOT NULL DEFAULT 'NGN',
			ledger_code INTEGER NOT NULL DEFAULT 0,
			transfer_code INTEGER NOT NULL DEFAULT 0,
			pending BOOLEAN NOT NULL DEFAULT FALSE,
			ts BIGINT NOT NULL,
			metadata JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS account_balances (
			account_id TEXT NOT NULL,
			currency TEXT NOT NULL,
			debits_posted BIGINT NOT NULL DEFAULT 0,
			credits_posted BIGINT NOT NULL DEFAULT 0,
			debits_pending BIGINT NOT NULL DEFAULT 0,
			credits_pending BIGINT NOT NULL DEFAULT 0,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			PRIMARY KEY (account_id, currency)
		)`,
		`CREATE TABLE IF NOT EXISTS settlement_batches (
			id TEXT PRIMARY KEY,
			status TEXT NOT NULL,
			total_amount BIGINT NOT NULL,
			transfer_count INTEGER NOT NULL,
			transfer_ids JSONB NOT NULL DEFAULT '[]',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			settled_at TIMESTAMPTZ
		)`,
		`CREATE TABLE IF NOT EXISTS reconciliations (
			id TEXT PRIMARY KEY,
			status TEXT NOT NULL,
			matched_count INTEGER NOT NULL,
			unmatched_count INTEGER NOT NULL,
			discrepancy_amount BIGINT NOT NULL,
			ts BIGINT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_ledger_entries_pending ON ledger_entries (pending)`,
		`CREATE INDEX IF NOT EXISTS idx_ledger_entries_debit ON ledger_entries (debit_account_id)`,
		`CREATE INDEX IF NOT EXISTS idx_ledger_entries_credit ON ledger_entries (credit_account_id)`,
	}
	for _, stmt := range stmts {
		if _, err := db.Exec(stmt); err != nil {
			log.Printf("ERROR: schema statement failed: %v — money endpoints will return 503", err)
			db = nil
			return
		}
	}
	log.Printf("Ledger schema ensured (ledger_entries, account_balances, settlement_batches, reconciliations)")
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-ID")
		w.Header().Set("Access-Control-Max-Age", "86400")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func tracingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := r.Header.Get("X-Request-ID")
		if requestID == "" {
			requestID = fmt.Sprintf("req-%d", time.Now().UnixNano())
		}
		w.Header().Set("X-Request-ID", requestID)
		start := time.Now()
		wrapped := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}
		next.ServeHTTP(wrapped, r)
		log.Printf("[TRACE] %s %s %d %s request_id=%s", r.Method, r.URL.Path, wrapped.statusCode, time.Since(start), requestID)
	})
}

type responseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}

var (
	rateLimitMu    sync.Mutex
	rateLimitStore = make(map[string][]time.Time)
)

func rateLimitMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := r.RemoteAddr
		if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
			ip = fwd
		}
		rateLimitMu.Lock()
		now := time.Now()
		window := now.Add(-1 * time.Minute)
		var recent []time.Time
		for _, t := range rateLimitStore[ip] {
			if t.After(window) {
				recent = append(recent, t)
			}
		}
		if len(recent) >= 100 {
			rateLimitMu.Unlock()
			w.Header().Set("Retry-After", "60")
			http.Error(w, `{"error":"rate limit exceeded","retry_after":60}`, http.StatusTooManyRequests)
			return
		}
		recent = append(recent, now)
		rateLimitStore[ip] = recent
		rateLimitMu.Unlock()
		next.ServeHTTP(w, r)
	})
}

func main() {
	initDB()
	if db != nil {
		defer func() { _ = db.Close() }()
	}
	port := os.Getenv("GO_LEDGER_PORT")
	if port == "" {
		port = "9200"
	}

	state = NewAppState()

	mux := http.NewServeMux()

	// Ledger endpoints (durable, PG-backed; 503 when DB unavailable)
	mux.HandleFunc("/transfer", transferHandler)
	mux.HandleFunc("/transfer/batch", batchTransferHandler)
	mux.HandleFunc("/balance", balanceHandler)
	mux.HandleFunc("/balances", allBalancesHandler)
	mux.HandleFunc("/ledger/query", ledgerQueryHandler)

	// Settlement (creates pending_settlement batches only — no rail call)
	mux.HandleFunc("/settlement/create", settlementHandler)

	// Reconciliation (recomputed from the persisted ledger)
	mux.HandleFunc("/reconcile", reconcileHandler)

	// Transaction lifecycle (ephemeral, in-memory)
	mux.HandleFunc("/lifecycle", lifecycleHandler)

	// Health aggregator (checks all services)
	mux.HandleFunc("/health/aggregate", healthAggregatorHandler)

	// Signature verification
	mux.HandleFunc("/signature/verify", signatureVerifyHandler)

	// Health & stats
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/stats", statsHandler)
	mux.HandleFunc("/metrics", prodMetricsHandler)

	log.Printf("[pos-ledger-sync] Starting Go sidecar on port %s", port)
	srv := &http.Server{Addr: ":" + port, Handler: rateLimitMiddleware(tracingMiddleware(corsMiddleware(mux))), ReadTimeout: 15 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second}
	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed: %v", err)
		}
	}()
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down gracefully...")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("Forced shutdown: %v", err)
	}
	log.Println("Server stopped")
}

var prodMetricsStart = time.Now()

func prodMetricsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain")
	_, _ = fmt.Fprintf(w, "# HELP process_uptime_seconds Process uptime in seconds\n# TYPE process_uptime_seconds gauge\nprocess_uptime_seconds %.2f\n", time.Since(prodMetricsStart).Seconds())
}
