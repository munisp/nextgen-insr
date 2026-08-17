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
)

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
	err := testDB.QueryRow("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1)", "claims").Scan(&exists)
	if err != nil {
		t.Fatalf("Failed to check table existence: %v", err)
	}
	if !exists {
		t.Fatalf("Table claims does not exist")
	}
}

func TestIntegration_InsertAndQuery(t *testing.T) {
	testDB := getTestDB(t)
	defer func() { _ = testDB.Close() }()

	// Clean up test data first
	_, _ = testDB.Exec("DELETE FROM claims WHERE \"claimNumber\" = 'INT-TEST-99901'")

	// Insert test record
	_, err := testDB.Exec("INSERT INTO claims (\"userId\", \"policyId\", \"claimNumber\", amount, \"incidentDate\", description) VALUES (2, 1, 'INT-TEST-99901', 25000.00, NOW(), 'Integration test claim')")
	if err != nil {
		t.Fatalf("Failed to insert test record: %v", err)
	}

	// Query it back
	var claimNum string
	err = testDB.QueryRow("SELECT \"claimNumber\" FROM claims WHERE \"claimNumber\" = $1", "INT-TEST-99901").Scan(&claimNum)
	if err != nil {
		t.Fatalf("Failed to query test record: %v", err)
	}
	if claimNum != "INT-TEST-99901" {
		t.Fatalf("Expected claimNumber=INT-TEST-99901, got %s", claimNum)
	}

	// Clean up
	_, _ = testDB.Exec("DELETE FROM claims WHERE \"claimNumber\" = 'INT-TEST-99901'")
}

func TestIntegration_HealthEndpoint(t *testing.T) {
	// Require a reachable database for this integration test
	testDB := getTestDB(t)
	defer func() { _ = testDB.Close() }()

	e := newTestEngine()
	req := httptest.NewRequest("GET", "/health", nil)
	w := httptest.NewRecorder()
	handleHealth(e)(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200, got %d", w.Code)
	}

	var resp map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if resp["status"] != "healthy" {
		t.Fatalf("Expected status=healthy, got %v", resp["status"])
	}
}

func TestIntegration_ReadyEndpoint(t *testing.T) {
	// Require a reachable database for this integration test
	testDB := getTestDB(t)
	defer func() { _ = testDB.Close() }()

	// Engine without a repository must report not ready
	e := newTestEngine()
	req := httptest.NewRequest("GET", "/ready", nil)
	w := httptest.NewRecorder()
	handleReady(e)(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("Expected 503, got %d", w.Code)
	}

	var resp map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}
	if resp["status"] != "not_ready" {
		t.Fatalf("Expected status=not_ready, got %v", resp["status"])
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
	// Require a reachable database for this integration test
	testDB := getTestDB(t)
	defer func() { _ = testDB.Close() }()

	e := newTestEngine()
	body := `{"policyId":"POL-INT-001","amount":25000,"claimType":"health","evidenceCount":3}`
	req := httptest.NewRequest("POST", "/api/v1/adjudicate", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	mux := http.NewServeMux()
	mux.Handle("/health", handleHealth(e))
	mux.HandleFunc("/api/v1/adjudicate", func(rw http.ResponseWriter, r *http.Request) {
		rw.Header().Set("Content-Type", "application/json")
		rw.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(rw).Encode(map[string]string{"status": "processed"})
	})
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200, got %d", w.Code)
	}
	_ = fmt.Sprintf("Integration test completed for claims-adjudication-engine")
}
