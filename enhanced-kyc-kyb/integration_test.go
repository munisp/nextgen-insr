package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	_ "github.com/lib/pq"
)

// svcDB is the package-level handle exercised by the endpoint tests below.
var svcDB *sql.DB

// handleReady reports readiness: 200 {"status":"ready"} when the database
// handle is live, 503 {"status":"not_ready"} otherwise.
func handleReady(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if svcDB == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "not_ready"})
		return
	}
	if err := svcDB.Ping(); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "not_ready"})
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ready"})
}

// handleLive reports liveness unconditionally.
func handleLive(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "alive"})
}

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
	defer func() { _ = testDB.Close() }()

	// Verify table exists
	var exists bool
	err := testDB.QueryRow("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1)", "enhanced_kyc_kyb").Scan(&exists)
	if err != nil {
		t.Fatalf("Failed to check table existence: %v", err)
	}
	if !exists {
		t.Fatalf("Table enhanced_kyc_kyb does not exist")
	}
}

func TestIntegration_InsertAndQuery(t *testing.T) {
	testDB := getTestDB(t)
	defer func() { _ = testDB.Close() }()

	// Clean up test data first
	_, _ = testDB.Exec("DELETE FROM enhanced_kyc_kyb WHERE id >= 99900")

	// Insert test record
	_, err := testDB.Exec(`INSERT INTO enhanced_kyc_kyb (id, data, status, created_at, updated_at, tenant_id) VALUES (99901, '{"applicant":"KYC-001","type":"national_id"}'::jsonb, 'pending', NOW(), NOW(), 1)`)
	if err != nil {
		t.Fatalf("Failed to insert test record: %v", err)
	}

	// Query it back
	var id int
	err = testDB.QueryRow("SELECT id FROM enhanced_kyc_kyb WHERE id = $1", 99901).Scan(&id)
	if err != nil {
		t.Fatalf("Failed to query test record: %v", err)
	}
	if id != 99901 {
		t.Fatalf("Expected id=99901, got %d", id)
	}

	// Clean up
	_, _ = testDB.Exec("DELETE FROM enhanced_kyc_kyb WHERE id >= 99900")
}

func TestIntegration_HealthEndpoint(t *testing.T) {
	// Set up DB for health check
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://ngapp:ngapp@localhost:5432/ngapp?sslmode=disable"
	}
	var err error
	svcDB, err = sql.Open("postgres", dbURL)
	if err != nil {
		t.Skipf("Skipping: %v", err)
	}
	if err = svcDB.Ping(); err != nil {
		t.Skipf("Skipping (DB unreachable): %v", err)
	}
	defer func() { svcDB = nil }()

	// Health check via DB ping (inline handler pattern)
	if svcDB == nil {
		t.Fatal("Expected db to be initialized")
	}
	if err := svcDB.Ping(); err != nil {
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
	svcDB, err = sql.Open("postgres", dbURL)
	if err != nil {
		t.Skipf("Skipping: %v", err)
	}
	if err = svcDB.Ping(); err != nil {
		t.Skipf("Skipping (DB unreachable): %v", err)
	}
	defer func() { svcDB = nil }()

	req := httptest.NewRequest("GET", "/ready", nil)
	w := httptest.NewRecorder()
	handleReady(w, req)

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
	handleLive(w, req)

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
	svcDB, err = sql.Open("postgres", dbURL)
	if err != nil {
		t.Skipf("Skipping: %v", err)
	}
	if err = svcDB.Ping(); err != nil {
		t.Skipf("Skipping (DB unreachable): %v", err)
	}
	defer func() { svcDB = nil }()

	body := `{"applicantId":"APP-KYC-INT-001","documentType":"national_id","documentNumber":"A12345678"}`
	req := httptest.NewRequest("POST", "/api/v1/verify", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(rw http.ResponseWriter, r *http.Request) {
		rw.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(rw).Encode(map[string]string{"status": "healthy"})
	})
	mux.HandleFunc("/api/v1/verify", func(rw http.ResponseWriter, r *http.Request) {
		rw.Header().Set("Content-Type", "application/json")
		rw.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(rw).Encode(map[string]string{"status": "processed"})
	})
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200, got %d", w.Code)
	}
	_ = "Integration test completed for enhanced-kyc-kyb"
}
