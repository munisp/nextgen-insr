package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/insureportal/takaful_module/internal/service"
	"github.com/insureportal/takaful_module/models"
	"go.uber.org/zap"
)

type Handlers struct {
	takaful *service.TakafulService
	log     *zap.Logger
}

func NewHandlers(svc *service.TakafulService) *Handlers {
	return &Handlers{takaful: svc, log: zap.L()}
}

// Health & Readiness
func (h *Handlers) HealthCheck(w http.ResponseWriter, r *http.Request) {
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    "healthy",
		"service":   "takaful-module",
		"timestamp": time.Now().Format(time.RFC3339),
		"version":   "1.0.0",
	})
}

func (h *Handlers) ReadinessCheck(w http.ResponseWriter, r *http.Request) {
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    "ready",
		"service":   "takaful-module",
		"timestamp": time.Now().Format(time.RFC3339),
	})
}

// --- Product Handlers ---
func (h *Handlers) CreateProduct(w http.ResponseWriter, r *http.Request) {
	var prod models.TakafulProduct
	if err := json.NewDecoder(r.Body).Decode(&prod); err != nil {
		http.Error(w, `{"error":"invalid_json"}`, http.StatusBadRequest)
		return
	}
	if err := h.takaful.CreateProduct(r.Context(), &prod); err != nil {
		h.log.Error("Failed to create product", zap.Error(err))
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"product": prod,
	})
}

func (h *Handlers) GetProduct(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, `{"error":"id is required"}`, http.StatusBadRequest)
		return
	}
	prod, err := h.takaful.GetProduct(r.Context(), id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	_ = json.NewEncoder(w).Encode(prod)
}

func (h *Handlers) ListProducts(w http.ResponseWriter, r *http.Request) {
	category := r.URL.Query().Get("category")
	products, err := h.takaful.ListProducts(r.Context(), category)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"products": products,
		"count":    len(products),
	})
}

// --- Participant Handlers ---
func (h *Handlers) RegisterParticipant(w http.ResponseWriter, r *http.Request) {
	var ptc models.Participant
	if err := json.NewDecoder(r.Body).Decode(&ptc); err != nil {
		http.Error(w, `{"error":"invalid_json"}`, http.StatusBadRequest)
		return
	}
	if err := h.takaful.RegisterParticipant(r.Context(), &ptc); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success":     true,
		"participant": ptc,
		"message":     "Participant registered successfully",
	})
}

func (h *Handlers) GetParticipant(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, `{"error":"id is required"}`, http.StatusBadRequest)
		return
	}
	ptc, err := h.takaful.GetParticipant(r.Context(), id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	_ = json.NewEncoder(w).Encode(ptc)
}

func (h *Handlers) ListParticipants(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	kycStatus := r.URL.Query().Get("kyc_status")
	limit, offset := 20, 0
	if l := r.URL.Query().Get("limit"); l != "" {
		limit = 20
	}
	if o := r.URL.Query().Get("offset"); o != "" {
		offset = 0
	}
	participants, err := h.takaful.ListParticipants(r.Context(), status, kycStatus, limit, offset)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"participants": participants,
		"count":        len(participants),
	})
}

func (h *Handlers) VerifyKYC(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ParticipantID string `json:"participant_id"`
		Status        string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid_json"}`, http.StatusBadRequest)
		return
	}
	if body.ParticipantID == "" {
		http.Error(w, `{"error":"participant_id is required"}`, http.StatusBadRequest)
		return
	}
	if err := h.takaful.VerifyKYC(r.Context(), body.ParticipantID, body.Status); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success":        true,
		"participant_id": body.ParticipantID,
		"kyc_status":     body.Status,
	})
}

// --- Contribution Handlers ---
func (h *Handlers) MakeContribution(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ParticipantID string  `json:"participant_id"`
		ProductID     string  `json:"product_id"`
		TransactionID string  `json:"transaction_id"`
		Amount        float64 `json:"amount"`
		PaymentMethod string  `json:"payment_method"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid_json"}`, http.StatusBadRequest)
		return
	}
	if body.ParticipantID == "" || body.ProductID == "" || body.TransactionID == "" {
		http.Error(w, `{"error":"participant_id, product_id, transaction_id, and amount are required"}`, http.StatusBadRequest)
		return
	}
	if body.Amount <= 0 {
		http.Error(w, `{"error":"amount must be positive"}`, http.StatusBadRequest)
		return
	}

	participant, err := h.takaful.GetParticipant(r.Context(), body.ParticipantID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	product, err := h.takaful.GetProduct(r.Context(), body.ProductID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	contrib := &models.Contribution{
		ParticipantID: body.ParticipantID,
		ProductID:     body.ProductID,
		TransactionID: body.TransactionID,
		Amount:        body.Amount,
		PaymentMethod: body.PaymentMethod,
	}

	if err := h.takaful.MakeContribution(r.Context(), contrib, participant, product); err != nil {
		h.log.Error("Failed to process contribution", zap.Error(err))
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success":            true,
		"contribution_id":    contrib.ID,
		"transaction_id":     contrib.TransactionID,
		"amount":             contrib.Amount,
		"tabarru_portion":    contrib.TabarruPortion,
		"wakala_fee":         contrib.WakalaFee,
		"investment_portion": contrib.InvestmentPortion,
		"status":             contrib.Status,
		"shariah_compliant":  true,
		"timestamp":          time.Now().Format(time.RFC3339),
	})
}

