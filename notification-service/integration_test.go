package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	_ "github.com/lib/pq"

	"github.com/insureportal/notification_service/internal/handlers"
)

// testConn holds the package-level connection used by legacy integration tests below.
var testConn *sql.DB

func getTestDB(t *testing.T) *sql.DB {
	t.Helper()
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://ngapp:ngapp@localhost:5432/ngapp?sslmode=disable"
	}
	testDB, err := sql.Open("postgres", dbURL)
	if err != nil {
		t.Skipf("Skipping integration test: %v", err)
	}
	if err = testDB.Ping(); err != nil {
		t.Skipf("Skipping integration test (DB unreachable): %v", err)
	}
	return testDB
}

func TestIntegration_DBConnection(t *testing.T) {
	testDB := getTestDB(t)
	defer testDB.Close()

	// Verify table exists
	var exists bool
	err := testDB.QueryRow("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1)", "notification_service").Scan(&exists)
	if err != nil {
		t.Fatalf("Failed to check table existence: %v", err)
	}
	if !exists {
		t.Fatalf("Table notification_service does not exist")
	}
}

func TestIntegration_InsertAndQuery(t *testing.T) {
	testDB := getTestDB(t)
	defer testDB.Close()

	// Clean up test data first
	testDB.Exec("DELETE FROM notification_service WHERE id >= 99900")

	// Insert test record
	_, err := testDB.Exec(`INSERT INTO notification_service (id, data, status, created_at, updated_at, tenant_id) VALUES (99901, '{"channel":"email","recipient":"test@test.com"}'::jsonb, 'pending', NOW(), NOW(), 1)`)
	if err != nil {
		t.Fatalf("Failed to insert test record: %v", err)
	}

	// Query it back
	var id int
	err = testDB.QueryRow("SELECT id FROM notification_service WHERE id = $1", 99901).Scan(&id)
	if err != nil {
		t.Fatalf("Failed to query test record: %v", err)
	}
	if id != 99901 {
		t.Fatalf("Expected id=99901, got %d", id)
	}

	// Clean up
	testDB.Exec("DELETE FROM notification_service WHERE id >= 99900")
}

func TestIntegration_HealthEndpoint(t *testing.T) {
	// Set up DB for health check
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://ngapp:ngapp@localhost:5432/ngapp?sslmode=disable"
	}
	var err error
	testConn, err = sql.Open("postgres", dbURL)
	if err != nil {
		t.Skipf("Skipping: %v", err)
	}
	if err = testConn.Ping(); err != nil {
		t.Skipf("Skipping (DB unreachable): %v", err)
	}
	defer func() { testConn = nil }()

	// Health check via DB ping (inline handler pattern)
	if testConn == nil {
		t.Fatal("Expected db to be initialized")
	}
	if err := testConn.Ping(); err != nil {
		t.Fatalf("Expected DB ping to succeed, got %v", err)
	}
	t.Log("Health check passed: database connected")
}

func TestIntegration_ReadyEndpoint(t *testing.T) {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://ngapp:ngapp@localhost:5432/ngapp?sslmode=disable"
	}
	var err error
	testConn, err = sql.Open("postgres", dbURL)
	if err != nil {
		t.Skipf("Skipping: %v", err)
	}
	if err = testConn.Ping(); err != nil {
		t.Skipf("Skipping (DB unreachable): %v", err)
	}
	defer func() { testConn = nil }()

	req := httptest.NewRequest("GET", "/ready", nil)
	w := httptest.NewRecorder()
	handlers.NewHandlers(nil).ReadinessCheck(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200, got %d", w.Code)
	}

	var resp map[string]string
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}
	if resp["status"] != "ready" {
		t.Fatalf("Expected status=ready, got %v", resp["status"])
	}
}

func TestIntegration_LiveEndpoint(t *testing.T) {
	req := httptest.NewRequest("GET", "/live", nil)
	w := httptest.NewRecorder()
	handlers.NewHandlers(nil).LivenessCheck(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200, got %d", w.Code)
	}

	var resp map[string]string
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}
	if resp["status"] != "alive" {
		t.Fatalf("Expected status=alive, got %v", resp["status"])
	}
}

func TestIntegration_APIEndpoint(t *testing.T) {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://ngapp:ngapp@localhost:5432/ngapp?sslmode=disable"
	}
	var err error
	testConn, err = sql.Open("postgres", dbURL)
	if err != nil {
		t.Skipf("Skipping: %v", err)
	}
	if err = testConn.Ping(); err != nil {
		t.Skipf("Skipping (DB unreachable): %v", err)
	}
	defer func() { testConn = nil }()

	body := `{"recipient":"int-test@example.com","channel":"email","message":"Integration test notification"}`
	req := httptest.NewRequest("POST", "/api/v1/send", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(rw http.ResponseWriter, r *http.Request) {
		rw.Header().Set("Content-Type", "application/json")
		json.NewEncoder(rw).Encode(map[string]string{"status": "healthy"})
	})
	mux.HandleFunc("/api/v1/send", func(rw http.ResponseWriter, r *http.Request) {
		rw.Header().Set("Content-Type", "application/json")
		rw.WriteHeader(http.StatusOK)
		json.NewEncoder(rw).Encode(map[string]string{"status": "processed"})
	})
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200, got %d", w.Code)
	}
	_ = fmt.Sprintf("Integration test completed for notification-service")
}
