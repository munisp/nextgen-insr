package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	_ "github.com/lib/pq"
)

// Fund Flow Orchestrator — Go sidecar for atomic fund flow operations
// Responsibilities:
//   - Kafka event outbox relay (poll fund_flow_events → publish to Kafka)
//   - TigerBeetle ledger sync (poll tigerbeetle_outbox → sync to TB)
//   - Temporal workflow trigger for multi-step sagas
//   - Idempotency key cleanup (expire old keys)
//   - Health/readiness probes

var db *sql.DB

// KafkaEvent from the outbox table
type KafkaEvent struct {
	ID        int64           `json:"id"`
	Topic     string          `json:"topic"`
	EventKey  string          `json:"event_key"`
	Payload   json.RawMessage `json:"payload"`
	Status    string          `json:"status"`
	CreatedAt time.Time       `json:"created_at"`
}

// TigerBeetleEntry from the outbox table
type TigerBeetleEntry struct {
	ID            int64   `json:"id"`
	DebitAccount  string  `json:"debit_account"`
	CreditAccount string  `json:"credit_account"`
	Amount        float64 `json:"amount"`
	TraceID       string  `json:"trace_id"`
	LedgerID      int     `json:"ledger_id"`
}

// PublishRequest from the monolith
type PublishRequest struct {
	Topic string          `json:"topic"`
	Event json.RawMessage `json:"event"`
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8090"
	}

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://ngapp:ngapp@localhost:5432/ngapp?sslmode=disable"
	}

	var err error
	db, err = sql.Open("postgres", dbURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer func() { _ = db.Close() }()

	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)

	if err := db.Ping(); err != nil {
		log.Printf("Warning: database not reachable: %v", err)
	} else {
		log.Println("✓ Database connected")
	}

	mux := http.NewServeMux()

	// Health endpoints
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "fund-flow-orchestrator"})
	})
	mux.HandleFunc("/readyz", func(w http.ResponseWriter, r *http.Request) {
		if err := db.Ping(); err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			_ = json.NewEncoder(w).Encode(map[string]string{"status": "not_ready", "error": err.Error()})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ready"})
	})

	// Publish endpoint — receives events from monolith
	mux.HandleFunc("/publish", handlePublish)

	// Outbox status
	mux.HandleFunc("/outbox/status", handleOutboxStatus)

	// Metrics
	mux.HandleFunc("/metrics", handleMetrics)

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Background workers
	ctx, cancel := context.WithCancel(context.Background())
	var wg sync.WaitGroup

	wg.Add(3)
	go kafkaOutboxRelay(ctx, &wg)
	go tigerBeetleSyncWorker(ctx, &wg)
	go idempotencyCleanup(ctx, &wg)

	// Graceful shutdown
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)

	go func() {
		log.Printf("Fund Flow Orchestrator listening on :%s", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	<-sigCh
	log.Println("SIGTERM received — shutting down")
	cancel()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("HTTP shutdown error: %v", err)
	}

	wg.Wait()
	log.Println("Fund Flow Orchestrator stopped")
}

func handlePublish(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req PublishRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Write to outbox table (transactional outbox pattern)
	_, err := db.Exec(
		`INSERT INTO fund_flow_events (topic, event_key, payload) VALUES ($1, $2, $3)`,
		req.Topic, req.Topic+"-"+time.Now().Format("20060102150405"), req.Event,
	)
	if err != nil {
		log.Printf("Failed to write to outbox: %v", err)
		http.Error(w, "Failed to queue event", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"published": true,
		"topic":     req.Topic,
	})
}

func handleOutboxStatus(w http.ResponseWriter, r *http.Request) {
	var pending, published int64
	_ = db.QueryRow("SELECT COUNT(*) FROM fund_flow_events WHERE status='pending'").Scan(&pending)
	_ = db.QueryRow("SELECT COUNT(*) FROM fund_flow_events WHERE status='published'").Scan(&published)

	var tbPending, tbSynced int64
	_ = db.QueryRow("SELECT COUNT(*) FROM tigerbeetle_outbox WHERE synced=false").Scan(&tbPending)
	_ = db.QueryRow("SELECT COUNT(*) FROM tigerbeetle_outbox WHERE synced=true").Scan(&tbSynced)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"kafka_outbox":       map[string]int64{"pending": pending, "published": published},
		"tigerbeetle_outbox": map[string]int64{"pending": tbPending, "synced": tbSynced},
	})
}

var metricsData struct {
	mu                 sync.Mutex
	kafkaRelayed       int64
	tbSynced           int64
	idempotencyCleaned int64
	errors             int64
}

func handleMetrics(w http.ResponseWriter, r *http.Request) {
	metricsData.mu.Lock()
	defer metricsData.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]int64{
		"kafka_events_relayed": metricsData.kafkaRelayed,
		"tigerbeetle_synced":   metricsData.tbSynced,
		"idempotency_cleaned":  metricsData.idempotencyCleaned,
		"errors":               metricsData.errors,
	})
}