// --- Pool Handlers ---
func (h *Handlers) GetPool(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, `{"error":"pool_id is required"}`, http.StatusBadRequest)
		return
	}
	pool, err := h.takaful.GetPool(r.Context(), id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	_ = json.NewEncoder(w).Encode(pool)
}

func (h *Handlers) ListPools(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	pools, err := h.takaful.ListPools(r.Context(), status)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"pools": pools,
		"count": len(pools),
	})
}

func (h *Handlers) GetPoolStats(w http.ResponseWriter, r *http.Request) {
	stats, err := h.takaful.GetPoolStats(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	_ = json.NewEncoder(w).Encode(stats)
}

// --- Claim Handlers ---
func (h *Handlers) CreateClaim(w http.ResponseWriter, r *http.Request) {
	var claim models.Claim
	if err := json.NewDecoder(r.Body).Decode(&claim); err != nil {
		http.Error(w, `{"error":"invalid_json"}`, http.StatusBadRequest)
		return
	}
	if claim.ClaimType == "" {
		http.Error(w, `{"error":"claim_type is required"}`, http.StatusBadRequest)
		return
	}
	if claim.ClaimAmount <= 0 {
		http.Error(w, `{"error":"claim_amount must be positive"}`, http.StatusBadRequest)
		return
	}
	if err := h.takaful.CreateClaim(r.Context(), &claim); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"claim":   claim,
		"message": "Claim filed successfully",
	})
}

func (h *Handlers) UpdateClaimStatus(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ClaimID    string  `json:"claim_id"`
		Status     string  `json:"status"`
		PaidAmount float64 `json:"paid_amount"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid_json"}`, http.StatusBadRequest)
		return
	}
	if body.ClaimID == "" {
		http.Error(w, `{"error":"claim_id is required"}`, http.StatusBadRequest)
		return
	}
	if err := h.takaful.UpdateClaimStatus(r.Context(), body.ClaimID, body.Status, body.PaidAmount); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success":  true,
		"claim_id": body.ClaimID,
		"status":   body.Status,
	})
}

func (h *Handlers) GetClaim(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, `{"error":"id is required"}`, http.StatusBadRequest)
		return
	}
	claim, err := h.takaful.GetClaim(r.Context(), id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	_ = json.NewEncoder(w).Encode(claim)
}

func (h *Handlers) GetClaimsByParticipant(w http.ResponseWriter, r *http.Request) {
	participantID := r.URL.Query().Get("participant_id")
	if participantID == "" {
		http.Error(w, `{"error":"participant_id is required"}`, http.StatusBadRequest)
		return
	}
	claims, err := h.takaful.GetClaimsByParticipant(r.Context(), participantID, "", 20)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"claims": claims,
		"count":  len(claims),
	})
}

// --- Surplus Handlers ---
func (h *Handlers) CalculateSurplus(w http.ResponseWriter, r *http.Request) {
	poolID := r.URL.Query().Get("pool_id")
	period := r.URL.Query().Get("period")
	if poolID == "" {
		http.Error(w, `{"error":"pool_id is required"}`, http.StatusBadRequest)
		return
	}
	if period == "" {
		period = time.Now().Format("2006")
	}
	sd, err := h.takaful.CalculateSurplusDistribution(r.Context(), poolID, period)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success":      true,
		"distribution": sd,
		"ratio":        "70/30",
		"shariah_note": "Surplus distribution follows Islamic insurance principles",
	})
}

// --- Zakat Handlers ---
func (h *Handlers) CalculateZakat(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ParticipantID string `json:"participant_id"`
		Year          int    `json:"year"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid_json"}`, http.StatusBadRequest)
		return
	}
	if body.ParticipantID == "" {
		http.Error(w, `{"error":"participant_id is required"}`, http.StatusBadRequest)
		return
	}
	if body.Year == 0 {
		body.Year = time.Now().Year()
	}
	record, err := h.takaful.CalculateZakat(r.Context(), body.ParticipantID, body.Year)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success":      true,
		"zakat_record": record,
		"rate":         record.ZakatRate,
		"is_obliged":   record.IsZakatObliged,
	})
}

// --- Retakaful Handlers ---
func (h *Handlers) CreateRetakafulEntry(w http.ResponseWriter, r *http.Request) {
	var entry models.RetakafulEntry
	if err := json.NewDecoder(r.Body).Decode(&entry); err != nil {
		http.Error(w, `{"error":"invalid_json"}`, http.StatusBadRequest)
		return
	}
	if err := h.takaful.CreateRetakafulEntry(r.Context(), &entry); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"entry":   entry,
	})
}

// --- Pool Snapshot ---
func (h *Handlers) CreatePoolSnapshot(w http.ResponseWriter, r *http.Request) {
	var body struct {
		PoolID string `json:"pool_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.PoolID == "" {
		http.Error(w, `{"error":"pool_id is required"}`, http.StatusBadRequest)
		return
	}
	if err := h.takaful.CreatePoolSnapshot(r.Context(), body.PoolID); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Pool snapshot created",
	})
}
