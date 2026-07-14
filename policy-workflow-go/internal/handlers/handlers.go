package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/insureportal/policy_workflow_go/internal/service"
	"github.com/insureportal/policy_workflow_go/models"
	"go.uber.org/zap"
)

type Handlers struct {
	policy *service.PolicyService
	log    *zap.Logger
}

func NewHandlers(svc *service.PolicyService) *Handlers {
	return &Handlers{policy: svc, log: zap.L()}
}

// Health
func (h *Handlers) HealthCheck(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    "healthy",
		"service":   "policy-workflow-go",
		"timestamp": time.Now().Format(time.RFC3339),
		"version":   "1.0.0",
	})
}

func (h *Handlers) ReadinessCheck(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    "ready",
		"service":   "policy-workflow-go",
		"timestamp": time.Now().Format(time.RFC3339),
	})
}

// --- Policy CRUD ---
func (h *Handlers) CreatePolicy(w http.ResponseWriter, r *http.Request) {
	var pol models.Policy
	if err := json.NewDecoder(r.Body).Decode(&pol); err != nil {
		http.Error(w, `{"error":"invalid_json"}`, http.StatusBadRequest)
		return
	}
	if pol.HolderID == "" || pol.ProductID == "" {
		http.Error(w, `{"error":"holder_id and product_id are required"}`, http.StatusBadRequest)
		return
	}
	if err := h.policy.CreatePolicy(r.Context(), &pol); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"policy":  pol,
	})
}

func (h *Handlers) GetPolicy(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, `{"error":"id is required"}`, http.StatusBadRequest)
		return
	}
	pol, err := h.policy.GetPolicy(r.Context(), id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	json.NewEncoder(w).Encode(pol)
}

func (h *Handlers) GetPolicyByNumber(w http.ResponseWriter, r *http.Request) {
	number := r.URL.Query().Get("policy_number")
	if number == "" {
		http.Error(w, `{"error":"policy_number is required"}`, http.StatusBadRequest)
		return
	}
	pol, err := h.policy.GetPolicyByNumber(r.Context(), number)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	json.NewEncoder(w).Encode(pol)
}

func (h *Handlers) ListPolicies(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	productType := r.URL.Query().Get("product_type")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	if limit == 0 || limit > 100 { limit = 20 }

	policies, err := h.policy.ListPolicies(r.Context(), status, productType, limit, offset)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"policies": policies,
		"count":    len(policies),
	})
}

// --- State Transition ---
func (h *Handlers) TransitionPolicy(w http.ResponseWriter, r *http.Request) {
	var body struct {
		PolicyID  string `json:"policy_id"`
		FromState string `json:"from_state"`
		ToState   string `json:"to_state"`
		Actor     string `json:"actor"`
		ActorRole string `json:"actor_role"`
		Reason    string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid_json"}`, http.StatusBadRequest)
		return
	}
	if body.PolicyID == "" || body.FromState == "" || body.ToState == "" {
		http.Error(w, `{"error":"policy_id, from_state, and to_state are required"}`, http.StatusBadRequest)
		return
	}

	if err := h.policy.TransitionPolicy(r.Context(), body.PolicyID,
		models.PolicyState(body.FromState), models.PolicyState(body.ToState),
		body.Actor, body.ActorRole, body.Reason); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":     true,
		"policy_id":   body.PolicyID,
		"from_state":  body.FromState,
		"to_state":    body.ToState,
		"actor":       body.Actor,
		"timestamp":   time.Now().Format(time.RFC3339),
		"valid":       true,
	})
}

func (h *Handlers) GetValidTransitions(w http.ResponseWriter, r *http.Request) {
	state := r.URL.Query().Get("state")
	if state == "" {
		http.Error(w, `{"error":"state is required"}`, http.StatusBadRequest)
		return
	}
	allowed, ok := models.ValidTransitions[models.PolicyState(state)]
	if !ok {
		http.Error(w, `{"error":"unknown_state"}`, http.StatusBadRequest)
		return
	}
	transitionList := make([]string, len(allowed))
	for i, s := range allowed {
		transitionList[i] = string(s)
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"current_state":     state,
		"valid_transitions": transitionList,
	})
}

// --- Underwriting ---
func (h *Handlers) StartUnderwriting(w http.ResponseWriter, r *http.Request) {
	var body struct {
		PolicyID string `json:"policy_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid_json"}`, http.StatusBadRequest)
		return
	}
	if body.PolicyID == "" {
		http.Error(w, `{"error":"policy_id is required"}`, http.StatusBadRequest)
		return
	}
	if err := h.policy.StartUnderwriting(r.Context(), body.PolicyID); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":    true,
		"policy_id":  body.PolicyID,
		"message":    "Underwriting started",
	})
}