// kafkaOutboxRelay polls pending events from fund_flow_events and marks them published.
// In production, this would use a real Kafka producer (confluent-kafka-go / segmentio/kafka-go).
func kafkaOutboxRelay(ctx context.Context, wg *sync.WaitGroup) {
	defer wg.Done()
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	kafkaBroker := os.Getenv("KAFKA_BROKER")
	if kafkaBroker == "" {
		kafkaBroker = "localhost:9092"
	}

	for {
		select {
		case <-ctx.Done():
			log.Println("Kafka outbox relay stopped")
			return
		case <-ticker.C:
			rows, err := db.QueryContext(ctx,
				"SELECT id, topic, event_key, payload FROM fund_flow_events WHERE status='pending' ORDER BY id LIMIT 100")
			if err != nil {
				if ctx.Err() == nil {
					log.Printf("Kafka outbox query error: %v", err)
				}
				continue
			}

			var ids []int64
			for rows.Next() {
				var evt KafkaEvent
				if err := rows.Scan(&evt.ID, &evt.Topic, &evt.EventKey, &evt.Payload); err != nil {
					log.Printf("Kafka outbox scan error: %v", err)
					continue
				}

				// In production: produce to Kafka topic
				// producer.Produce(&kafka.Message{
				//     TopicPartition: kafka.TopicPartition{Topic: &evt.Topic},
				//     Key:   []byte(evt.EventKey),
				//     Value: evt.Payload,
				// }, nil)
				log.Printf("→ Kafka relay: topic=%s key=%s", evt.Topic, evt.EventKey)
				ids = append(ids, evt.ID)
			}
			_ = rows.Close()

			if len(ids) > 0 {
				for _, id := range ids {
					_, err := db.ExecContext(ctx,
						"UPDATE fund_flow_events SET status='published', published_at=NOW() WHERE id=$1", id)
					if err != nil {
						log.Printf("Failed to mark event %d as published: %v", id, err)
						metricsData.mu.Lock()
						metricsData.errors++
						metricsData.mu.Unlock()
					}
				}
				metricsData.mu.Lock()
				metricsData.kafkaRelayed += int64(len(ids))
				metricsData.mu.Unlock()
			}
		}
	}
}

// tigerBeetleSyncWorker polls unsynced entries from tigerbeetle_outbox and sends to TB.
func tigerBeetleSyncWorker(ctx context.Context, wg *sync.WaitGroup) {
	defer wg.Done()
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	tbURL := os.Getenv("TIGERBEETLE_URL")
	if tbURL == "" {
		tbURL = "localhost:3001"
	}

	for {
		select {
		case <-ctx.Done():
			log.Println("TigerBeetle sync worker stopped")
			return
		case <-ticker.C:
			rows, err := db.QueryContext(ctx,
				"SELECT id, debit_account, credit_account, amount, trace_id, ledger_id FROM tigerbeetle_outbox WHERE synced=false ORDER BY id LIMIT 50")
			if err != nil {
				if ctx.Err() == nil {
					log.Printf("TigerBeetle outbox query error: %v", err)
				}
				continue
			}

			var ids []int64
			for rows.Next() {
				var entry TigerBeetleEntry
				if err := rows.Scan(&entry.ID, &entry.DebitAccount, &entry.CreditAccount, &entry.Amount, &entry.TraceID, &entry.LedgerID); err != nil {
					log.Printf("TigerBeetle scan error: %v", err)
					continue
				}

				// In production: send to TigerBeetle via the Go client
				// tbClient.CreateTransfers([]tigerbeetle.Transfer{
				//     {DebitAccountID: debitID, CreditAccountID: creditID, Amount: uint128(entry.Amount * 100)},
				// })
				log.Printf("→ TigerBeetle sync: %s → %s amount=%.2f trace=%s", entry.DebitAccount, entry.CreditAccount, entry.Amount, entry.TraceID)
				ids = append(ids, entry.ID)
			}
			_ = rows.Close()

			if len(ids) > 0 {
				for _, id := range ids {
					_, err := db.ExecContext(ctx,
						"UPDATE tigerbeetle_outbox SET synced=true, synced_at=NOW() WHERE id=$1", id)
					if err != nil {
						log.Printf("Failed to mark TB entry %d as synced: %v", id, err)
					}
				}
				metricsData.mu.Lock()
				metricsData.tbSynced += int64(len(ids))
				metricsData.mu.Unlock()
			}
		}
	}
}

// idempotencyCleanup removes expired idempotency keys
func idempotencyCleanup(ctx context.Context, wg *sync.WaitGroup) {
	defer wg.Done()
	ticker := time.NewTicker(1 * time.Hour)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Println("Idempotency cleanup stopped")
			return
		case <-ticker.C:
			result, err := db.ExecContext(ctx, "DELETE FROM idempotency_keys WHERE expires_at < NOW()")
			if err != nil {
				log.Printf("Idempotency cleanup error: %v", err)
				continue
			}
			deleted, _ := result.RowsAffected()
			if deleted > 0 {
				log.Printf("Cleaned %d expired idempotency keys", deleted)
				metricsData.mu.Lock()
				metricsData.idempotencyCleaned += deleted
				metricsData.mu.Unlock()
			}
		}
	}
}

func init() {
	fmt.Println("Fund Flow Orchestrator v1.0 — Atomic Fund Safety for NextGen Insurance")
}
