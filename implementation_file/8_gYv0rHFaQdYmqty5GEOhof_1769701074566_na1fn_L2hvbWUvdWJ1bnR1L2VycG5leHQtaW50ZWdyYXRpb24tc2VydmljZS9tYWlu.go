package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	dapr "github.com/dapr/go-sdk/client"
	"github.com/dapr/go-sdk/service/common"
	daprd "github.com/dapr/go-sdk/service/http"
	"database/sql"

	_ "github.com/lib/pq"
)

const (
	serviceName     = "erpnext-integration-service"
	pubsubName      = "erpnext-pubsub"
	topicName       = "erpnext-events"
	stateStoreName  = "erpnext-statestore"
	secretStoreName = "erpnext-secrets"
	targetAppID     = "inventory-service" // Example service to invoke
)

// EventPayload represents the structure of the event data
type EventPayload struct {
	OrderID string `json:"orderId"`
	Item    string `json:"item"`
	Quantity int    `json:"quantity"`
}

// StateData represents the structure of the state to be saved
type StateData struct {
	LastProcessed time.Time `json:"lastProcessed"`
	Status        string    `json:"status"`
}

// subscribeHandler is the handler for the Dapr Pub/Sub subscription
func subscribeHandler(ctx context.Context, e *common.TopicEvent) (retry bool, err error) {
	log.Printf("Event received: PubsubName: %s, Topic: %s, ID: %s, Data: %s", e.Pubsub, e.Topic, e.ID, e.Data)

	var payload EventPayload
	if err := json.Unmarshal(e.Data, &payload); err != nil {
		log.Printf("Error unmarshalling event data: %v", err)
		return false, err // Do not retry on unmarshalling error
	}

	log.Printf("Processing Order ID: %s, Item: %s, Quantity: %d", payload.OrderID, payload.Item, payload.Quantity)

	// 1. State Management: Save state
	if err := saveState(ctx, payload.OrderID); err != nil {
		log.Printf("Error saving state for order %s: %v", payload.OrderID, err)
		return true, err // Retry on state save error
	}

	// 2. Service Invocation: Invoke another service
	if err := invokeService(ctx, payload.OrderID); err != nil {
		log.Printf("Error invoking service for order %s: %v", payload.OrderID, err)
		return true, err // Retry on service invocation error
	}

	// 3. Secrets Management: Get a secret (for demonstration)
	if err := getSecret(ctx); err != nil {
		log.Printf("Error getting secret: %v", err)
		// Secrets retrieval is critical, but for a pubsub handler, we might not want to retry the whole message
		// just because of a secret failure. Depends on business logic. Here, we log and continue.
	}

	log.Printf("Successfully processed order %s", payload.OrderID)
	return false, nil // Success, do not retry
}

// saveState demonstrates Dapr State Management
func saveState(ctx context.Context, orderID string) error {
	client, err := dapr.NewClient()
	if err != nil {
		return fmt.Errorf("failed to create Dapr client: %w", err)
	}
	defer client.Close()

	state := StateData{
		LastProcessed: time.Now(),
		Status:        "PROCESSED",
	}
	data, _ := json.Marshal(state)

	item := &dapr.SetStateItem{
		Key:   orderID,
		Value: data,
		Options: &dapr.StateOptions{
			Concurrency: dapr.StateConcurrencyLastWrite,
			Consistency: dapr.StateConsistencyStrong,
		},
	}

	// Dapr automatically handles distributed tracing for client calls
	if err := client.SaveState(ctx, stateStoreName, item); err != nil {
		return fmt.Errorf("failed to save state: %w", err)
	}

	log.Printf("State saved for key: %s", orderID)
	return nil
}

// invokeService demonstrates Dapr Service Invocation
func invokeService(ctx context.Context, orderID string) error {
	client, err := dapr.NewClient()
	if err != nil {
		return fmt.Errorf("failed to create Dapr client: %w", err)
	}
	defer client.Close()

	// Example payload for service invocation
	payload := map[string]string{"orderId": orderID, "action": "update-inventory"}
	data, _ := json.Marshal(payload)

	// Invoke the target service
	resp, err := client.InvokeMethodWithContent(ctx, targetAppID, "update-inventory", http.MethodPost, &dapr.DataContent{
		ContentType: "application/json",
		Data:        data,
	})
	if err != nil {
		return fmt.Errorf("failed to invoke service %s: %w", targetAppID, err)
	}

	log.Printf("Service invocation successful. Target: %s, Response: %s", targetAppID, string(resp))
	return nil
}

// getSecret demonstrates Dapr Secrets Management
func getSecret(ctx context.Context) error {
	client, err := dapr.NewClient()
	if err != nil {
		return fmt.Errorf("failed to create Dapr client: %w", err)
	}
	defer client.Close()

	// Retrieve the secret
	secret, err := client.GetSecret(ctx, secretStoreName, "api-key", nil)
	if err != nil {
		return fmt.Errorf("failed to get secret: %w", err)
	}

	log.Printf("Successfully retrieved secret 'api-key'. Value length: %d", len(secret["api-key"]))
	// In a real application, you would use the secret here, not log it.
	return nil
}

// healthCheckHandler is a simple handler for the Dapr sidecar to check service health
func healthCheckHandler(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("Service is healthy"))
}

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
	log.Printf("Connected to PostgreSQL for implementation_file")

	// Create table if not exists
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS implementation_file (
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
	// Dapr service setup
	s := daprd.NewService(":8080") // Listen on port 8080

	// 1. Pub/Sub Integration: Subscribe to a topic
	if err := s.AddTopicEventHandler(&common.Subscription{
		PubsubName: pubsubName,
		Topic:      topicName,
		Route:      "/events",
	}, subscribeHandler); err != nil {
		log.Fatalf("error adding topic subscription: %v", err)
	}

	// Add a simple health check endpoint
	if err := s.AddServiceInvocationHandler("/healthz", healthCheckHandler); err != nil {
		log.Fatalf("error adding health check handler: %v", err)
	}

	log.Printf("Starting Dapr service on port 8080. App ID: %s", serviceName)
	if err := s.Start(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("error starting Dapr service: %v", err)
	}
}