func (h *Handlers) GetUnderwritingRecord(w http.ResponseWriter, r *http.Request) {
	policyID := r.URL.Query().Get("policy_id")
	if policyID == "" {
		http.Error(w, `{"error":"policy_id is required"}`, http.StatusBadRequest)
		return
	}
	rec, err := h.policy.GetUnderwritingRecord(r.Context(), policyID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	json.NewEncoder(w).Encode(rec)
}

// --- Renewal ---
func (h *Handlers) CreateRenewal(w http.ResponseWriter, r *http.Request) {
	var renewal models.RenewalRecord
	if err := json.NewDecoder(r.Body).Decode(&renewal); err != nil {
		http.Error(w, `{"error":"invalid_json"}`, http.StatusBadRequest)
		return
	}
	if renewal.PolicyID == "" {
		http.Error(w, `{"error":"policy_id is required"}`, http.StatusBadRequest)
		return
	}
	if err := h.policy.CreateRenewalRecord(r.Context(), &renewal); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"renewal": renewal,
	})
}

func (h *Handlers) ProcessRenewal(w http.ResponseWriter, r *http.Request) {
	var body struct {
		PolicyID    string  `json:"policy_id"`
		NewPremium  float64 `json:"new_premium"`
		NewSumAssured float64 `json:"new_sum_assured"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid_json"}`, http.StatusBadRequest)
		return
	}
	if body.PolicyID == "" {
		http.Error(w, `{"error":"policy_id is required"}`, http.StatusBadRequest)
		return
	}
	if err := h.policy.ProcessRenewal(r.Context(), body.PolicyID, body.NewPremium, body.NewSumAssured); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Renewal processed",
	})
}

func (h *Handlers) GetRenewals(w http.ResponseWriter, r *http.Request) {
	policyID := r.URL.Query().Get("policy_id")
	if policyID == "" {
		http.Error(w, `{"error":"policy_id is required"}`, http.StatusBadRequest)
		return
	}
	renewals, err := h.policy.GetRenewalRecords(r.Context(), policyID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"renewals": renewals,
		"count":    len(renewals),
	})
}

// --- Endorsement ---
func (h *Handlers) CreateEndorsement(w http.ResponseWriter, r *http.Request) {
	var end models.Endorsement
	if err := json.NewDecoder(r.Body).Decode(&end); err != nil {
		http.Error(w, `{"error":"invalid_json"}`, http.StatusBadRequest)
		return
	}
	if end.PolicyID == "" {
		http.Error(w, `{"error":"policy_id is required"}`, http.StatusBadRequest)
		return
	}
	if err := h.policy.CreateEndorsement(r.Context(), &end); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"endorsement": end,
	})
}

func (h *Handlers) GetEndorsements(w http.ResponseWriter, r *http.Request) {
	policyID := r.URL.Query().Get("policy_id")
	if policyID == "" {
		http.Error(w, `{"error":"policy_id is required"}`, http.StatusBadRequest)
		return
	}
	status := r.URL.Query().Get("status")
	limit := 20
	endorsements, err := h.policy.GetEndorsements(r.Context(), policyID, status, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"endorsements": endorsements,
		"count":        len(endorsements),
	})
}

// --- Lapse ---
func (h *Handlers) CheckLapses(w http.ResponseWriter, r *http.Request) {
	if err := h.policy.CheckAndProcessLapses(r.Context()); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":   true,
		"message":   "Lapse check completed",
		"timestamp": time.Now().Format(time.RFC3339),
	})
}

// --- Cancellation ---
func (h *Handlers) CancelPolicy(w http.ResponseWriter, r *http.Request) {
	var body struct {
		PolicyID    string `json:"policy_id"`
		CancelType  string `json:"cancel_type"`
		Reason      string `json:"reason"`
		CancelledBy string `json:"cancelled_by"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid_json"}`, http.StatusBadRequest)
		return
	}
	if body.PolicyID == "" || body.CancelType == "" {
		http.Error(w, `{"error":"policy_id and cancel_type are required"}`, http.StatusBadRequest)
		return
	}
	if err := h.policy.CancelPolicy(r.Context(), body.PolicyID, body.CancelType, body.Reason, body.CancelledBy); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"policy_id": body.PolicyID,
		"message": "Policy cancelled successfully",
	})
}

// --- Dashboard ---
func (h *Handlers) GetDashboard(w http.ResponseWriter, r *http.Request) {
	dash, err := h.policy.GetDashboard(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(dash)
}
