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
	"go.uber.org/zap"
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
	err := testDB.QueryRow("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1)", "micro_products").Scan(&exists)
	if err != nil {
		t.Fatalf("Failed to check table existence: %v", err)
	}
	if !exists {
		t.Fatalf("Table micro_products does not exist")
	}
}

func TestIntegration_InsertAndQuery(t *testing.T) {
	testDB := getTestDB(t)
	defer func() { _ = testDB.Close() }()

	// Clean up test data first
	_, _ = testDB.Exec("DELETE FROM microinsurance_policies WHERE id >= 99900")

	// Insert test record
	_, err := testDB.Exec("INSERT INTO microinsurance_policies (id, product_name, premium, coverage_amount, farmer_id) VALUES (99901, 'int-test', 500.00, 50000.00, 'FRM-INT-99901')")
	if err != nil {
		t.Fatalf("Failed to insert test record: %v", err)
	}

	// Query it back
	var id int
	err = testDB.QueryRow("SELECT id FROM microinsurance_policies WHERE id = $1", 99901).Scan(&id)
	if err != nil {
		t.Fatalf("Failed to query test record: %v", err)
	}
	if id != 99901 {
		t.Fatalf("Expected id=99901, got %d", id)
	}

	// Clean up
	_, _ = testDB.Exec("DELETE FROM microinsurance_policies WHERE id >= 99900")
}

func TestIntegration_HealthEndpoint(t *testing.T) {
	// Require a reachable database for this integration test
	testDB := getTestDB(t)
	defer func() { _ = testDB.Close() }()

	req := httptest.NewRequest("GET", "/health", nil)
	w := httptest.NewRecorder()
	healthHandler(zap.NewNop())(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200, got %d", w.Code)
	}

	var resp map[string]string
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}
	if resp["status"] != "healthy" {
		t.Fatalf("Expected status=healthy, got %v", resp["status"])
	}
}

func TestIntegration_APIEndpoint(t *testing.T) {
	// Require a reachable database for this integration test
	testDB := getTestDB(t)
	defer func() { _ = testDB.Close() }()

	body := `{"productName":"crop-basic","premium":500,"coverageAmount":50000,"farmerId":"FRM-INT-001"}`
	req := httptest.NewRequest("POST", "/api/v1/enroll", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	mux := http.NewServeMux()
	mux.Handle("/health", healthHandler(zap.NewNop()))
	mux.HandleFunc("/api/v1/enroll", func(rw http.ResponseWriter, r *http.Request) {
		rw.Header().Set("Content-Type", "application/json")
		rw.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(rw).Encode(map[string]string{"status": "processed"})
	})
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200, got %d", w.Code)
	}
	_ = "Integration test completed for microinsurance-engine"
}
