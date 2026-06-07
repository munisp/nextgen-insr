// Command sidecar is the 54Link TigerBeetle POS sidecar.
// It runs as a local HTTP service on the POS terminal, providing:
//   - SQLite-backed double-entry ledger for offline operation
//   - Background sync engine that pushes committed transfers to the
//     TigerBeetle Zig cluster and PostgreSQL when connectivity resumes
//   - REST API consumed by the Node.js POS server
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/54link/tb-sidecar/internal/api"
	"github.com/54link/tb-sidecar/internal/ledger"
	"github.com/54link/tb-sidecar/internal/sync"
	"sync"
)

func main() {
	// ── Configuration from environment ──────────────────────────────────────
	dbPath := getEnv("TB_SQLITE_PATH", "/tmp/pos-ledger.db")
	port := getEnv("TB_PORT", "7070")
	postgresDSN := getEnv("POSTGRES_URL", "")
	tbCluster := getEnv("TB_CLUSTER", "0")
	tbDataFile := getEnv("TB_DATA_FILE", "/home/ubuntu/tb-data/pos.tigerbeetle")
	syncIntervalStr := getEnv("TB_SYNC_INTERVAL", "10s")

	syncInterval, err := time.ParseDuration(syncIntervalStr)
	if err != nil {
		syncInterval = 10 * time.Second
	}

	// ── Open SQLite offline ledger ───────────────────────────────────────────
	db, err := ledger.Open(dbPath)
	if err != nil {
		log.Fatalf("[main] failed to open ledger: %v", err)
	}
	defer db.Close()
	log.Printf("[main] SQLite ledger opened at %s", dbPath)

	// ── Seed system accounts if they don't exist ─────────────────────────────
	seedSystemAccounts(db)

	// ── Start sync engine ────────────────────────────────────────────────────
	engine := sync.New(sync.Config{
		TigerBeetleDataFile: tbDataFile,
		TigerBeetleCluster:  tbCluster,
		PostgresDSN:         postgresDSN,
		SyncInterval:        syncInterval,
		BatchSize:           50,
	}, db)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go engine.Start(ctx)

	// ── Start HTTP API server ─────────────────────────────────────────────────
	srv := api.New(db, engine)
	httpServer := &http.Server{
		Addr:         ":" + port,
		Handler:      srv,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		log.Printf("[main] TB sidecar listening on :%s", port)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[main] HTTP server error: %v", err)
		}
	}()

	// ── Graceful shutdown ─────────────────────────────────────────────────────
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Printf("[main] Shutting down...")
	cancel()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		log.Printf("[main] HTTP shutdown error: %v", err)
	}
	log.Printf("[main] TB sidecar stopped")
}

// seedSystemAccounts creates the bank reserve and fee income accounts
// that are required for double-entry transfers to balance.
func seedSystemAccounts(db *ledger.DB) {
	systemAccounts := []ledger.Account{
		{
			ID:        "sys-bank-reserve",
			AgentCode: "SYSTEM",
			Ledger:    ledger.LedgerBankReserves,
			Code:      ledger.CodeCBNReserve,
		},
		{
			ID:        "sys-fee-income",
			AgentCode: "SYSTEM",
			Ledger:    ledger.LedgerFeeIncome,
			Code:      ledger.CodeTransactionFee,
		},
		{
			ID:        "sys-interchange",
			AgentCode: "SYSTEM",
			Ledger:    ledger.LedgerFeeIncome,
			Code:      ledger.CodeInterchangeFee,
		},
	}
	for _, acc := range systemAccounts {
		if err := db.CreateAccount(acc); err != nil {
			log.Printf("[main] seed account %s: %v", acc.ID, err)
		}
	}
	log.Printf("[main] System accounts seeded")
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
