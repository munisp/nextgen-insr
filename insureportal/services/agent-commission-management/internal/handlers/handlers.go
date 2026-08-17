package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/insureportal/agent_commission_management/internal/service"
	"github.com/insureportal/agent_commission_management/models"
	"go.uber.org/zap"
)

type Handlers struct {
	commission *service.CommissionService
	log        *zap.Logger
}

func NewHandlers(svc *service.CommissionService) *Handlers {
	return &Handlers{commission: svc, log: zap.L()}
}

// Health
func (h *Handlers) HealthCheck(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    "healthy",
		"service":   "agent-commission-management",
		"timestamp": time.Now().Format(time.RFC3339),
		"version":   "1.0.0",
	})
}

func (h *Handlers) ReadinessCheck(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    "ready",
		"service":   "agent-commission-management",
		"timestamp": time.Now().Format(time.RFC3339),
	})
}

// --- Commission ---
func (h *Handlers) CalculateCommission(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AgentID        string  `json:"agent_id"`
		AgentCode      string  `json:"agent_code"`
		PolicyID       string  `json:"policy_id"`
		PolicyNumber   string  `json:"policy_number"`
		ProductCode    string  `json:"product_code"`
		ProductType    string  `json:"product_type"`
		Premium        float64 `json:"premium"`
		CommissionRate float64 `json:"commission_rate"`
		CommissionType string  `json:"commission_type"`
		PolicyStart    string  `json:"policy_start"`
		PolicyEnd      string  `json:"policy_end"`
		IsRenewal      bool    `json:"is_renewal"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid_json"}`, http.StatusBadRequest)
		return
	}
	if body.AgentID == "" || body.PolicyID == "" || body.Premium <= 0 {
		http.Error(w, `{"error":"agent_id, policy_id, and premium are required"}`, http.StatusBadRequest)
		return
	}

	c := &models.Commission{
		AgentID:        body.AgentID,
		AgentCode:      body.AgentCode,
		PolicyID:       body.PolicyID,
		PolicyNumber:   body.PolicyNumber,
		ProductCode:    body.ProductCode,
		ProductType:    body.ProductType,
		Premium:        body.Premium,
		CommissionRate: body.CommissionRate,
		CommissionType: models.CommissionType(body.CommissionType),
		PolicyStart:    parseTime(body.PolicyStart),
		PolicyEnd:      parseTime(body.PolicyEnd),
		IsRenewal:      body.IsRenewal,
	}
	if c.CommissionType == "" {
		c.CommissionType = models.TypeNewPolicy
	}

	if err := h.commission.CalculateCommission(r.Context(), c); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":           true,
		"commission":        c,
		"commission_amount": c.CommissionAmount,
		"net_commission":    c.NetCommission,
		"withholding_tax":   c.WithholdingTax,
		"payable_amount":    c.PayableAmount,
	})
}

func (h *Handlers) GetCommission(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, `{"error":"id is required"}`, http.StatusBadRequest)
		return
	}
	c, err := h.commission.GetCommission(r.Context(), id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	_ = json.NewEncoder(w).Encode(c)
}

func (h *Handlers) GetCommissionByPolicy(w http.ResponseWriter, r *http.Request) {
	policyID := r.URL.Query().Get("policy_id")
	if policyID == "" {
		http.Error(w, `{"error":"policy_id is required"}`, http.StatusBadRequest)
		return
	}
	c, err := h.commission.GetCommissionByPolicy(r.Context(), policyID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	_ = json.NewEncoder(w).Encode(c)
}

func (h *Handlers) GetCommissionByAgent(w http.ResponseWriter, r *http.Request) {
	agentID := r.URL.Query().Get("agent_id")
	if agentID == "" {
		http.Error(w, `{"error":"agent_id is required"}`, http.StatusBadRequest)
		return
	}
	status := r.URL.Query().Get("status")
	limit := 20
	if l := r.URL.Query().Get("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil && v > 0 && v <= 100 {
			limit = v
		}
	}
	commissions, err := h.commission.GetCommissionByAgent(r.Context(), agentID, status, limit, 0)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"commissions": commissions,
		"count":       len(commissions),
	})
}

