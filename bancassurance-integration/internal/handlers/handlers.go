package handlers

import (
	"encoding/json"
	"github.com/unified-insurance/bancassurance-integration/internal/service"
	"net/http"
	"time"

	"github.com/google/uuid"
)

type BancassuranceHandler struct {
	svc *service.BancassuranceService
}

func NewBancassuranceHandler(svc *service.BancassuranceService) *BancassuranceHandler {
	return &BancassuranceHandler{svc: svc}
}

func (h *BancassuranceHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/bancassurance/partners", h.RegisterPartner)
	mux.HandleFunc("GET /api/v1/bancassurance/partners", h.ListPartners)
	mux.HandleFunc("POST /api/v1/bancassurance/offers", h.GenerateOffer)
	mux.HandleFunc("POST /api/v1/bancassurance/offers/{id}/accept", h.AcceptOffer)
	mux.HandleFunc("POST /api/v1/bancassurance/mandates", h.CreateMandate)
	mux.HandleFunc("POST /api/v1/bancassurance/collections", h.ProcessCollection)
	mux.HandleFunc("POST /api/v1/bancassurance/settlements", h.CalculateSettlement)
	mux.HandleFunc("GET /api/v1/bancassurance/settlements/{partnerId}", h.GetSettlements)
	mux.HandleFunc("GET /api/v1/bancassurance/policies/loan/{loanAccountNo}", h.GetPoliciesByLoan)
	mux.HandleFunc("POST /api/v1/bancassurance/webhooks/{partnerId}", h.HandleWebhook)
	mux.HandleFunc("GET /health", h.HealthCheck)
	mux.HandleFunc("GET /ready", h.ReadinessCheck)
}

func (h *BancassuranceHandler) RegisterPartner(w http.ResponseWriter, r *http.Request) {
	var req service.RegisterBankPartnerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := h.svc.RegisterBankPartner(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (h *BancassuranceHandler) ListPartners(w http.ResponseWriter, r *http.Request) {
	results, err := h.svc.GetBankPartners(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, results)
}

func (h *BancassuranceHandler) GenerateOffer(w http.ResponseWriter, r *http.Request) {
	var req service.GenerateOfferRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := h.svc.GenerateInsuranceOffer(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (h *BancassuranceHandler) AcceptOffer(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid offer ID")
		return
	}
	result, err := h.svc.AcceptOffer(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *BancassuranceHandler) CreateMandate(w http.ResponseWriter, r *http.Request) {
	var req service.CreateMandateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := h.svc.CreateDebitMandate(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (h *BancassuranceHandler) ProcessCollection(w http.ResponseWriter, r *http.Request) {
	var req service.ProcessCollectionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := h.svc.ProcessPremiumCollection(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *BancassuranceHandler) CalculateSettlement(w http.ResponseWriter, r *http.Request) {
	var req struct {
		BankPartnerID string `json:"bank_partner_id"`
		Period        string `json:"period"`
		StartDate     string `json:"start_date"`
		EndDate       string `json:"end_date"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	partnerID, err := uuid.Parse(req.BankPartnerID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid partner ID")
		return
	}
	// Parse dates would go here - simplified for now
	result, err := h.svc.CalculateCommissionSettlement(r.Context(), partnerID, req.Period, parseDate(req.StartDate), parseDate(req.EndDate))
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *BancassuranceHandler) GetSettlements(w http.ResponseWriter, r *http.Request) {
	partnerIDStr := r.PathValue("partnerId")
	partnerID, err := uuid.Parse(partnerIDStr)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid partner ID")
		return
	}
	results, err := h.svc.GetSettlementsByPartner(r.Context(), partnerID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, results)
}

func (h *BancassuranceHandler) GetPoliciesByLoan(w http.ResponseWriter, r *http.Request) {
	loanAccountNo := r.PathValue("loanAccountNo")
	results, err := h.svc.GetPoliciesByLoanAccount(r.Context(), loanAccountNo)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, results)
}

func (h *BancassuranceHandler) HandleWebhook(w http.ResponseWriter, r *http.Request) {
	partnerIDStr := r.PathValue("partnerId")
	partnerID, err := uuid.Parse(partnerIDStr)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid partner ID")
		return
	}
	var payload struct {
		EventType string                 `json:"event_type"`
		Data      map[string]interface{} `json:"data"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := h.svc.ProcessWebhookEvent(r.Context(), partnerID, payload.EventType, payload.Data)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *BancassuranceHandler) HealthCheck(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "healthy", "service": "bancassurance-integration"})
}

func (h *BancassuranceHandler) ReadinessCheck(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready", "service": "bancassurance-integration"})
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func parseDate(s string) time.Time {
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return time.Now()
	}
	return t
}
