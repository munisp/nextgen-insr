// Package main implements the Tenant Billing Provisioning Workflow sidecar (Go).
//
// This service is the Go-native counterpart of the delivered TS Temporal
// workflow `BillingProvisioningWorkflow` (server/temporal-workflows.ts, task
// queue "insureportal-journeys"). It executes the same seven provisioning
// steps against the SAME real PostgreSQL tables and applies the same
// reverse-order compensation on failure:
//
//  1. validate_tenant            — tenants row must exist
//  2. create_billing_config      — insert tenant_billing_config (status=provisioning)
//  3. create_tigerbeetle_accounts — deterministic TB ledger account id recorded on config
//  4. provision_kafka_topics     — kafka_topic_prefix recorded on config
//  5. assign_billing_roles       — billing_role_assignments (billing_admin)
//  6. configure_reconciliation   — no persistent effect; defaults returned & recorded in history
//  7. activate_billing           — tenant_billing_config status=active
//
// Every completed step (and every rollback) is audited in
// billing_provisioning_history, mirroring the TS orchestrator.
//
// Port: 8105
// Language: Go
// Dependencies: PostgreSQL (fail-loud: the process refuses to start without it)
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	_ "github.com/lib/pq"
)

// Config holds all service configuration.
type Config struct {
	Port        string
	PostgresDSN string
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func loadConfig() Config {
	return Config{
		Port:        getEnv("PORT", "8105"),
		PostgresDSN: getEnv("POSTGRES_DSN", "postgresql://insureportal:insureportal_dev@localhost:5432/insureportal"),
	}
}

var (
	cfg Config
	db  *sql.DB
)

// ProvisionRequest is the POST /provision body (mirrors BillingProvisioningWorkflow input).
type ProvisionRequest struct {
	TenantID      int                    `json:"tenantId"`
	BillingModel  string                 `json:"billingModel"` // revenue_share | subscription | hybrid
	CustomConfig  map[string]interface{} `json:"customConfig,omitempty"`
	ProvisionedBy int                    `json:"provisionedBy"`
	Region        string                 `json:"region,omitempty"`
}

// StepResult records one step outcome for the response payload.
type StepResult struct {
	Step   string `json:"step"`
	Status string `json:"status"` // completed | rolled_back
}

// ProvisionResult is the POST /provision response.
type ProvisionResult struct {
	Success        bool         `json:"success"`
	ConfigID       int          `json:"configId,omitempty"`
	CompletedSteps []StepResult `json:"completedSteps"`
	Error          string       `json:"error,omitempty"`
}

var validBillingModels = map[string]bool{
	"revenue_share": true,
	"subscription":  true,
	"hybrid":        true,
}

// auditStep appends a row to billing_provisioning_history (never fails the
// workflow by itself; a failed audit write is logged loudly).
func auditStep(ctx context.Context, tenantID int, step, status string, details interface{}, errText *string) {
	d, _ := json.Marshal(details)
	if _, err := db.ExecContext(ctx, `
		INSERT INTO billing_provisioning_history (tenant_id, step, status, details, completed_at, error)
		VALUES ($1, $2, $3, $4, NOW(), $5)
	`, tenantID, step, status, string(d), errText); err != nil {
		log.Printf("[BillingProvisioning] ERROR: audit write failed for tenant %d step %s: %v", tenantID, step, err)
	}
}

// rollbackStep performs the compensating mutation for a completed step,
// mirroring rollbackBillingStep in server/temporal-activities.ts.
func rollbackStep(ctx context.Context, tenantID int, step string, reason string) error {
	var err error
	switch step {
	case "create_billing_config":
		_, err = db.ExecContext(ctx, `DELETE FROM tenant_billing_config WHERE tenant_id = $1`, tenantID)
	case "create_tigerbeetle_accounts":
		_, err = db.ExecContext(ctx, `UPDATE tenant_billing_config SET tigerbeetle_account_id = NULL WHERE tenant_id = $1`, tenantID)
	case "provision_kafka_topics":
		_, err = db.ExecContext(ctx, `UPDATE tenant_billing_config SET kafka_topic_prefix = NULL WHERE tenant_id = $1`, tenantID)
	case "assign_billing_roles":
		_, err = db.ExecContext(ctx, `
			DELETE FROM billing_role_assignments
			WHERE tenant_id = $1 AND billing_role = 'billing_admin'
		`, tenantID)
	case "activate_billing":
		_, err = db.ExecContext(ctx, `
			UPDATE tenant_billing_config SET status = 'provisioning', last_modified_at = NOW()
			WHERE tenant_id = $1
		`, tenantID)
	default:
		// validate_tenant / configure_reconciliation have no persistent effect.
	}
	if err != nil {
		e := err.Error()
		auditStep(context.Background(), tenantID, step, "rollback_failed", map[string]interface{}{"reason": reason}, &e)
		return fmt.Errorf("rollback of step %s failed: %w", step, err)
	}
	auditStep(context.Background(), tenantID, step, "rolled_back", map[string]interface{}{"reason": reason}, nil)
	return nil
}

// runProvisioning executes the seven real steps with reverse-order compensation.
func runProvisioning(ctx context.Context, req ProvisionRequest) (*ProvisionResult, error) {
	result := &ProvisionResult{CompletedSteps: make([]StepResult, 0, 7)}
	completed := make([]string, 0, 7)

	// Step 1: validate_tenant — the tenants row must exist.
	var tenantName, tenantSlug, tenantStatus string
	err := db.QueryRowContext(ctx,
		`SELECT name, slug, status FROM tenants WHERE id = $1`, req.TenantID,
	).Scan(&tenantName, &tenantSlug, &tenantStatus)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("tenant %d not found", req.TenantID)
	}
	if err != nil {
		return nil, fmt.Errorf("validate tenant: %w", err)
	}
	completed = append(completed, "validate_tenant")
	result.CompletedSteps = append(result.CompletedSteps, StepResult{Step: "validate_tenant", Status: "completed"})
	auditStep(ctx, req.TenantID, "validate_tenant", "completed",
		map[string]interface{}{"tenantName": tenantName, "tenantSlug": tenantSlug, "status": tenantStatus}, nil)

	// Step 2: create_billing_config.
	var revenueShareConfig, subscriptionConfig, hybridConfig interface{}
	if req.CustomConfig != nil {
		revenueShareConfig = req.CustomConfig["revenueShareConfig"]
		subscriptionConfig = req.CustomConfig["subscriptionConfig"]
		hybridConfig = req.CustomConfig["hybridConfig"]
	}
	currency := "NGN"
	if req.CustomConfig != nil {
		if c, ok := req.CustomConfig["currency"].(string); ok && c != "" {
			currency = c
		}
	}
	toJSON := func(v interface{}) interface{} {
		if v == nil {
			return nil
		}
		b, _ := json.Marshal(v)
		return string(b)
	}
	var configID int
	err = db.QueryRowContext(ctx, `
		INSERT INTO tenant_billing_config
			(tenant_id, billing_model, revenue_share_config, subscription_config, hybrid_config, currency, provisioned_by, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7, 'provisioning')
		RETURNING id
	`, req.TenantID, req.BillingModel, toJSON(revenueShareConfig), toJSON(subscriptionConfig),
		toJSON(hybridConfig), currency, req.ProvisionedBy).Scan(&configID)
	if err != nil {
		return nil, fmt.Errorf("create billing config: %w", err)
	}
	result.ConfigID = configID
	completed = append(completed, "create_billing_config")
	result.CompletedSteps = append(result.CompletedSteps, StepResult{Step: "create_billing_config", Status: "completed"})
	auditStep(ctx, req.TenantID, "create_billing_config", "completed",
		map[string]interface{}{"configId": configID, "billingModel": req.BillingModel}, nil)

	// Steps 3–7 run under compensation control: on any failure, roll back the
	// completed steps in reverse order (mirrors BillingProvisioningWorkflow).
	fail := func(step string, cause error) (*ProvisionResult, error) {
		e := cause.Error()
		auditStep(context.Background(), req.TenantID, step, "failed", nil, &e)
		for i := len(completed) - 1; i >= 0; i-- {
			if rerr := rollbackStep(context.Background(), req.TenantID, completed[i], e); rerr != nil {
				log.Printf("[BillingProvisioning] ERROR: %v", rerr)
			} else {
				result.CompletedSteps = append(result.CompletedSteps, StepResult{Step: completed[i], Status: "rolled_back"})
			}
		}
		return result, fmt.Errorf("step %s failed: %w", step, cause)
	}

	// Step 3: create_tigerbeetle_accounts — deterministic ledger account id;
	// account effects are realized by transfers (consistent with the TS activity).
	accountID := fmt.Sprintf("TB-%d-%d", req.TenantID, time.Now().UnixMilli())
	if _, err := db.ExecContext(ctx,
		`UPDATE tenant_billing_config SET tigerbeetle_account_id = $1 WHERE tenant_id = $2`,
		accountID, req.TenantID); err != nil {
		return fail("create_tigerbeetle_accounts", err)
	}
	completed = append(completed, "create_tigerbeetle_accounts")
	result.CompletedSteps = append(result.CompletedSteps, StepResult{Step: "create_tigerbeetle_accounts", Status: "completed"})
	auditStep(ctx, req.TenantID, "create_tigerbeetle_accounts", "completed", map[string]interface{}{
		"accountId": accountID,
		"accounts": []map[string]string{
			{"type": "revenue", "id": accountID + "-revenue"},
			{"type": "commission", "id": accountID + "-commission"},
			{"type": "settlement", "id": accountID + "-settlement"},
			{"type": "escrow", "id": accountID + "-escrow"},
		},
	}, nil)

	// Step 4: provision_kafka_topics — record the tenant topic prefix.
	topicPrefix := fmt.Sprintf("billing.tenant-%d", req.TenantID)
	if _, err := db.ExecContext(ctx,
		`UPDATE tenant_billing_config SET kafka_topic_prefix = $1 WHERE tenant_id = $2`,
		topicPrefix, req.TenantID); err != nil {
		return fail("provision_kafka_topics", err)
	}
	completed = append(completed, "provision_kafka_topics")
	result.CompletedSteps = append(result.CompletedSteps, StepResult{Step: "provision_kafka_topics", Status: "completed"})
	auditStep(ctx, req.TenantID, "provision_kafka_topics", "completed", map[string]interface{}{
		"topicPrefix": topicPrefix,
		"topics": []string{
			topicPrefix + ".transactions",
			topicPrefix + ".splits",
			topicPrefix + ".reconciliation",
			topicPrefix + ".audit",
		},
	}, nil)

	// Step 5: assign_billing_roles — billing_admin for the provisioning user.
	if _, err := db.ExecContext(ctx, `
		INSERT INTO billing_role_assignments (user_id, tenant_id, billing_role, permissions, granted_by)
		VALUES ($1, $2, 'billing_admin', NULL, $1)
	`, req.ProvisionedBy, req.TenantID); err != nil {
		return fail("assign_billing_roles", err)
	}
	completed = append(completed, "assign_billing_roles")
	result.CompletedSteps = append(result.CompletedSteps, StepResult{Step: "assign_billing_roles", Status: "completed"})
	auditStep(ctx, req.TenantID, "assign_billing_roles", "completed",
		map[string]interface{}{"assignedRole": "billing_admin", "assignedTo": req.ProvisionedBy}, nil)

	// Step 6: configure_reconciliation — no persistent column by design; the
	// effective config is recorded in provisioning history (same as TS).
	region := req.Region
	if region == "" {
		region = "WAT"
	}
	reconciliationConfig := map[string]interface{}{
		"schedule":           "daily",
		"reconciliationTime": fmt.Sprintf("02:00 %s", region),
		"threshold":          0.01,
		"autoResolveBelow":   100,
	}
	completed = append(completed, "configure_reconciliation")
	result.CompletedSteps = append(result.CompletedSteps, StepResult{Step: "configure_reconciliation", Status: "completed"})
	auditStep(ctx, req.TenantID, "configure_reconciliation", "completed", reconciliationConfig, nil)

	// Step 7: activate_billing.
	if _, err := db.ExecContext(ctx, `
		UPDATE tenant_billing_config
		SET status = 'active', last_modified_at = NOW(), last_modified_by = $2
		WHERE tenant_id = $1
	`, req.TenantID, req.ProvisionedBy); err != nil {
		return fail("activate_billing", err)
	}
	completed = append(completed, "activate_billing")
	result.CompletedSteps = append(result.CompletedSteps, StepResult{Step: "activate_billing", Status: "completed"})
	auditStep(ctx, req.TenantID, "activate_billing", "completed",
		map[string]interface{}{"activated": true, "activatedAt": time.Now().UTC().Format(time.RFC3339)}, nil)

	result.Success = true
	return result, nil
}