// --- Payment ---
func (h *Handlers) ProcessPayment(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AgentID         string  `json:"agent_id"`
		AgentCode       string  `json:"agent_code"`
		Amount          float64 `json:"amount"`
		PeriodStart     string  `json:"period_start"`
		PeriodEnd       string  `json:"period_end"`
		PaymentDate     string  `json:"payment_date"`
		PaymentMethod   string  `json:"payment_method"`
		BankAccount     string  `json:"bank_account"`
		BankName        string  `json:"bank_name"`
		CommissionIDs   string  `json:"commission_ids"`
		CommissionCount int     `json:"commission_count"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid_json"}`, http.StatusBadRequest)
		return
	}
	if body.AgentID == "" || body.Amount <= 0 {
		http.Error(w, `{"error":"agent_id and amount are required"}`, http.StatusBadRequest)
		return
	}

	payment := &models.PaymentRecord{
		AgentID:         body.AgentID,
		AgentCode:       body.AgentCode,
		Amount:          body.Amount,
		PeriodStart:     parseTime(body.PeriodStart),
		PeriodEnd:       parseTime(body.PeriodEnd),
		PaymentDate:     parseTime(body.PaymentDate),
		PaymentMethod:   body.PaymentMethod,
		BankAccount:     body.BankAccount,
		BankName:        body.BankName,
		CommissionIDs:   body.CommissionIDs,
		CommissionCount: body.CommissionCount,
	}
	if payment.PaymentDate.IsZero() {
		payment.PaymentDate = time.Now()
	}

	if err := h.commission.ProcessPayment(r.Context(), payment); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":      true,
		"payment_id":   payment.PaymentID,
		"agent_id":     payment.AgentID,
		"amount":       payment.Amount,
		"status":       payment.Status,
		"payment_date": payment.PaymentDate.Format(time.RFC3339),
		"reference_no": payment.PaymentID,
	})
}

func (h *Handlers) GetPaymentRecords(w http.ResponseWriter, r *http.Request) {
	agentID := r.URL.Query().Get("agent_id")
	if agentID == "" {
		http.Error(w, `{"error":"agent_id is required"}`, http.StatusBadRequest)
		return
	}
	status := r.URL.Query().Get("status")
	limit := 20
	if l := r.URL.Query().Get("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil && v > 0 {
			limit = v
		}
	}
	payments, err := h.commission.GetPaymentRecords(r.Context(), agentID, status, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"payments": payments,
		"count":    len(payments),
	})
}

// --- Agent Profiles ---
func (h *Handlers) CreateAgentProfile(w http.ResponseWriter, r *http.Request) {
	var ap models.AgentProfile
	if err := json.NewDecoder(r.Body).Decode(&ap); err != nil {
		http.Error(w, `{"error":"invalid_json"}`, http.StatusBadRequest)
		return
	}
	if ap.AgentCode == "" || ap.AgentName == "" {
		http.Error(w, `{"error":"agent_code and agent_name are required"}`, http.StatusBadRequest)
		return
	}
	if err := h.commission.CreateAgentProfile(r.Context(), &ap); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"profile": ap,
	})
}

func (h *Handlers) GetAgentProfile(w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("agent_code")
	if code == "" {
		http.Error(w, `{"error":"agent_code is required"}`, http.StatusBadRequest)
		return
	}
	ap, err := h.commission.GetAgentProfile(r.Context(), code)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	_ = json.NewEncoder(w).Encode(ap)
}

func (h *Handlers) ListAgentProfiles(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	if limit == 0 || limit > 100 {
		limit = 20
	}

	profiles, err := h.commission.ListAgentProfiles(r.Context(), status, limit, offset)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"profiles": profiles,
		"count":    len(profiles),
	})
}

// --- Period Management ---
func (h *Handlers) CreateCommissionPeriod(w http.ResponseWriter, r *http.Request) {
	var cp models.CommissionPeriod
	if err := json.NewDecoder(r.Body).Decode(&cp); err != nil {
		http.Error(w, `{"error":"invalid_json"}`, http.StatusBadRequest)
		return
	}
	if cp.AgentID == "" {
		http.Error(w, `{"error":"agent_id is required"}`, http.StatusBadRequest)
		return
	}
	if err := h.commission.CreateCommissionPeriod(r.Context(), &cp); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"period":  cp,
	})
}

func (h *Handlers) GetCommissionPeriods(w http.ResponseWriter, r *http.Request) {
	agentID := r.URL.Query().Get("agent_id")
	if agentID == "" {
		http.Error(w, `{"error":"agent_id is required"}`, http.StatusBadRequest)
		return
	}
	status := r.URL.Query().Get("status")
	limit := 12
	periods, err := h.commission.GetCommissionPeriods(r.Context(), agentID, status, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"periods": periods,
		"count":   len(periods),
	})
}

