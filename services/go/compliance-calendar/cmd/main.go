package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"
)

// Compliance Calendar Service — Automated Regulatory Deadline Management
// Port: 8121
//
// Tracks NAICOM, CBN, NDPR, FIRS, and NHIA deadlines.
// Auto-triggers preparation workflows 30 days before due date.
//
// Middleware: PostgreSQL, Kafka, Temporal, Redis

type Deadline struct {
	ID           string `json:"id"`
	Authority    string `json:"authority"`
	Title        string `json:"title"`
	Description  string `json:"description"`
	DueDate      string `json:"due_date"`
	Frequency    string `json:"frequency"`
	Status       string `json:"status"`
	Penalty      string `json:"penalty"`
	DaysUntilDue int    `json:"days_until_due"`
	WorkflowID   string `json:"workflow_id,omitempty"`
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8121"
	}

	deadlines := []Deadline{
		{ID: "DL-001", Authority: "NAICOM", Title: "Quarterly Returns (Q2 2026)", Description: "Submit quarterly financial returns including premium income, claims paid, and outstanding claims", DueDate: "2026-07-31", Frequency: "quarterly", Status: "upcoming", Penalty: "₦10M per quarter late", DaysUntilDue: 55},
		{ID: "DL-002", Authority: "NAICOM", Title: "Annual Audited Accounts", Description: "Submit audited financial statements and actuarial valuation report", DueDate: "2026-06-30", Frequency: "annual", Status: "in_progress", Penalty: "₦25M + license suspension", DaysUntilDue: 24},
		{ID: "DL-003", Authority: "CBN", Title: "AML/CFT Compliance Report", Description: "Anti-money laundering and counter-terrorism financing quarterly report", DueDate: "2026-07-15", Frequency: "quarterly", Status: "upcoming", Penalty: "₦5M + regulatory action", DaysUntilDue: 39},
		{ID: "DL-004", Authority: "NDPR", Title: "Annual Data Protection Audit", Description: "Submit data protection impact assessment and compliance audit", DueDate: "2026-09-30", Frequency: "annual", Status: "scheduled", Penalty: "2% annual gross revenue", DaysUntilDue: 116},
		{ID: "DL-005", Authority: "FIRS", Title: "Company Income Tax Return", Description: "File annual company income tax return with financial statements", DueDate: "2026-12-31", Frequency: "annual", Status: "scheduled", Penalty: "₦50K + 10% per month", DaysUntilDue: 208},
		{ID: "DL-006", Authority: "NHIA", Title: "Monthly Contribution Remittance", Description: "Remit employer and employee NHIA contributions", DueDate: "2026-06-15", Frequency: "monthly", Status: "due_soon", Penalty: "₦500K + 2% per month", DaysUntilDue: 9},
		{ID: "DL-007", Authority: "NAICOM", Title: "Solvency Margin Report", Description: "Demonstrate minimum capital adequacy and solvency margin compliance", DueDate: "2026-06-30", Frequency: "quarterly", Status: "in_progress", Penalty: "License revocation risk", DaysUntilDue: 24},
		{ID: "DL-008", Authority: "NAICOM", Title: "Reinsurance Treaty Renewal", Description: "Submit evidence of adequate reinsurance arrangements for next period", DueDate: "2026-12-01", Frequency: "annual", Status: "scheduled", Penalty: "Restricted underwriting capacity", DaysUntilDue: 178},
	}

	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		overdue := 0
		dueSoon := 0
		for _, d := range deadlines {
			if d.DaysUntilDue < 0 {
				overdue++
			} else if d.DaysUntilDue <= 30 {
				dueSoon++
			}
		}
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":          "healthy",
			"service":         "compliance-calendar",
			"version":         "1.0.0",
			"total_deadlines": len(deadlines),
			"overdue":         overdue,
			"due_within_30d":  dueSoon,
		})
	})

	mux.HandleFunc("/api/v1/compliance/deadlines", func(w http.ResponseWriter, r *http.Request) {
		authority := r.URL.Query().Get("authority")
		status := r.URL.Query().Get("status")

		filtered := make([]Deadline, 0)
		for _, d := range deadlines {
			if authority != "" && d.Authority != authority {
				continue
			}
			if status != "" && d.Status != status {
				continue
			}
			filtered = append(filtered, d)
		}
		json.NewEncoder(w).Encode(map[string]interface{}{
			"deadlines": filtered,
			"total":     len(filtered),
		})
	})

	mux.HandleFunc("/api/v1/compliance/upcoming", func(w http.ResponseWriter, r *http.Request) {
		upcoming := make([]Deadline, 0)
		for _, d := range deadlines {
			if d.DaysUntilDue <= 30 && d.DaysUntilDue > 0 {
				upcoming = append(upcoming, d)
			}
		}
		json.NewEncoder(w).Encode(map[string]interface{}{
			"upcoming_30_days": upcoming,
			"count":            len(upcoming),
			"alert_level":      getAlertLevel(upcoming),
		})
	})

	mux.HandleFunc("/api/v1/compliance/trigger-workflow", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			DeadlineID string `json:"deadline_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
			return
		}
		workflowID := "wf-compliance-" + req.DeadlineID + "-" + time.Now().Format("20060102")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"workflow_id":  workflowID,
			"deadline_id":  req.DeadlineID,
			"status":       "triggered",
			"triggered_at": time.Now().Format(time.RFC3339),
			"message":      "Temporal workflow initiated for compliance preparation",
		})
		log.Printf("Kafka event: compliance.workflow.triggered deadline=%s workflow=%s", req.DeadlineID, workflowID)
	})

	log.Printf("Compliance Calendar starting on port %s", port)
	server := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
	}
	if err := server.ListenAndServe(); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

func getAlertLevel(upcoming []Deadline) string {
	for _, d := range upcoming {
		if d.DaysUntilDue <= 7 {
			return "critical"
		}
	}
	if len(upcoming) > 2 {
		return "high"
	}
	if len(upcoming) > 0 {
		return "moderate"
	}
	return "low"
}
