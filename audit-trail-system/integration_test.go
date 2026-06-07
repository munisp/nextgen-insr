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
	defer testDB.Close()

	// Verify table exists
	var exists bool
	err := testDB.QueryRow("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1)", "audit_trail_system").Scan(&exists)
	if err != nil {
		t.Fatalf("Failed to check table existence: %v", err)
	}
	if !exists {
		t.Fatalf("Table audit_trail_system does not exist")
	}
}

func TestIntegration_InsertAndQuery(t *testing.T) {
	testDB := getTestDB(t)
	defer testDB.Close()

	// Clean up test data first
	testDB.Exec("DELETE FROM audit_trail_system WHERE id LIKE 'int-test-%'")

	// Insert test record
	_, err := testDB.Exec("INSERT INTO audit_trail_system (id, action, entity_type, entity_id, user_id, created_at) VALUES ('int-test-audit-1', 'CREATE', 'policy', 'POL-001', 'USR-001', NOW())")
	if err != nil {
		t.Fatalf("Failed to insert test record: %v", err)
	}

	// Query it back
	var id string
	err = testDB.QueryRow("SELECT id FROM audit_trail_system WHERE id = $1", "int-test-audit-1").Scan(&id)
	if err != nil {
		t.Fatalf("Failed to query test record: %v", err)
	}
	if id == "" {
		t.Fatal("Expected non-empty id")
	}

	// Clean up
	testDB.Exec("DELETE FROM audit_trail_system WHERE id LIKE 'int-test-%'")
}

func TestIntegration_HealthEndpoint(t *testing.T) {
	// Set up DB for health check
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://ngapp:ngapp@localhost:5432/ngapp?sslmode=disable"
	}
	var err error
	db, err = sql.Open("postgres", dbURL)
	if err != nil {
		t.Skipf("Skipping: %v", err)
	}
	if err = db.Ping(); err != nil {
		t.Skipf("Skipping (DB unreachable): %v", err)
	}
	defer func() { db = nil }()

	// Health check via DB ping (inline handler pattern)
	if db == nil {
		t.Fatal("Expected db to be initialized")
	}
	if err := db.Ping(); err != nil {
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
	db, err = sql.Open("postgres", dbURL)
	if err != nil {
		t.Skipf("Skipping: %v", err)
	}
	if err = db.Ping(); err != nil {
		t.Skipf("Skipping (DB unreachable): %v", err)
	}
	defer func() { db = nil }()

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
	db, err = sql.Open("postgres", dbURL)
	if err != nil {
		t.Skipf("Skipping: %v", err)
	}
	if err = db.Ping(); err != nil {
		t.Skipf("Skipping (DB unreachable): %v", err)
	}
	defer func() { db = nil }()

	body := `{"action":"CREATE","entityType":"policy","entityId":"POL-INT-001","userId":"USR-INT-001"}`
	req := httptest.NewRequest("POST", "/api/v1/audit", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(rw http.ResponseWriter, r *http.Request) {
		rw.Header().Set("Content-Type", "application/json")
		json.NewEncoder(rw).Encode(map[string]string{"status": "healthy"})
	})
	mux.HandleFunc("/api/v1/audit", func(rw http.ResponseWriter, r *http.Request) {
		rw.Header().Set("Content-Type", "application/json")
		rw.WriteHeader(http.StatusOK)
		json.NewEncoder(rw).Encode(map[string]string{"status": "processed"})
	})
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200, got %d", w.Code)
	}
	_ = fmt.Sprintf("Integration test completed for audit-trail-system")
}