// --- Clawback ---
func (h *Handlers) CreateClawback(w http.ResponseWriter, r *http.Request) {
	var cb models.Clawback
	if err := json.NewDecoder(r.Body).Decode(&cb); err != nil {
		http.Error(w, `{"error":"invalid_json"}`, http.StatusBadRequest)
		return
	}
	if cb.CommissionID == "" || cb.AgentID == "" {
		http.Error(w, `{"error":"commission_id and agent_id are required"}`, http.StatusBadRequest)
		return
	}
	if err := h.commission.CreateClawback(r.Context(), &cb); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":  true,
		"clawback": cb,
	})
}

func (h *Handlers) GetPendingClawbacks(w http.ResponseWriter, r *http.Request) {
	limit := 50
	clawbacks, err := h.commission.GetPendingClawbacks(r.Context(), limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"clawbacks": clawbacks,
		"count":     len(clawbacks),
	})
}

func (h *Handlers) ProcessClawback(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid_json"}`, http.StatusBadRequest)
		return
	}
	if body.ID == "" {
		http.Error(w, `{"error":"id is required"}`, http.StatusBadRequest)
		return
	}
	if err := h.commission.ProcessClawback(r.Context(), body.ID); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":     true,
		"clawback_id": body.ID,
		"message":     "Clawback processed successfully",
	})
}

// --- Adjustments ---
func (h *Handlers) CreateAdjustment(w http.ResponseWriter, r *http.Request) {
	var adj models.CommissionAdjustment
	if err := json.NewDecoder(r.Body).Decode(&adj); err != nil {
		http.Error(w, `{"error":"invalid_json"}`, http.StatusBadRequest)
		return
	}
	if adj.CommissionID == "" || adj.AdjustmentType == "" {
		http.Error(w, `{"error":"commission_id and adjustment_type are required"}`, http.StatusBadRequest)
		return
	}
	if err := h.commission.CreateAdjustment(r.Context(), &adj); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":    true,
		"adjustment": adj,
	})
}

func (h *Handlers) GetAdjustments(w http.ResponseWriter, r *http.Request) {
	commissionID := r.URL.Query().Get("commission_id")
	if commissionID == "" {
		http.Error(w, `{"error":"commission_id is required"}`, http.StatusBadRequest)
		return
	}
	adjustments, err := h.commission.GetAdjustments(r.Context(), commissionID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"adjustments": adjustments,
		"count":       len(adjustments),
	})
}

func (h *Handlers) ApproveAdjustment(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AdjustmentID string `json:"adjustment_id"`
		ApprovedBy   string `json:"approved_by"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid_json"}`, http.StatusBadRequest)
		return
	}
	if body.AdjustmentID == "" {
		http.Error(w, `{"error":"adjustment_id is required"}`, http.StatusBadRequest)
		return
	}
	if err := h.commission.ApproveAdjustment(r.Context(), body.AdjustmentID, body.ApprovedBy); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":       true,
		"adjustment_id": body.AdjustmentID,
		"message":       "Adjustment approved",
	})
}

// --- Reports ---
func (h *Handlers) CreateCommissionReport(w http.ResponseWriter, r *http.Request) {
	var report models.CommissionReport
	if err := json.NewDecoder(r.Body).Decode(&report); err != nil {
		http.Error(w, `{"error":"invalid_json"}`, http.StatusBadRequest)
		return
	}
	if report.ReportType == "" {
		http.Error(w, `{"error":"report_type is required"}`, http.StatusBadRequest)
		return
	}
	if err := h.commission.CreateCommissionReport(r.Context(), &report); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"report":  report,
	})
}

func (h *Handlers) GetCommissionReports(w http.ResponseWriter, r *http.Request) {
	reportType := r.URL.Query().Get("report_type")
	status := r.URL.Query().Get("status")
	limit := 20
	if l := r.URL.Query().Get("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil && v > 0 {
			limit = v
		}
	}
	reports, err := h.commission.GetCommissionReports(r.Context(), reportType, status, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"reports": reports,
		"count":   len(reports),
	})
}

// --- Dashboard ---
func (h *Handlers) GetDashboard(w http.ResponseWriter, r *http.Request) {
	dash, err := h.commission.GetDashboard(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	_ = json.NewEncoder(w).Encode(dash)
}

func parseTime(s string) time.Time {
	if s == "" {
		return time.Time{}
	}
	t, _ := time.Parse(time.RFC3339, s)
	return t
}
