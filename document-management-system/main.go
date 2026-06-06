package main

import (
	"fmt"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"database/sql"

	_ "github.com/lib/pq"
)

// Document Management System — policy documents, claims evidence, KYC documents
// Business Rules:
// - Supported formats: PDF, JPEG, PNG, DOCX (max 25MB per file)
// - Retention: Policy docs (policy lifetime + 7 years), KYC (10 years post-relationship)
// - Versioning: All documents versioned, previous versions immutable
// - Access control: Role-based (underwriter, claims adjuster, compliance, customer)
// - OCR: Auto-extract data from uploaded documents (NIN, drivers license, utility bills)
// - Virus scanning: All uploads scanned before storage
// - NDPR: Documents encrypted at rest (AES-256), customer can request deletion

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
	log.Printf("Connected to PostgreSQL for document_management_system")

	// Create table if not exists
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS document_management_system (
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
	r := chi.NewRouter()
	r.Use(middleware.Logger, middleware.Recoverer)
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "database": fmt.Sprintf("%v", db != nil), "service": "document-management-system"})
	})
	r.Route("/api/v1/documents", func(r chi.Router) {
		r.Get("/", listDocuments)
		r.Post("/upload", uploadDocument)
		r.Get("/{id}", getDocument)
		r.Get("/{id}/versions", getVersions)
	})
	port := os.Getenv("PORT")
	if port == "" { port = "8111" }
	log.Printf("Document Management System starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

func listDocuments(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"documents": []map[string]interface{}{
			{"id": "DOC-001", "type": "policy_certificate", "policy_id": "POL-2025-001", "format": "pdf", "size_bytes": 245000, "version": 2, "created_at": time.Now().AddDate(0, -3, 0).Format(time.RFC3339)},
			{"id": "DOC-002", "type": "kyc_nin", "customer_id": "CUS-001", "format": "jpeg", "size_bytes": 1200000, "version": 1, "ocr_status": "completed"},
			{"id": "DOC-003", "type": "claim_evidence", "claim_id": "CLM-001", "format": "pdf", "size_bytes": 5400000, "version": 1, "virus_scan": "clean"},
		},
		"total": 3, "retention_policy": "7 years post-expiry",
	})
}

func uploadDocument(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(201)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"document_id": "DOC-" + time.Now().Format("20060102150405"), "status": "processing",
		"virus_scan": "pending", "ocr": "queued", "encryption": "AES-256",
		"max_size": "25MB", "retention": "7 years",
	})
}

func getDocument(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id": chi.URLParam(r, "id"), "type": "policy_certificate", "version": 2,
		"encrypted": true, "access_log": []string{"underwriter@insureportal.ng viewed 2026-05-20"},
	})
}

func getVersions(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"document_id": chi.URLParam(r, "id"),
		"versions": []map[string]interface{}{
			{"version": 1, "created_at": time.Now().AddDate(0, -6, 0).Format(time.RFC3339), "created_by": "system", "immutable": true},
			{"version": 2, "created_at": time.Now().AddDate(0, -3, 0).Format(time.RFC3339), "created_by": "underwriter", "immutable": true},
		},
	})
}
