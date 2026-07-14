package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/tigerbeetle/tigerbeetle-go/pkg/types"

	ttb "temporal-tigerbeetle-integration"
	"database/sql"

	_ "github.com/lib/pq"
)

var db *sql.DB

func initDB() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgresql://ngapp:ngapp@localhost:5432/ngapp?sslmode=disable"
	}
	var err error
	db, err = sql.Open("postgres", dsn)
	if err != nil {
		log.Printf("WARN: database connection failed: %v (running in degraded mode)", err)
		return
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	if err = db.Ping(); err != nil {
		log.Printf("WARN: database ping failed: %v (running in degraded mode)", err)
		db = nil
		return
	}
	log.Printf("Connected to PostgreSQL for bidirectional_integrations")

	// Create table if not exists
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS bidirectional_integrations (
		id SERIAL PRIMARY KEY,
		data JSONB NOT NULL DEFAULT '{}',
		status VARCHAR(50) DEFAULT 'active',
		created_at TIMESTAMPTZ DEFAULT NOW(),
		updated_at TIMESTAMPTZ DEFAULT NOW(),
		tenant_id INTEGER DEFAULT 1
	)`)
	if err != nil {
		log.Printf("WARN: table creation failed: %v", err)
	}
}


func main() {
	initDB()
	if db != nil {
		defer db.Close()
	}
	temporalHost := getEnv("TEMPORAL_HOST", "temporal-frontend.temporal:7233")
	temporalNamespace := getEnv("TEMPORAL_NAMESPACE", "insurance-platform")
	taskQueue := getEnv("TEMPORAL_TASK_QUEUE", "financial-transactions")
	tigerBeetleAddresses := getEnv("TIGERBEETLE_ADDRESSES", "tigerbeetle-0.tigerbeetle-headless:3000")

	temporalClient, err := client.Dial(client.Options{
		HostPort:  temporalHost,
		Namespace: temporalNamespace,
	})
	if err != nil {
		log.Fatalf("Failed to create Temporal client: %v", err)
	}
	defer temporalClient.Close()

	clusterID := types.Uint128{High: 0, Low: 0}
	addresses := []string{tigerBeetleAddresses}

	tigerBeetleClient, err := ttb.NewTigerBeetleClient(clusterID, addresses)
	if err != nil {
		log.Fatalf("Failed to create TigerBeetle client: %v", err)
	}
	defer tigerBeetleClient.Close()

	activities := ttb.NewTigerBeetleActivities(tigerBeetleClient)

	w := worker.New(temporalClient, taskQueue, worker.Options{
		MaxConcurrentWorkflowTaskExecutionSize: 100,
		MaxConcurrentActivityExecutionSize:     200,
	})

	w.RegisterWorkflow(ttb.PaymentWorkflow)
	w.RegisterWorkflow(ttb.ClaimPaymentWorkflow)

	w.RegisterActivity(activities.CreateAccountActivity)
	w.RegisterActivity(activities.CreateTransferActivity)
	w.RegisterActivity(activities.PostPendingTransferActivity)
	w.RegisterActivity(activities.VoidPendingTransferActivity)
	w.RegisterActivity(activities.GetAccountBalanceActivity)

	go func() {
		http.Handle("/metrics", promhttp.Handler())
		http.HandleFunc("/health", healthHandler)
		http.HandleFunc("/ready", readyHandler)
		log.Println("Metrics server listening on :9090")
		if err := http.ListenAndServe(":9090", nil); err != nil {
			log.Printf("Metrics server error: %v", err)
		}
	}()

	log.Println("Starting Temporal-TigerBeetle worker...")
	err = w.Start()
	if err != nil {
		log.Fatalf("Failed to start worker: %v", err)
	}

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan

	log.Println("Shutting down worker...")
	w.Stop()
	log.Println("Worker stopped")
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("healthy"))
}

func readyHandler(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("ready"))
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