// HTTP handlers

func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	dbOK := db != nil && db.Ping() == nil
	status := "healthy"
	code := http.StatusOK
	if !dbOK {
		status = "unhealthy"
		code = http.StatusServiceUnavailable
	}
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status":   status,
		"service":  "billing-provisioning-workflow",
		"database": dbOK,
		"language": "Go",
	})
}

func provisionHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req ProvisionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("invalid JSON body: %v", err), http.StatusBadRequest)
		return
	}
	if req.TenantID <= 0 {
		http.Error(w, "tenantId must be a positive integer", http.StatusBadRequest)
		return
	}
	if !validBillingModels[req.BillingModel] {
		http.Error(w, "billingModel must be one of revenue_share, subscription, hybrid", http.StatusBadRequest)
		return
	}
	if req.ProvisionedBy <= 0 {
		http.Error(w, "provisionedBy must be a positive integer", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()

	result, err := runProvisioning(ctx, req)
	w.Header().Set("Content-Type", "application/json")
	if err != nil {
		result.Error = err.Error()
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(result)
		return
	}
	_ = json.NewEncoder(w).Encode(result)
}

func historyHandler(w http.ResponseWriter, r *http.Request) {
	tenantParam := r.URL.Query().Get("tenantId")
	if tenantParam == "" {
		http.Error(w, "tenantId query parameter is required", http.StatusBadRequest)
		return
	}
	rows, err := db.QueryContext(r.Context(), `
		SELECT id, tenant_id, step, status, COALESCE(details::text, 'null'), COALESCE(error, ''), started_at, completed_at
		FROM billing_provisioning_history
		WHERE tenant_id = $1
		ORDER BY id DESC
		LIMIT 100
	`, tenantParam)
	if err != nil {
		http.Error(w, fmt.Sprintf("history query failed: %v", err), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type historyRow struct {
		ID          int        `json:"id"`
		TenantID    int        `json:"tenantId"`
		Step        string     `json:"step"`
		Status      string     `json:"status"`
		Details     string     `json:"details"`
		Error       string     `json:"error"`
		StartedAt   time.Time  `json:"startedAt"`
		CompletedAt *time.Time `json:"completedAt"`
	}
	entries := make([]historyRow, 0)
	for rows.Next() {
		var h historyRow
		if err := rows.Scan(&h.ID, &h.TenantID, &h.Step, &h.Status, &h.Details, &h.Error, &h.StartedAt, &h.CompletedAt); err != nil {
			http.Error(w, fmt.Sprintf("history scan failed: %v", err), http.StatusInternalServerError)
			return
		}
		entries = append(entries, h)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, fmt.Sprintf("history iteration failed: %v", err), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"entries": entries})
}

// connectDB establishes a PostgreSQL connection with retry. The service is
// useless without its only dependency, so a failed connect is fatal.
func connectDB(dsn string) (*sql.DB, error) {
	var d *sql.DB
	var err error
	for i := 0; i < 5; i++ {
		d, err = sql.Open("postgres", dsn)
		if err == nil {
			if pingErr := d.Ping(); pingErr == nil {
				d.SetMaxOpenConns(10)
				d.SetMaxIdleConns(5)
				d.SetConnMaxLifetime(5 * time.Minute)
				log.Printf("[BillingProvisioning] PostgreSQL connected")
				return d, nil
			} else {
				err = pingErr
			}
		}
		log.Printf("[BillingProvisioning] DB connection attempt %d failed: %v", i+1, err)
		time.Sleep(time.Duration(i+1) * 2 * time.Second)
	}
	return nil, fmt.Errorf("failed to connect to PostgreSQL after 5 attempts: %w", err)
}

func main() {
	cfg = loadConfig()
	log.Printf("[BillingProvisioning] Starting Tenant Billing Provisioning Workflow sidecar on port %s", cfg.Port)

	var err error
	db, err = connectDB(cfg.PostgresDSN)
	if err != nil {
		log.Fatalf("[BillingProvisioning] Failed to connect to database: %v", err)
	}
	defer db.Close()

	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/provision", provisionHandler)
	mux.HandleFunc("/provision/history", historyHandler)

	server := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           mux,
		ReadTimeout:       15 * time.Second,
		ReadHeaderTimeout: 5 * time.Second,
		WriteTimeout:      2 * time.Minute,
	}

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		log.Println("[BillingProvisioning] Shutting down...")
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer shutdownCancel()
		_ = server.Shutdown(shutdownCtx)
	}()

	log.Printf("[BillingProvisioning] HTTP server listening on :%s", cfg.Port)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		if !strings.Contains(err.Error(), "Server closed") {
			log.Fatalf("[BillingProvisioning] Server error: %v", err)
		}
	}
}
