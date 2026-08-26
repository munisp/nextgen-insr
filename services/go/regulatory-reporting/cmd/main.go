package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"
)

// Regulatory Reporting Automation — NAICOM + CBN + SEC
// Port: 8107
//
// HONEST REPORTING CONTRACT: this service has no access to ledger,
// balance-sheet, policy, or claims data sources (no database driver or
// upstream data service is integrated in-tree). It therefore CANNOT and
// DOES NOT produce solvency figures, capital ratios, or compliance
// postures — endpoints that would require such data fail loudly with
// 501/503 instead of returning fabricated numbers. The deadlines endpoint
// computes statutory-calendar dates from the real clock only.

type ReportType string

const (
	ReportQuarterlyReturn   ReportType = "quarterly_return"
	ReportSolvencyMargin    ReportType = "solvency_margin"
	ReportTechnicalReserves ReportType = "technical_reserves"
	ReportRiskBasedCapital  ReportType = "risk_based_capital"
	ReportAML               ReportType = "aml_str"
	ReportPolicyRegister    ReportType = "policy_register"
	ReportClaimsRegister    ReportType = "claims_register"
	ReportInvestment        ReportType = "investment_reporting"
)

type FilingDeadline struct {
	ReportType ReportType `json:"report_type"`
	Period     string     `json:"period"`
	Deadline   string     `json:"deadline"`
	DaysLeft   int        `json:"days_left"`
	Status     string     `json:"status"`
	AlertLevel string     `json:"alert_level"` // green, yellow, red
	Basis      string     `json:"basis"`       // statutory_calendar — computed from filing rules, not from filing data
}

// quarterEnd returns the last day of the calendar quarter containing t.
func quarterEnd(t time.Time) time.Time {
	qEndMonth := ((int(t.Month())-1)/3)*3 + 3
	return time.Date(t.Year(), time.Month(qEndMonth)+1, 0, 0, 0, 0, 0, time.UTC)
}

func currentQuarterPeriod(t time.Time) string {
	q := (int(t.Month())-1)/3 + 1
	return fmt.Sprintf("%d-Q%d", t.Year(), q)
}

func alertLevel(daysLeft int) string {
	switch {
	case daysLeft < 0:
		return "red"
	case daysLeft <= 14:
		return "yellow"
	default:
		return "green"
	}
}

func deadlineStatus(daysLeft int) string {
	if daysLeft < 0 {
		return "overdue"
	}
	return "pending" // nothing is filed by this service; deadlines are only tracked
}

func main() {
	port := envOr("PORT", "8107")
	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":       "healthy",
			"service":      "regulatory-reporting",
			"regulators":   []string{"NAICOM", "CBN", "SEC", "NFIU"},
			"data_sources": "unavailable",
		})
	})

	// Report generation requires real ledger/policy/claims source data, which
	// this service does not have. Fail loudly rather than fabricate a report.
	mux.HandleFunc("/api/v1/regulatory/reports/generate", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotImplemented)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "regulatory report generation is not implemented: no ledger, policy, or claims data source is integrated with this service; refusing to fabricate regulator-facing figures",
			"status": "unavailable",
		})
	})

	// Solvency margin requires real balance-sheet data. Fail loudly rather
	// than fabricate capital adequacy figures for the regulator.
	mux.HandleFunc("/api/v1/regulatory/solvency", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "solvency computation unavailable: no balance-sheet/ledger data source is integrated with this service; refusing to fabricate solvency figures",
			"status": "unavailable",
		})
	})

	// Deadlines are statutory-calendar computations (quarter-end + filing
	// window) derived from the real clock — no filing data is invented.
	mux.HandleFunc("/api/v1/regulatory/deadlines", func(w http.ResponseWriter, r *http.Request) {
		now := time.Now().UTC()
		qe := quarterEnd(now)
		period := currentQuarterPeriod(now)
		type rule struct {
			reportType ReportType
			daysAfter  int
		}
		rules := []rule{
			{ReportQuarterlyReturn, 30},
			{ReportSolvencyMargin, 30},
			{ReportAML, 30},
		}
		deadlines := make([]FilingDeadline, 0, len(rules))
		for _, rl := range rules {
			dl := qe.AddDate(0, 0, rl.daysAfter)
			daysLeft := int(dl.Sub(now).Hours() / 24)
			deadlines = append(deadlines, FilingDeadline{
				ReportType: rl.reportType,
				Period:     period,
				Deadline:   dl.Format("2006-01-02"),
				DaysLeft:   daysLeft,
				Status:     deadlineStatus(daysLeft),
				AlertLevel: alertLevel(daysLeft),
				Basis:      "statutory_calendar",
			})
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"deadlines": deadlines})
	})

	log.Printf("Regulatory Reporting starting on port %s (data sources: unavailable — figure endpoints fail loudly)", port)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
